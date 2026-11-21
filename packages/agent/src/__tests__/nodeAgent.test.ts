import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io-client';
import { NodeAgent } from '../nodeAgent.js';
import { clearIdentity } from '../identity.js';
import { GENESIS_PREV_HASH, SOCKET_EVENTS } from '@chronyx/contracts';
import type { Heartbeat, EngineConfig } from '@chronyx/contracts';
import { verifyHeartbeat } from '@chronyx/crypto';

interface MockSocket {
  connected: boolean;
  emit: (event: string, data?: unknown, callback?: (ack: unknown) => void) => unknown;
}

const mockEngineConfig: EngineConfig = {
  tolerance_ms: 10,
  z_suspect: 3.5,
  z_quarantine: 5,
  suspect_min_ticks: 2,
  quarantine_min_ticks: 3,
  cusum_k_sigma: 0.5,
  cusum_h_sigma: 11.4,
  recover_band_sigma: 2,
  recover_ticks: 30,
  trusted_after_ticks: 60,
  min_sigma_ms: 0.25,
  mad_window_s: 300,
  osc_window_s: 60,
  heartbeat_timeout_s: 5,
  gate: {
    trusted: 1,
    suspect: 0.5,
    recovering: 0.7,
    quarantined: 0,
  },
  seed: 42,
};

describe('NodeAgent Protocols, Security & Chain Reliability (P3-T2)', () => {
  const TEST_STORAGE_KEY = 'test_agent_storage_p3t2';
  const mockNodeInfo = {
    id: '99999999-9999-9999-9999-999999999999',
    name: 'Browser-Alpha',
    kind: 'browser',
    public_key: 'test_pubkey_base64==',
    created_at: new Date().toISOString(),
    last_seen_at: null,
    online: true,
  };

  beforeEach(() => {
    clearIdentity(TEST_STORAGE_KEY);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/api/v1/nodes/register')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            node: mockNodeInfo,
            hub_time_ms: 1700000000000,
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
  });

  it('performs registration request and parses valid Gateway response', async () => {
    const agent = new NodeAgent({
      baseUrl: 'http://localhost:3000',
      storageKey: TEST_STORAGE_KEY,
      nodeName: 'Browser-Alpha',
    });

    const node = await agent.register();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/nodes/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(node.id).toBe(mockNodeInfo.id);
    expect(agent.getState().identity?.nodeId).toBe(mockNodeInfo.id);
  });

  it('handles validated node:join handshake and sets up sequence and genesis prev_hash', async () => {
    const agent = new NodeAgent({ storageKey: TEST_STORAGE_KEY });
    const fakeSocket: MockSocket = {
      connected: true,
      emit: (event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.NODE_JOIN && callback) {
          callback({
            next_seq: 10,
            prev_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            hub_time_ms: 1700000000000,
            config: mockEngineConfig,
          });
        }
      },
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;
    const joined = await agent.performJoin();

    expect(joined).toBe(true);
    const state = agent.getState();
    expect(state.status).toBe('joined');
    expect(state.seq).toBe(10);
    expect(state.prevHash).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
  });

  it('rejects malformed join acknowledgement without starting loops', async () => {
    const agent = new NodeAgent({ storageKey: TEST_STORAGE_KEY });
    const fakeSocket: MockSocket = {
      connected: true,
      emit: (event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.NODE_JOIN && callback) {
          // Missing config and bad prev_hash
          callback({
            next_seq: -1,
            prev_hash: 'bad-hash',
            hub_time_ms: 1700000000000,
          });
        }
      },
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;
    const joined = await agent.performJoin();

    expect(joined).toBe(false);
    const state = agent.getState();
    expect(state.status).toBe('error');
    expect(state.errorMessage).toContain('Malformed join acknowledgement');
  });

  it('retains only the latest eight valid time-ping exchanges and drops stale pings', () => {
    const agent = new NodeAgent({ storageKey: TEST_STORAGE_KEY });
    let pingCount = 0;

    const fakeSocket: MockSocket = {
      connected: true,
      emit: (event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.TIME_PING && callback) {
          pingCount++;
          callback({ t2: 1000 + pingCount * 10, t3: 1005 + pingCount * 10 });
        }
      },
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;

    // Send 12 time pings
    for (let i = 0; i < 12; i++) {
      agent.sendTimePing();
    }

    const state = agent.getState();
    expect(state.recentExchanges.length).toBe(8);
    const last = state.recentExchanges[7]!;
    expect(last.t2).toBe(1000 + 12 * 10);
  });

  it('advances seq and prevHash ONLY on accepted acknowledgement (ok: true)', async () => {
    const agent = new NodeAgent({ storageKey: TEST_STORAGE_KEY });
    const identity = await agent.register();

    let submittedHeartbeat: Heartbeat | null = null;
    const fakeSocket: MockSocket = {
      connected: true,
      emit: (event: string, data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.HEARTBEAT && callback) {
          submittedHeartbeat = data as Heartbeat;
          callback({ ok: true, server_rx_ms: 1700000000500 });
        }
      },
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;
    expect(agent.getState().seq).toBe(0);
    expect(agent.getState().prevHash).toBe(GENESIS_PREV_HASH);

    const ack = await agent.sendHeartbeat();
    expect(ack?.ok).toBe(true);

    expect(submittedHeartbeat).toBeDefined();
    expect(submittedHeartbeat!.node_id).toBe(identity.id);
    expect(submittedHeartbeat!.seq).toBe(0);
    expect(submittedHeartbeat!.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(submittedHeartbeat!.hash).toMatch(/^[0-9a-f]{64}$/);

    const verification = await verifyHeartbeat(
      submittedHeartbeat!,
      agent.getState().identity!.publicKeyBase64,
      0,
      GENESIS_PREV_HASH,
    );
    expect(verification.ok).toBe(true);

    // Chain advances
    const state = agent.getState();
    expect(state.seq).toBe(1);
    expect(state.prevHash).toBe(submittedHeartbeat!.hash);
  });

  it('preserves local seq and prevHash unchanged on rejected acknowledgement without auto-sync', async () => {
    const agent = new NodeAgent({ storageKey: TEST_STORAGE_KEY });
    await agent.register();

    const fakeSocket: MockSocket = {
      connected: true,
      emit: (event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.HEARTBEAT && callback) {
          callback({
            ok: false,
            code: 'CHAIN_BREAK',
            expected_seq: 4,
            expected_prev_hash: '1111111111111111111111111111111111111111111111111111111111111111',
          });
        }
      },
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;

    const initialSeq = agent.getState().seq;
    const initialPrevHash = agent.getState().prevHash;

    const ack = await agent.sendHeartbeat();
    expect(ack?.ok).toBe(false);

    // Chain state must NOT advance and must NOT auto-sync to server expected values
    const state = agent.getState();
    expect(state.seq).toBe(initialSeq);
    expect(state.prevHash).toBe(initialPrevHash);
    expect(state.lastHeartbeatAck?.ok).toBe(false);
  });

  it('handles bounded acknowledgement timeout and releases in-flight lock without advancing chain', async () => {
    const agent = new NodeAgent({
      storageKey: TEST_STORAGE_KEY,
      ackTimeoutMs: 50, // Short timeout for test
    });
    await agent.register();

    // Socket never calls callback (simulating dropped ack)
    const fakeSocket: MockSocket = {
      connected: true,
      emit: vi.fn(),
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;

    const initialSeq = agent.getState().seq;
    const initialPrevHash = agent.getState().prevHash;

    const ack = await agent.sendHeartbeat();
    expect(ack?.ok).toBe(false);

    // Chain not advanced
    expect(agent.getState().seq).toBe(initialSeq);
    expect(agent.getState().prevHash).toBe(initialPrevHash);

    // In-flight lock is released, allowing a subsequent attempt
    const fakeSocket2: MockSocket = {
      connected: true,
      emit: (_event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (callback) {
          callback({ ok: true, server_rx_ms: 1700000000999 });
        }
      },
    };
    (agent as unknown as { socket: Socket | null }).socket = fakeSocket2 as unknown as Socket;

    const ack2 = await agent.sendHeartbeat();
    expect(ack2?.ok).toBe(true);
    expect(agent.getState().seq).toBe(initialSeq + 1);
  });

  it('discards delayed acknowledgements arriving after timeout', async () => {
    const agent = new NodeAgent({
      storageKey: TEST_STORAGE_KEY,
      ackTimeoutMs: 30,
    });
    await agent.register();

    let delayedCallback: ((ack: unknown) => void) | null = null;
    const fakeSocket: MockSocket = {
      connected: true,
      emit: (_event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        delayedCallback = callback || null;
      },
    };

    (agent as unknown as { socket: Socket | null }).socket = fakeSocket as unknown as Socket;

    // Trigger timeout
    await agent.sendHeartbeat();
    expect(agent.getState().seq).toBe(0);

    // Late ack arrives after timeout has settled
    if (delayedCallback) {
      (delayedCallback as (ack: unknown) => void)({ ok: true, server_rx_ms: 1700000001000 });
    }

    // Must still remain at seq 0 (late response was safely discarded)
    expect(agent.getState().seq).toBe(0);
  });
});
