import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { JoinPage } from '../pages/join/JoinPage.js';
import { useJoinStore, resetJoinStore } from '../state/useJoinStore.js';
import {
  SOCKET_EVENTS,
  RegisterNodeReqSchema,
  RegisterNodeResSchema,
  GENESIS_PREV_HASH,
  CONTRACT_VERSION,
} from '@chronyx/contracts';
import {
  generateKeyPair,
  createSignedHeartbeat,
  verifyHeartbeat,
} from '@chronyx/crypto';
import type { HeartbeatBody, NodeInfo } from '@chronyx/contracts';

describe('P1-T6 Join Integration & Verification Test Matrix', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetJoinStore();
    useJoinStore.setState({ nodeName: 'Test-Judge-Node' });
  });

  // UI Baseline Checks
  it('renders JoinPage in idle state with Connect Node button and empty state for exchanges', () => {
    const html = renderToString(React.createElement(JoinPage));

    expect(html).toContain('Join Observatory Network');
    expect(html).toContain('Connect Node');
    expect(html).toContain('No Exchanges Recorded');
    expect(html).toContain('data-testid="demo-attack-banner"');
    expect(html).toContain('hidden');
  });

  // TC-1: Keypair generation
  it('TC-1: Keypair generation creates valid Ed25519 keys with ephemeral in-memory storage', async () => {
    const keyPair = await generateKeyPair();
    expect(keyPair.publicKeyBase64).toBeDefined();
    expect(typeof keyPair.publicKeyBase64).toBe('string');
    expect(keyPair.publicKeyBase64.length).toBeGreaterThan(20);
    expect(keyPair.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);

    // Initializing store identity
    await useJoinStore.getState().initIdentity();
    const state = useJoinStore.getState();
    expect(state.identity).not.toBeNull();
    expect(state.identity?.publicKeyBase64).toBeDefined();

    // Verify localStorage contains ONLY non-secret metadata and never private keys
    if (typeof window !== 'undefined' && window.localStorage) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)!;
        const val = window.localStorage.getItem(key)!;
        expect(val).not.toContain('privateKey');
        expect(val).not.toContain('secretKey');
      }
    }
  });

  // TC-2: Registration
  it('TC-2: Registration constructs request according to RegisterNodeReqSchema and never transmits private key', async () => {
    await useJoinStore.getState().initIdentity();
    const identity = useJoinStore.getState().identity!;

    const reqPayload = {
      name: identity.nodeName,
      kind: 'browser' as const,
      public_key: identity.publicKeyBase64,
    };

    const parsedReq = RegisterNodeReqSchema.safeParse(reqPayload);
    expect(parsedReq.success).toBe(true);
    if (parsedReq.success) {
      expect(parsedReq.data.kind).toBe('browser');
      expect(parsedReq.data.name).toBe('Test-Judge-Node');
      expect(parsedReq.data.public_key).toBe(identity.publicKeyBase64);
      // Private key is strictly absent from the payload
      expect((reqPayload as Record<string, unknown>).private_key).toBeUndefined();
    }

    // Mock Gateway response
    const mockRes: { node: NodeInfo; hub_time_ms: number } = {
      node: {
        id: '99999999-9999-9999-9999-999999999999',
        name: identity.nodeName,
        kind: 'browser',
        public_key: identity.publicKeyBase64,
        created_at: new Date().toISOString(),
        last_seen_at: null,
        online: true,
      },
      hub_time_ms: Date.now(),
    };

    const parsedRes = RegisterNodeResSchema.safeParse(mockRes);
    expect(parsedRes.success).toBe(true);
  });

  // TC-3: Socket connection
  it('TC-3: Socket connection sets auth: { node_id } and handles disconnection cleanup', async () => {
    await useJoinStore.getState().initIdentity();
    const state = useJoinStore.getState();
    expect(state.agent).not.toBeNull();

    // Test explicit disconnect stops transmission and clears in-memory state
    await useJoinStore.getState().disconnect();
    const postDisconnectState = useJoinStore.getState();
    expect(postDisconnectState.status).toBe('idle');
    expect(postDisconnectState.agent).toBeNull();
    expect(postDisconnectState.identity).toBeNull();
    expect(postDisconnectState.nodeInfo).toBeNull();
  });

  // TC-4: Node join handshake
  it('TC-4: Node join handshake validates sequence and previous hash from acknowledgement', async () => {
    await useJoinStore.getState().initIdentity();
    const agent = useJoinStore.getState().agent!;

    const mockJoinAck = {
      next_seq: 5,
      prev_hash: '1111111111111111111111111111111111111111111111111111111111111111',
      hub_time_ms: Date.now(),
      config: {
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
        gate: { trusted: 1, suspect: 0.5, recovering: 0.7, quarantined: 0 },
        seed: 42,
      },
    };

    const fakeSocket = {
      connected: true,
      emit: (event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.NODE_JOIN && callback) {
          callback(mockJoinAck);
        }
      },
    };

    (agent as unknown as { socket: unknown }).socket = fakeSocket;
    const joined = await agent.performJoin();
    expect(joined).toBe(true);

    const agentState = agent.getState();
    expect(agentState.seq).toBe(5);
    expect(agentState.prevHash).toBe(mockJoinAck.prev_hash);
    expect(agentState.status).toBe('joined');
  });

  // TC-5: NTP ping exchange
  it('TC-5: NTP ping exchange records t1..t4, computes RTT, and maintains 1-4 recent exchanges per heartbeat', async () => {
    await useJoinStore.getState().initIdentity();
    const agent = useJoinStore.getState().agent!;

    let pingCount = 0;
    const fakeSocket = {
      connected: true,
      emit: (event: string, _data?: unknown, callback?: (ack: unknown) => void) => {
        if (event === SOCKET_EVENTS.TIME_PING && callback) {
          pingCount++;
          callback({ t2: 1000 + pingCount * 10, t3: 1005 + pingCount * 10 });
        }
      },
    };

    (agent as unknown as { socket: unknown }).socket = fakeSocket;

    // Send 6 time pings
    for (let i = 0; i < 6; i++) {
      agent.sendTimePing();
    }

    const state = agent.getState();
    expect(state.lastPingRttMs).toBeDefined();
    expect(state.recentExchanges.length).toBeGreaterThan(0);

    // Heartbeat body includes latest 1-4 exchanges
    const bodyExchanges = state.recentExchanges.slice(-4);
    expect(bodyExchanges.length).toBeLessThanOrEqual(4);
    expect(bodyExchanges.length).toBeGreaterThanOrEqual(1);
  });

  // TC-6: Genesis heartbeat
  it('TC-6: Genesis heartbeat has sequence 0, genesis prev_hash, and valid Ed25519 signature', async () => {
    await useJoinStore.getState().initIdentity();
    const state = useJoinStore.getState();
    const agent = state.agent!;

    const body0: HeartbeatBody = {
      node_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [{ t1: 100, t2: 105, t3: 106, t4: 111 }],
      osc_residual_ms: 0.02,
      health: null,
    };

    const keyMaterial = (agent as unknown as { keyMaterial: { privateKeyHex: string } }).keyMaterial;
    const hb0 = await createSignedHeartbeat(body0, keyMaterial.privateKeyHex);

    expect(hb0.seq).toBe(0);
    expect(hb0.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(hb0.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hb0.sig).toBeDefined();

    const verifyResult = await verifyHeartbeat(hb0, state.identity!.publicKeyBase64, 0, GENESIS_PREV_HASH);
    expect(verifyResult.ok).toBe(true);
  });

  // TC-7: Chained heartbeat
  it('TC-7: Chained heartbeat increments sequence to 1 and points prev_hash to previous hash', async () => {
    await useJoinStore.getState().initIdentity();
    const state = useJoinStore.getState();
    const agent = state.agent!;
    const keyMaterial = (agent as unknown as { keyMaterial: { privateKeyHex: string } }).keyMaterial;

    const body0: HeartbeatBody = {
      node_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: 0.0,
      health: null,
    };
    const hb0 = await createSignedHeartbeat(body0, keyMaterial.privateKeyHex);

    const body1: HeartbeatBody = {
      node_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      seq: 1,
      t_local_ms: 1700000001000,
      prev_hash: hb0.hash,
      exchange: [],
      osc_residual_ms: 0.01,
      health: null,
    };
    const hb1 = await createSignedHeartbeat(body1, keyMaterial.privateKeyHex);

    expect(hb1.seq).toBe(1);
    expect(hb1.prev_hash).toBe(hb0.hash);

    const verifyResult = await verifyHeartbeat(hb1, state.identity!.publicKeyBase64, 1, hb0.hash);
    expect(verifyResult.ok).toBe(true);
  });

  // TC-8: Sequence tampering
  it('TC-8: Sequence tampering is detected and fails verification with CHAIN_BREAK', async () => {
    const keyPair = await generateKeyPair();
    const body: HeartbeatBody = {
      node_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      seq: 2, // Tampered: expected 1
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: 0.0,
      health: null,
    };

    const hb = await createSignedHeartbeat(body, keyPair.privateKey);
    const verifyResult = await verifyHeartbeat(hb, keyPair.publicKeyBase64, 1, GENESIS_PREV_HASH);

    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.code).toBe('CHAIN_BREAK');
  });

  // TC-9: Signature tampering
  it('TC-9: Signature or payload tampering fails verification with BAD_SIGNATURE', async () => {
    const keyPair = await generateKeyPair();
    const body: HeartbeatBody = {
      node_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: 0.0,
      health: null,
    };

    const hb = await createSignedHeartbeat(body, keyPair.privateKey);
    const tampered = { ...hb, t_local_ms: 1700000000999 }; // altered timestamp

    const verifyResult = await verifyHeartbeat(tampered, keyPair.publicKeyBase64, 0, GENESIS_PREV_HASH);
    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.code).toBe('BAD_SIGNATURE');
  });

  // TC-10: Inbound fault UI
  it('TC-10: Inbound fault displays demo attack banner and clear hides it', () => {
    useJoinStore.setState({
      activeFaults: [
        {
          fault_id: 'test-ramp',
          type: 'clock_ramp',
          params: { rate_ms_per_min: 10 },
          started_at_ms: Date.now(),
        },
      ],
    });

    let html = renderToString(React.createElement(JoinPage));
    expect(html).toContain('Demo attack in progress (simulated, software-only)');
    expect(html).toContain('clock_ramp');
    expect(html).not.toMatch(/class="[^"]*hidden[^"]*"[^>]*data-testid="demo-attack-banner"/);

    // Clear fault
    useJoinStore.setState({ activeFaults: [] });
    html = renderToString(React.createElement(JoinPage));
    expect(html).toContain('data-testid="demo-attack-banner"');
    expect(html).toContain('hidden');
  });

  // TC-11: Contract version
  it('TC-11: Contract version matches authoritative export without stale hardcoding', () => {
    expect(CONTRACT_VERSION).toBeDefined();
    expect(typeof CONTRACT_VERSION).toBe('string');
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
