// TEST-FIXTURE
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  EngineTickInput,
  EngineTickOutput,
  IEngine,
  Assessment,
  Transition,
  UUID,
  Heartbeat,
} from '@chronyx/contracts';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Engine } from '@chronyx/engine';
import type { DatabaseRepositories } from '../core/db/index.js';
import type { AssessmentRow, TransitionRow } from '../core/db/schema.js';
import type { Server } from 'socket.io';

describe('P1-T4 Orchestrator Core & Real-Node Pipeline', () => {
  let nodeRegistry: NodeRegistry;
  let stubEngine: Engine;
  let mockEngine: IEngine;
  let mockDb: DatabaseRepositories;
  let mockIo: Server;
  let emittedEvents: Array<{ event: string; payload: unknown }>;
  let persistedAssessments: unknown[];
  let persistedTransitions: unknown[];

  const testNodeId = '11111111-1111-4111-8111-111111111111' as UUID;
  const testNodePublicKey = 'MCowBQYDK2VwAyEANode111111111111111111111111111111111111=';

  beforeEach(async () => {
    nodeRegistry = new NodeRegistry();
    stubEngine = new Engine();
    emittedEvents = [];
    persistedAssessments = [];
    persistedTransitions = [];

    // Setup node in registry
    await nodeRegistry.registerNode({
      id: testNodeId,
      name: 'Observatory-Node-1',
      kind: 'browser',
      public_key: testNodePublicKey,
    });

    // Mock Database Repositories
    mockDb = {
      assessments: {
        create: vi.fn(async (data: unknown) => {
          persistedAssessments.push(data);
          return data as unknown as AssessmentRow;
        }),
        listByNode: vi.fn(async () => []),
      },
      transitions: {
        create: vi.fn(async (data: unknown) => {
          persistedTransitions.push(data);
          return data as unknown as TransitionRow;
        }),
        listByNode: vi.fn(async () => []),
      },
      nodes: {} as unknown as DatabaseRepositories['nodes'],
      heartbeats: {} as unknown as DatabaseRepositories['heartbeats'],
      incidents: {} as unknown as DatabaseRepositories['incidents'],
      faults: {} as unknown as DatabaseRepositories['faults'],
      observations: {} as unknown as DatabaseRepositories['observations'],
      benchmarkRuns: {} as unknown as DatabaseRepositories['benchmarkRuns'],
      anchors: {} as unknown as DatabaseRepositories['anchors'],
      config: {} as unknown as DatabaseRepositories['config'],
    } as unknown as DatabaseRepositories;

    // Mock Socket.IO Server
    mockIo = {
      to: vi.fn((_room: string) => ({
        emit: vi.fn((event: string, payload: unknown) => {
          emittedEvents.push({ event, payload });
        }),
      })),
    } as unknown as Server;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. A tick builds a valid EngineTickInput from real Gateway node state
  it('builds a valid EngineTickInput from real Gateway node state', async () => {
    const fixedNow = 1700000000000;
    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
      now: () => fixedNow,
    });

    // Advance node state with a sample
    nodeRegistry.advanceChain(testNodeId, 0, 'hash000', {
      node_id: testNodeId,
      seq: 0,
      t_local_ms: fixedNow - 10,
      server_rx_ms: fixedNow - 5,
      peer_offset_ms: 2.5,
      osc_residual_ms: 0.12,
      health: { cn0_dbhz: 42.0, agc_db: 18.0 },
      hash: 'hash000',
    });

    const tickInput = orchestrator.buildEngineTickInput(fixedNow);

    expect(tickInput.now_ms).toBe(fixedNow);
    expect(tickInput.nodes.length).toBe(1);
    expect(tickInput.nodes[0]).toEqual({
      node_id: testNodeId,
      online: true,
      peer_offset_ms: 2.5,
      osc_residual_ms: 0.12,
      gnss_resid_ms: null,
      camera_resid_ms: null,
      health: { cn0_dbhz: 42.0, agc_db: 18.0 },
      integrity: {
        bad_signature: false,
        chain_break: false,
        heartbeat_gap: false,
      },
    });
    expect(tickInput.anchor).toEqual({
      ok: true,
      offset_ms: null,
      sigma_ms: null,
    });
  });

  // 2. The engine receives the expected input
  it('passes the constructed EngineTickInput directly to the engine', async () => {
    let receivedInput: EngineTickInput | null = null;
    mockEngine = {
      tick: vi.fn((input: EngineTickInput) => {
        receivedInput = input;
        return stubEngine.tick(input);
      }),
      reset: vi.fn(),
      setConfig: vi.fn(),
      getConfig: vi.fn(() => stubEngine.getConfig()),
    };

    const fixedNow = 1700000001000;
    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: mockEngine,
      now: () => fixedNow,
    });

    await orchestrator.tick();

    expect(mockEngine.tick).toHaveBeenCalledTimes(1);
    expect(receivedInput).not.toBeNull();
    expect(receivedInput!.now_ms).toBe(fixedNow);
    expect(receivedInput!.nodes[0]?.node_id).toBe(testNodeId);
  });

  // 3. Engine output is handled according to its frozen type
  it('handles and records EngineTickOutput according to frozen contracts', async () => {
    nodeRegistry.markNodeConnected(testNodeId, 'test-socket');
    const fixedNow = 1700000002000;
    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
      now: () => fixedNow,
    });

    const output = await orchestrator.tick();

    expect(output.now_ms).toBe(fixedNow);
    expect(Array.isArray(output.assessments)).toBe(true);
    expect(Array.isArray(output.transitions)).toBe(true);
    expect(output.network).toBeDefined();
    expect(output.network.score).toBe(50);

    const state = orchestrator.getState();
    expect(state.lastTickMs).toBe(fixedNow);
    expect(state.latestNetwork).toEqual(output.network);
    expect(state.latestAssessments.get(testNodeId)).toBeDefined();
  });

  // 4. Successful results are persisted through typed repositories
  it('persists assessments and transitions into typed repositories', async () => {
    const testAssessment: Assessment = {
      node_id: testNodeId,
      t_ms: 1700000003000,
      state: 'trusted',
      error_est_ms: 1.2,
      sigma_ms: 0.25,
      z: 0.4,
      cusum: 0.1,
      confidence: 0.99,
      streams: [],
      reasons: [],
      suspected_cause: 'none',
      quarantined_since_ms: null,
    };

    const testTransition: Transition = {
      node_id: testNodeId,
      from: 'recovering',
      to: 'trusted',
      at_ms: 1700000003000,
      reasons: ['RECOVERY_BAND_OK'],
      error_est_ms: 1.2,
    };

    mockEngine = {
      tick: vi.fn((input: EngineTickInput): EngineTickOutput => ({
        now_ms: input.now_ms,
        assessments: [testAssessment],
        transitions: [testTransition],
        network: {
          score: 100,
          n: 1,
          trusted: 1,
          suspect: 0,
          quarantined: 0,
          recovering: 0,
          fault_tolerance_f: 0,
          anchor_ok: true,
        },
        consensus_ms: 0,
      })),
      reset: vi.fn(),
      setConfig: vi.fn(),
      getConfig: vi.fn(() => stubEngine.getConfig()),
    };

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: mockEngine,
      db: mockDb,
      now: () => 1700000003000,
    });

    await orchestrator.tick();

    expect(mockDb.assessments.create).toHaveBeenCalledTimes(1);
    expect(persistedAssessments[0]).toMatchObject({
      node_id: testNodeId,
      t_ms: 1700000003000,
      state: 'trusted',
      error_est_ms: 1.2,
    });

    expect(mockDb.transitions.create).toHaveBeenCalledTimes(1);
    expect(persistedTransitions[0]).toMatchObject({
      node_id: testNodeId,
      at_ms: 1700000003000,
      from_state: 'recovering',
      to_state: 'trusted',
      reasons: ['RECOVERY_BAND_OK'],
    });
  });

  // 5. Dashboard broadcasts use the correct frozen event names and payloads
  it('broadcasts dashboard events matching frozen event names and shapes', async () => {
    const testAssessment: Assessment = {
      node_id: testNodeId,
      t_ms: 1700000004000,
      state: 'suspect',
      error_est_ms: 5.5,
      sigma_ms: 0.5,
      z: 3.8,
      cusum: 2.1,
      confidence: 0.6,
      streams: [],
      reasons: ['CUSUM_DRIFT'],
      suspected_cause: 'local_clock',
      quarantined_since_ms: null,
    };

    const testTransition: Transition = {
      node_id: testNodeId,
      from: 'trusted',
      to: 'suspect',
      at_ms: 1700000004000,
      reasons: ['CUSUM_DRIFT'],
      error_est_ms: 5.5,
    };

    mockEngine = {
      tick: vi.fn((input: EngineTickInput): EngineTickOutput => ({
        now_ms: input.now_ms,
        assessments: [testAssessment],
        transitions: [testTransition],
        network: {
          score: 80,
          n: 1,
          trusted: 0,
          suspect: 1,
          quarantined: 0,
          recovering: 0,
          fault_tolerance_f: 0,
          anchor_ok: true,
        },
        consensus_ms: 0,
      })),
      reset: vi.fn(),
      setConfig: vi.fn(),
      getConfig: vi.fn(() => stubEngine.getConfig()),
    };

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: mockEngine,
      io: mockIo,
      now: () => 1700000004000,
    });

    await orchestrator.tick();

    expect(mockIo.to).toHaveBeenCalledWith('dashboard');
    expect(emittedEvents.some((e) => e.event === SOCKET_EVENTS.ASSESSMENTS)).toBe(true);
    expect(emittedEvents.some((e) => e.event === SOCKET_EVENTS.TRANSITION)).toBe(true);

    const assessEvent = emittedEvents.find((e) => e.event === SOCKET_EVENTS.ASSESSMENTS);
    expect(assessEvent?.payload).toEqual(
      expect.objectContaining({
        assessments: [testAssessment],
      }),
    );

    const transEvent = emittedEvents.find((e) => e.event === SOCKET_EVENTS.TRANSITION);
    expect(transEvent?.payload).toEqual(testTransition);
  });

  // 6. An engine failure does not corrupt the next tick
  it('recovers gracefully from an engine error on subsequent ticks', async () => {
    let shouldFail = true;
    mockEngine = {
      tick: vi.fn((input: EngineTickInput) => {
        if (shouldFail) {
          throw new Error('Engine numerical singularity');
        }
        return stubEngine.tick(input);
      }),
      reset: vi.fn(),
      setConfig: vi.fn(),
      getConfig: vi.fn(() => stubEngine.getConfig()),
    };

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: mockEngine,
      now: () => 1700000005000,
    });

    // First tick throws
    await expect(orchestrator.tick()).rejects.toThrow('Engine numerical singularity');

    // Second tick succeeds
    shouldFail = false;
    const output = await orchestrator.tick(1700000006000);
    expect(output).toBeDefined();
    expect(output.now_ms).toBe(1700000006000);
  });

  // 7. A database failure is surfaced and does not falsely mark persistence successful
  it('surfaces database persistence failures without falsely marking state persisted', async () => {
    const dbErrorRepo: DatabaseRepositories = {
      ...mockDb,
      assessments: {
        create: vi.fn(async () => {
          throw new Error('Postgres connection pool exhausted');
        }),
        listByNode: vi.fn(async () => []),
      },
    } as unknown as DatabaseRepositories;

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
      db: dbErrorRepo,
      now: () => 1700000007000,
    });

    await expect(orchestrator.tick()).rejects.toThrow('Postgres connection pool exhausted');
    // Ensure state was not recorded as successfully tick-persisted
    expect(orchestrator.getState().lastTickMs).toBeNull();
  });

  // 8. Two ticks cannot execute concurrently
  it('prevents overlapping concurrent tick execution with a lock guard', async () => {
    let resolveTick: () => void;
    const blockPromise = new Promise<void>((r) => {
      resolveTick = r;
    });

    mockEngine = {
      tick: vi.fn((input: EngineTickInput) => {
        return stubEngine.tick(input);
      }),
      reset: vi.fn(),
      setConfig: vi.fn(),
      getConfig: vi.fn(() => stubEngine.getConfig()),
    };

    const slowDb: DatabaseRepositories = {
      ...mockDb,
      assessments: {
        create: vi.fn(async () => {
          await blockPromise;
          return {} as unknown as AssessmentRow;
        }),
        listByNode: vi.fn(async () => []),
      },
    } as unknown as DatabaseRepositories;

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: mockEngine,
      db: slowDb,
      now: () => 1700000008000,
    });

    // Launch first tick (which blocks on slowDb)
    const tick1 = orchestrator.tick();

    // Launch concurrent second tick while tick1 is in flight
    await expect(orchestrator.tick()).rejects.toThrow('Concurrent tick execution prevented');

    // Unblock tick1
    resolveTick!();
    await tick1;
  });

  // 9. Start and stop lifecycle behavior works correctly
  it('manages timer lifecycle correctly on start() and stop()', () => {
    vi.useFakeTimers();

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
    });

    const tickSpy = vi
      .spyOn(orchestrator, 'tick')
      .mockResolvedValue({} as unknown as EngineTickOutput);

    orchestrator.start(1000);

    // Fast forward 3 seconds
    vi.advanceTimersByTime(3100);
    expect(tickSpy).toHaveBeenCalledTimes(3);

    // Calling start again does not create duplicate timers
    orchestrator.start(1000);
    vi.advanceTimersByTime(1000);
    expect(tickSpy).toHaveBeenCalledTimes(4);

    // Stop cleans up timer
    orchestrator.stop();
    vi.advanceTimersByTime(2000);
    expect(tickSpy).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  // 10. Missing Gateway measurements are not fabricated
  it('never fabricates missing measurements for nodes without samples', () => {
    const unheartbeatedNodeId = '22222222-2222-4222-8222-222222222222' as UUID;
    nodeRegistry.registerNode({
      id: unheartbeatedNodeId,
      name: 'Unconnected-Node',
      kind: 'browser',
      public_key: 'MCowBQYDK2VwAyEANode222222222222222222222222222222222222=',
    });

    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
    });

    const tickInput = orchestrator.buildNodeTickInput(unheartbeatedNodeId, 1700000009000);

    expect(tickInput).not.toBeNull();
    // Missing measurements must remain null, never invented
    expect(tickInput!.peer_offset_ms).toBeNull();
    expect(tickInput!.osc_residual_ms).toBeNull();
    expect(tickInput!.gnss_resid_ms).toBeNull();
    expect(tickInput!.camera_resid_ms).toBeNull();
    expect(tickInput!.health).toBeNull();
  });

  // 11. A stub engine is not misreported as the real engine
  it('accurately identifies whether the configured engine is real or stub', () => {
    class StubEngine implements IEngine {
      tick(input: EngineTickInput): EngineTickOutput {
        return stubEngine.tick(input);
      }
      reset(): void {}
      setConfig(): void {}
      getConfig() {
        return stubEngine.getConfig();
      }
    }

    const orchestratorWithStub = new Orchestrator({
      nodeRegistry,
      engine: new StubEngine(),
    });
    expect(orchestratorWithStub.isRealEngine()).toBe(false);

    const orchestratorWithReal = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
    });
    expect(orchestratorWithReal.isRealEngine()).toBe(true);
  });

  // 12. Invalid or unsigned virtual-node data cannot bypass Gateway verification
  it('strictly rejects unverified or mock-signed virtual node heartbeats at the Gateway boundary', async () => {
    const heartbeatService = new HeartbeatService(nodeRegistry);

    // A simulated virtual node heartbeat with a dummy/mock signature (as produced by StubSim)
    const mockSignedSimHeartbeat: Heartbeat = {
      node_id: testNodeId,
      seq: 0,
      t_local_ms: 1700000010000,
      prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
      exchange: [{ t1: 1700000010000, t2: 1700000010001, t3: 1700000010002, t4: 1700000010003 }],
      osc_residual_ms: 0.01,
      health: { cn0_dbhz: 45.0, agc_db: 20.0 },
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sig: 'dGVzdF9zaWduYXR1cmU=', // Dummy mock signature
    };

    // Attempting to ingest unverified/mock virtual heartbeat MUST be rejected with BAD_SIGNATURE
    const ack = await heartbeatService.verifyAndIngest(mockSignedSimHeartbeat);
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.code).toBe('BAD_SIGNATURE');
    }

    // Confirm that the node's expected sequence remains 0 and was not advanced
    expect(nodeRegistry.getExpectedSeq(testNodeId)).toBe(0);

    // Confirm orchestrator gate reports virtual node ingest as gated
    const orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
    });
    expect(orchestrator.isVirtualNodeIngestGated()).toBe(true);
  });
});
