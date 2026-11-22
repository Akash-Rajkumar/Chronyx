import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SOCKET_EVENTS, mockSnapshot, mockAssessment } from '@chronyx/contracts';
import { useDashboardStore } from '../state/useDashboardStore.js';

// Create a mock socket implementing EventEmitter
class MockSocket extends EventEmitter {
  public connected = true;
  public auth: Record<string, unknown> = {};
  public clientEmitted: Array<{ event: string; args: unknown[] }> = [];
  public disconnect = vi.fn();

  // Client-to-server emit mock
  public clientEmit(event: string, ...args: unknown[]) {
    this.clientEmitted.push({ event, args });
  }

  // Server-to-client event trigger
  public triggerServerEvent(event: string, ...args: unknown[]) {
    return super.emit(event, ...args);
  }
}

let activeMockSocket: MockSocket | null = null;

vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string, opts?: { auth?: Record<string, unknown> }) => {
    activeMockSocket = new MockSocket();
    if (opts?.auth) {
      activeMockSocket.auth = opts.auth;
    }
    return activeMockSocket;
  }),
}));

// Import after vi.mock
import { initDashboardSocket, getDashboardSocket } from '../api/socket.js';

describe('Socket.IO Assessments Server Payload Consumption (P3)', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    useDashboardStore.getState().reset();
    activeMockSocket = null;
    cleanup = null;
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it('connects with dashboard auth role and registers ASSESSMENTS listener', () => {
    cleanup = initDashboardSocket();
    const sock = getDashboardSocket() as unknown as MockSocket;

    expect(sock).not.toBeNull();
    expect(sock?.auth).toEqual({ role: 'dashboard' });
    expect(sock?.listenerCount(SOCKET_EVENTS.ASSESSMENTS)).toBe(1);
  });

  it('consumes server payload { t_ms, assessments, network, baseline } and updates store', () => {
    cleanup = initDashboardSocket();
    const sock = getDashboardSocket() as unknown as MockSocket;
    useDashboardStore.getState().setSnapshot(mockSnapshot);

    const now = 1700000050000;
    const serverPayload = {
      t_ms: now,
      assessments: [
        {
          ...mockAssessment,
          t_ms: now,
          confidence: 0.96,
          error_est_ms: 0.25,
        },
      ],
      network: {
        score: 98,
        n: 8,
        trusted: 7,
        suspect: 1,
        quarantined: 0,
        recovering: 0,
        fault_tolerance_f: 2,
        anchor_ok: true,
      },
      baseline: {
        source: 'model' as const,
        label: 'Live Ensemble Baseline',
        per_node: [
          {
            node_id: mockAssessment.node_id,
            followed_error_ms: 0.1,
            alarm: false as const,
          },
        ],
        cluster_time_error_ms: 0.04,
      },
    };

    // Server emits 1 Hz ticker payload
    sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, serverPayload);

    // Verify all aspects of the store are updated accurately
    const state = useDashboardStore.getState();
    expect(state.serverTimeMs).toBe(now);
    expect(state.network?.score).toBe(98);
    expect(state.network?.anchor_ok).toBe(true);
    expect(state.baseline?.label).toBe('Live Ensemble Baseline');
    expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.96);
    expect(state.assessments[mockAssessment.node_id]?.error_est_ms).toBe(0.25);
    expect(state.assessmentHistory[mockAssessment.node_id]).toContain(0.25);
    expect(state.isLoading).toBe(false);
  });

  it('handles server payload with omitted optional fields defensively without throwing', () => {
    cleanup = initDashboardSocket();
    const sock = getDashboardSocket() as unknown as MockSocket;
    useDashboardStore.getState().setSnapshot(mockSnapshot);
    const initialNetwork = useDashboardStore.getState().network;

    // Server emits payload with only t_ms and assessments (no network, no baseline)
    const partialPayload = {
      t_ms: 1700000060000,
      assessments: [
        {
          ...mockAssessment,
          t_ms: 1700000060000,
          error_est_ms: -0.15,
        },
      ],
    };

    expect(() => {
      sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, partialPayload);
    }).not.toThrow();

    const state = useDashboardStore.getState();
    expect(state.serverTimeMs).toBe(1700000060000);
    expect(state.assessments[mockAssessment.node_id]?.error_est_ms).toBe(-0.15);
    // Unchanged network is preserved
    expect(state.network).toEqual(initialNetwork);
  });

  it('handles malformed server payload without crashing the dashboard', () => {
    cleanup = initDashboardSocket();
    const sock = getDashboardSocket() as unknown as MockSocket;
    useDashboardStore.getState().setSnapshot(mockSnapshot);
    const initialSnapshot = { ...useDashboardStore.getState().assessments };

    expect(() => {
      sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, null);
      sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, undefined);
      sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, 'corrupted_string');
      sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, { corrupted: true });
    }).not.toThrow();

    const state = useDashboardStore.getState();
    expect(state.assessments).toEqual(initialSnapshot);
    expect(state.error).toBeNull();
  });

  it('supports legacy array-shaped payload for backward compatibility', () => {
    cleanup = initDashboardSocket();
    const sock = getDashboardSocket() as unknown as MockSocket;
    useDashboardStore.getState().setSnapshot(mockSnapshot);

    const legacyPayload = [
      {
        ...mockAssessment,
        confidence: 0.88,
      },
    ];

    sock?.triggerServerEvent(SOCKET_EVENTS.ASSESSMENTS, legacyPayload);

    const state = useDashboardStore.getState();
    expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.88);
  });
});
