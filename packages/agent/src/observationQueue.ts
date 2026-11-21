import type { UUID, ObservationCreate, Observation } from '@chronyx/contracts';

export class QueueOverflowError extends Error {
  public readonly code = 'QUEUE_OVERFLOW';
  public readonly capacity: number;
  public readonly currentSize: number;

  constructor(capacity: number, currentSize: number) {
    super(
      `Observation queue overflow: capacity of ${capacity} reached (current size: ${currentSize}). Rejecting newest observation to preserve existing pending observations.`,
    );
    this.name = 'QueueOverflowError';
    this.capacity = capacity;
    this.currentSize = currentSize;
  }
}

export class PendingObservationsDisposalError extends Error {
  public readonly code = 'PENDING_OBSERVATIONS_DISPOSAL_REFUSED';
  public readonly pendingCount: number;
  public readonly pendingIds: string[];

  constructor(pendingCount: number, pendingIds: string[]) {
    super(
      `Refusing permanent disposal: ${pendingCount} pending observations remain in queue (${pendingIds.join(', ')}). Flush pending observations or invoke discardPendingObservations(reason) explicitly.`,
    );
    this.name = 'PendingObservationsDisposalError';
    this.pendingCount = pendingCount;
    this.pendingIds = pendingIds;
  }
}

export interface DiscardReport {
  discardedCount: number;
  discardedIds: string[];
  reason: string;
  discardedAtMs: number;
}

export interface QueuedObservationItem {
  id: string; // Stable client-side tracking ID preserved across retries
  node_id: UUID;
  kind: 'occultation_timing' | 'generic';
  local_timestamp_ms: number; // Raw browser time captured at event occurrence
  payload: Record<string, unknown>;
  enqueued_at_ms: number;
  retryCount: number;
  lastError: string | null;
}

export interface FlushResult {
  submittedCount: number;
  submittedIds: string[];
  remainingPendingCount: number;
  failedCount: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Generates a stable RFC4122 v4 UUID without external dependencies.
 */
export function generateClientObservationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments where crypto.randomUUID is absent
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Bounded observation queue that stores uncalibrated or un-submitted observations
 * until connectivity and clock calibration are available.
 *
 * Enforces:
 * - Maximum capacity: 32 items.
 * - Reject-newest on overflow (older items are strictly preserved).
 * - Stable client observation IDs preserved across all retries.
 * - Timestamp correction applied at flush time using current calibrated offset.
 * - At-least-once delivery semantics (acknowledging potential duplicate ingestion on Gateway).
 * - Refusal of silent disposal while observations are pending.
 * - Explicit authorized discard API with structured audit reporting.
 */
export class ObservationQueue {
  public static readonly MAX_CAPACITY = 32;

  private queue: QueuedObservationItem[] = [];
  private inFlight = false;

  /**
   * Enqueues a new raw observation.
   * If the queue is at capacity (32), rejects the newest incoming observation
   * with a QueueOverflowError and preserves all existing items.
   */
  public enqueue(observation: {
    node_id: UUID;
    kind: 'occultation_timing' | 'generic';
    local_timestamp_ms: number;
    payload?: Record<string, unknown>;
    customId?: string;
  }): QueuedObservationItem {
    if (this.queue.length >= ObservationQueue.MAX_CAPACITY) {
      throw new QueueOverflowError(ObservationQueue.MAX_CAPACITY, this.queue.length);
    }

    const item: QueuedObservationItem = {
      id: observation.customId || generateClientObservationId(),
      node_id: observation.node_id,
      kind: observation.kind,
      local_timestamp_ms: observation.local_timestamp_ms,
      payload: observation.payload || {},
      enqueued_at_ms: Date.now(),
      retryCount: 0,
      lastError: null,
    };

    this.queue.push(item);
    return item;
  }

  /**
   * Current number of pending observations in the queue.
   */
  public size(): number {
    return this.queue.length;
  }

  /**
   * Array of IDs currently in the queue.
   */
  public getPendingIds(): string[] {
    return this.queue.map((item) => item.id);
  }

  /**
   * Returns a copy of the pending queue items.
   */
  public getPendingItems(): QueuedObservationItem[] {
    return this.queue.map((item) => ({ ...item, payload: { ...item.payload } }));
  }

  /**
   * Flushes queued observations using the provided submission function and current offset.
   *
   * Timestamp correction is applied at flush time:
   *   observed_at_ms = item.local_timestamp_ms - currentOffsetMs
   *
   * An item is evicted from the queue only after successful submission (HTTP 200/201).
   * On failure, items remain in the queue with their original IDs and capture data.
   */
  public async flush(
    currentOffsetMs: number,
    submitFn: (payload: ObservationCreate) => Promise<Observation>,
  ): Promise<FlushResult> {
    if (this.inFlight) {
      return {
        submittedCount: 0,
        submittedIds: [],
        remainingPendingCount: this.queue.length,
        failedCount: 0,
        errors: [{ id: 'queue', error: 'Flush already in flight' }],
      };
    }

    this.inFlight = true;
    const submittedIds: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    try {
      // Process items in FIFO order
      const itemsToProcess = [...this.queue];

      for (const item of itemsToProcess) {
        // Compute Gateway-aligned timestamp at flush boundary
        const correctedAtMs = item.local_timestamp_ms - currentOffsetMs;

        const payload: ObservationCreate = {
          node_id: item.node_id,
          kind: item.kind,
          observed_at_ms: correctedAtMs,
          payload: {
            ...item.payload,
            client_observation_id: item.id, // client tracking metadata
          },
        };

        try {
          await submitFn(payload);
          submittedIds.push(item.id);
          // Remove successfully submitted item from queue
          const idx = this.queue.findIndex((q) => q.id === item.id);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          item.retryCount += 1;
          item.lastError = errMsg;
          errors.push({ id: item.id, error: errMsg });
          // Stop flushing on network or server error to preserve FIFO ordering
          break;
        }
      }

      return {
        submittedCount: submittedIds.length,
        submittedIds,
        remainingPendingCount: this.queue.length,
        failedCount: errors.length,
        errors,
      };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Refuses disposal if observations remain pending.
   * Throws PendingObservationsDisposalError unless the queue is empty.
   */
  public dispose(): void {
    if (this.queue.length > 0) {
      throw new PendingObservationsDisposalError(this.queue.length, this.getPendingIds());
    }
  }

  /**
   * Explicit authorized discard API.
   * Requires a non-empty reason, clears the pending queue, and returns an audit report.
   * Must NEVER be called automatically.
   */
  public discardPendingObservations(reason: string): DiscardReport {
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error('Explicit observation discard requires a non-empty justification reason');
    }

    const discardedIds = this.getPendingIds();
    const discardedCount = this.queue.length;

    this.queue = [];

    return {
      discardedCount,
      discardedIds,
      reason: reason.trim(),
      discardedAtMs: Date.now(),
    };
  }

  /**
   * Reset / clear for test tear-downs only.
   */
  public resetForTesting(): void {
    this.queue = [];
    this.inFlight = false;
  }
}
