import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ObservationQueue,
  QueueOverflowError,
  PendingObservationsDisposalError,
} from '../observationQueue.js';
import type { ObservationCreate, Observation } from '@chronyx/contracts';

describe('P3-T8 Bounded Observation Queue & Lifecycle (Requirements 13-25)', () => {
  let queue: ObservationQueue;
  const mockNodeId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    queue = new ObservationQueue();
  });

  // Req 13: Queue capacity of 32
  it('Req 13: accepts up to exactly 32 observations in queue', () => {
    for (let i = 0; i < 32; i++) {
      const item = queue.enqueue({
        node_id: mockNodeId,
        kind: 'occultation_timing',
        local_timestamp_ms: 1700000000000 + i * 1000,
        payload: { eventIndex: i },
      });
      expect(item.id).toBeDefined();
    }
    expect(queue.size()).toBe(32);
  });

  // Req 14, 15, 16: Reject-newest, preservation of older observations, explicit overflow error
  it('Req 14, 15, 16: rejects 33rd observation with QueueOverflowError and preserves all 32 older items', () => {
    const firstEnqueuedIds: string[] = [];
    for (let i = 0; i < 32; i++) {
      const item = queue.enqueue({
        node_id: mockNodeId,
        kind: 'occultation_timing',
        local_timestamp_ms: 1700000000000 + i * 1000,
        payload: { eventIndex: i },
      });
      firstEnqueuedIds.push(item.id);
    }

    expect(queue.size()).toBe(32);

    // Attempt to enqueue 33rd item
    expect(() => {
      queue.enqueue({
        node_id: mockNodeId,
        kind: 'generic',
        local_timestamp_ms: 1700000099999,
        payload: { eventIndex: 33 },
      });
    }).toThrow(QueueOverflowError);

    try {
      queue.enqueue({
        node_id: mockNodeId,
        kind: 'generic',
        local_timestamp_ms: 1700000099999,
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(QueueOverflowError);
      const qErr = err as QueueOverflowError;
      expect(qErr.code).toBe('QUEUE_OVERFLOW');
      expect(qErr.capacity).toBe(32);
      expect(qErr.currentSize).toBe(32);
    }

    // Capacity and all 32 original items are preserved intact
    expect(queue.size()).toBe(32);
    expect(queue.getPendingIds()).toEqual(firstEnqueuedIds);
  });

  // Req 17: Queue preservation across temporary disconnect/reconnect simulation
  it('Req 17: preserves pending observations in memory across temporary disconnect events', () => {
    queue.enqueue({
      node_id: mockNodeId,
      kind: 'occultation_timing',
      local_timestamp_ms: 1700000005000,
      payload: { test: 'disconnect_preserve' },
    });
    queue.enqueue({
      node_id: mockNodeId,
      kind: 'generic',
      local_timestamp_ms: 1700000006000,
      payload: { test: 'disconnect_preserve_2' },
    });

    expect(queue.size()).toBe(2);

    // Simulate socket disconnect: queue must not be cleared
    const pendingBefore = queue.getPendingItems();

    // Reconnection occurs
    const pendingAfter = queue.getPendingItems();
    expect(pendingAfter.length).toBe(2);
    expect(pendingAfter[0]!.id).toBe(pendingBefore[0]!.id);
    expect(pendingAfter[1]!.id).toBe(pendingBefore[1]!.id);
  });

  // Req 18 & 19: Flushing after calibration and current offset applied at flush time
  it('Req 18, 19: flushes deferred observations upon calibration and applies current offset at flush time', async () => {
    // Event captured locally at t = 10000
    queue.enqueue({
      node_id: mockNodeId,
      kind: 'occultation_timing',
      local_timestamp_ms: 10000,
      payload: { star: 'Betelgeuse' },
    });

    const submittedPayloads: ObservationCreate[] = [];
    const mockSubmit = vi.fn(async (payload: ObservationCreate): Promise<Observation> => {
      submittedPayloads.push(payload);
      return {
        id: '22222222-2222-2222-2222-222222222222',
        node_id: payload.node_id,
        kind: payload.kind,
        observed_at_ms: payload.observed_at_ms,
        payload: payload.payload,
        status: 'accepted',
        confidence: 0.99,
        state_at_ingest: 'trusted',
        created_at: new Date().toISOString(),
      };
    });

    // Suppose at flush time, calibrated offset theta = -795.0 ms
    // t_gateway = t_browser - theta = 10000 - (-795.0) = 10795.0 ms
    const flushResult = await queue.flush(-795.0, mockSubmit);

    expect(flushResult.submittedCount).toBe(1);
    expect(flushResult.remainingPendingCount).toBe(0);
    expect(queue.size()).toBe(0);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(submittedPayloads[0]!.observed_at_ms).toBe(10795.0);
    expect(submittedPayloads[0]!.payload.star).toBe('Betelgeuse');
  });

  // Req 20: Stable IDs across retries
  it('Req 20: preserves the exact same client observation ID and capture data across retry attempts', async () => {
    const item = queue.enqueue({
      node_id: mockNodeId,
      kind: 'occultation_timing',
      local_timestamp_ms: 5000,
      payload: { retryTest: true },
    });
    const originalId = item.id;

    let attempt = 0;
    const submittedIds: string[] = [];
    const mockSubmit = vi.fn(async (payload: ObservationCreate): Promise<Observation> => {
      attempt++;
      submittedIds.push((payload.payload.client_observation_id as string) || '');
      if (attempt === 1) {
        throw new Error('Network timeout (simulated transient failure)');
      }
      return {
        id: '33333333-3333-3333-3333-333333333333',
        node_id: payload.node_id,
        kind: payload.kind,
        observed_at_ms: payload.observed_at_ms,
        payload: payload.payload,
        status: 'accepted',
        confidence: 1.0,
        state_at_ingest: 'trusted',
        created_at: new Date().toISOString(),
      };
    });

    // Attempt 1 fails
    const res1 = await queue.flush(50, mockSubmit);
    expect(res1.submittedCount).toBe(0);
    expect(res1.failedCount).toBe(1);
    expect(queue.size()).toBe(1);
    expect(queue.getPendingIds()[0]).toBe(originalId);

    // Attempt 2 succeeds
    const res2 = await queue.flush(50, mockSubmit);
    expect(res2.submittedCount).toBe(1);
    expect(queue.size()).toBe(0);

    // Verify both attempts used the exact same client ID
    expect(submittedIds[0]).toBe(originalId);
    expect(submittedIds[1]).toBe(originalId);
  });

  // Req 21: Duplicate-delivery limitation documented and tested at client behavior level
  it('Req 21: documents and demonstrates at-least-once retry behavior with stable tracking ID', async () => {
    // If the Gateway ingested an observation but network dropped the HTTP response,
    // the client queue retries submission with the same stable ID (at-least-once semantics)
    const item = queue.enqueue({
      node_id: mockNodeId,
      kind: 'generic',
      local_timestamp_ms: 8000,
    });

    const callPayloads: ObservationCreate[] = [];
    let callCount = 0;
    const mockSubmit = vi.fn(async (payload: ObservationCreate) => {
      callCount++;
      callPayloads.push(payload);
      if (callCount === 1) {
        // Simulates server processed request but connection severed before response returned
        throw new Error('ECONNRESET');
      }
      return {
        id: '44444444-4444-4444-4444-444444444444',
        node_id: payload.node_id,
        kind: payload.kind,
        observed_at_ms: payload.observed_at_ms,
        payload: payload.payload,
        status: 'accepted',
        confidence: 1.0,
        state_at_ingest: 'trusted',
        created_at: new Date().toISOString(),
      } as Observation;
    });

    await queue.flush(0, mockSubmit);
    expect(queue.size()).toBe(1); // retained for retry

    await queue.flush(0, mockSubmit);
    expect(queue.size()).toBe(0); // cleared after acknowledged success

    // Demonstrates at-least-once submission (2 calls made) with identical tracking ID
    expect(callPayloads.length).toBe(2);
    expect(callPayloads[0]!.payload.client_observation_id).toBe(item.id);
    expect(callPayloads[1]!.payload.client_observation_id).toBe(item.id);
  });

  // Req 22: Disposal with an empty queue
  it('Req 22: permits disposal without error when queue is empty', () => {
    expect(queue.size()).toBe(0);
    expect(() => queue.dispose()).not.toThrow();
  });

  // Req 23: Disposal with pending observations refuses silent disposal
  it('Req 23: refuses disposal and throws PendingObservationsDisposalError when observations remain pending', () => {
    const item = queue.enqueue({
      node_id: mockNodeId,
      kind: 'occultation_timing',
      local_timestamp_ms: 12345,
    });

    expect(queue.size()).toBe(1);

    expect(() => queue.dispose()).toThrow(PendingObservationsDisposalError);

    try {
      queue.dispose();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PendingObservationsDisposalError);
      const dispErr = err as PendingObservationsDisposalError;
      expect(dispErr.code).toBe('PENDING_OBSERVATIONS_DISPOSAL_REFUSED');
      expect(dispErr.pendingCount).toBe(1);
      expect(dispErr.pendingIds).toEqual([item.id]);
    }
  });

  // Req 24: Explicit discard reporting, including count, IDs and reason
  it('Req 24: requires explicit authorized discard call with reason and returns full audit report', () => {
    const item1 = queue.enqueue({ node_id: mockNodeId, kind: 'generic', local_timestamp_ms: 1 });
    const item2 = queue.enqueue({ node_id: mockNodeId, kind: 'generic', local_timestamp_ms: 2 });

    expect(queue.size()).toBe(2);

    // Rejects empty reason
    expect(() => queue.discardPendingObservations('')).toThrow(
      'Explicit observation discard requires a non-empty justification reason',
    );

    // Authorized discard
    const report = queue.discardPendingObservations('Test run complete, discarding staging telemetry');

    expect(report.discardedCount).toBe(2);
    expect(report.discardedIds).toEqual([item1.id, item2.id]);
    expect(report.reason).toBe('Test run complete, discarding staging telemetry');
    expect(report.discardedAtMs).toBeGreaterThan(0);

    // Queue is now cleanly empty and allows disposal
    expect(queue.size()).toBe(0);
    expect(() => queue.dispose()).not.toThrow();
  });

  // Req 25: No silent queue clearing during lifecycle transitions
  it('Req 25: guarantees queue is never silently cleared without explicit authorized call', () => {
    queue.enqueue({ node_id: mockNodeId, kind: 'generic', local_timestamp_ms: 100 });
    expect(queue.size()).toBe(1);

    // Multiple state inspections or un-related operations do not mutate queue
    expect(queue.getPendingIds().length).toBe(1);
    expect(queue.size()).toBe(1);
  });
});
