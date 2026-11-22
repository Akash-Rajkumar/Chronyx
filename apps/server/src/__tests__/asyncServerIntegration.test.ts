// TEST-FIXTURE
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UUID, NodeInfo, ISim, SimNodeOutput, Fault } from '@chronyx/contracts';
import { createServer } from '../server.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Engine } from '@chronyx/engine';

function createMockSim(overrides?: Partial<ISim>): ISim {
  return {
    addVirtualNode: vi.fn(async (name: string): Promise<NodeInfo> => ({
      id: '00000000-0000-0000-0000-000000000001' as UUID,
      name,
      kind: 'virtual',
      public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000001=',
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      online: true,
    })),
    step: vi.fn(async (): Promise<SimNodeOutput[]> => []),
    applyFault: vi.fn((_f: Fault) => {}),
    stopFault: vi.fn((_id: UUID) => {}),
    faultOffsetMs: vi.fn((_node_id: UUID, _now_ms: number) => 0),
    ...overrides,
  };
}

describe('D-001 Step 2: Asynchronous Server & Orchestrator Integration Suite', () => {
  let nodeRegistry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let stubEngine: Engine;

  beforeEach(() => {
    nodeRegistry = new NodeRegistry();
    heartbeatService = new HeartbeatService(nodeRegistry);
    stubEngine = new Engine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Synchronous Server Construction & Readiness Boundary', () => {
    it('constructs server synchronously without blocking on simulator or virtual nodes', () => {
      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        initVirtualNodes: false,
      });

      expect(serverInstance.app).toBeDefined();
      expect(serverInstance.server).toBeDefined();
      expect(serverInstance.io).toBeDefined();
      expect(serverInstance.orchestrator).toBeDefined();
      expect(serverInstance.nodeRegistry).toBe(nodeRegistry);
      expect(typeof serverInstance.init).toBe('function');
    });

    it('resolves async simulator provided as a Promise<ISim>', async () => {
      let simCallCount = 0;
      const mockAsyncSim = createMockSim({
        addVirtualNode: vi.fn(async (name: string): Promise<NodeInfo> => {
          simCallCount++;
          return {
            id: `00000000-0000-0000-0000-00000000000${simCallCount}` as UUID,
            name,
            kind: 'virtual',
            public_key: `MCowBQYDK2VwAyEAAsyncSimKey0000000000000000000000000000${simCallCount}=`,
            created_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            online: true,
          };
        }),
      });

      const asyncSimPromise = Promise.resolve(mockAsyncSim);

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        sim: asyncSimPromise,
        initVirtualNodes: true,
      });

      // Before init, virtual nodes not registered yet
      expect(nodeRegistry.getAllNodes().length).toBe(0);

      // Await readiness boundary
      await serverInstance.init();

      // After init, simulator is resolved and virtual nodes registered
      expect(nodeRegistry.getAllNodes().length).toBe(3);
      expect(mockAsyncSim.addVirtualNode).toHaveBeenCalledTimes(3);
      expect(serverInstance.orchestrator.getSimulator()).toBe(mockAsyncSim);
    });

    it('awaits async addVirtualNode() correctly during initialization', async () => {
      let callCount = 0;
      const mockSim = createMockSim({
        addVirtualNode: vi.fn(async (name: string): Promise<NodeInfo> => {
          callCount++;
          // Simulate microtask delay
          await new Promise((r) => setTimeout(r, 5));
          return {
            id: `00000000-0000-0000-0000-00000000000${callCount}` as UUID,
            name,
            kind: 'virtual',
            public_key: `MCowBQYDK2VwAyEAAsyncKey0000000000000000000000000000000${callCount}=`,
            created_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            online: true,
          };
        }),
      });

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        sim: mockSim,
        initVirtualNodes: true,
      });

      await serverInstance.init();

      const nodes = nodeRegistry.getAllNodes();
      expect(nodes.length).toBe(3);
      expect(nodes[0]!.name).toBe('V-Alpha');
      expect(nodes[1]!.name).toBe('V-Beta');
      expect(nodes[2]!.name).toBe('V-Gamma');
    });

    it('surfaces initialization failure clearly when addVirtualNode rejects', async () => {
      const failingSim = createMockSim({
        addVirtualNode: vi.fn(async (): Promise<NodeInfo> => {
          throw new Error('Simulator hardware fault injection error');
        }),
      });

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        sim: failingSim,
        initVirtualNodes: true,
      });

      await expect(serverInstance.init()).rejects.toThrow('Simulator hardware fault injection error');
      // Server does not leave partially initialized virtual nodes in registry
      expect(nodeRegistry.getAllNodes().length).toBe(0);
    });

    it('prevents duplicate initialization when init() is called concurrently or repeatedly', async () => {
      let callCount = 0;
      const mockSim = createMockSim({
        addVirtualNode: vi.fn(async (name: string): Promise<NodeInfo> => {
          callCount++;
          return {
            id: `00000000-0000-0000-0000-00000000000${callCount}` as UUID,
            name,
            kind: 'virtual',
            public_key: `MCowBQYDK2VwAyEAAsyncKey0000000000000000000000000000000${callCount}=`,
            created_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            online: true,
          };
        }),
      });

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        sim: mockSim,
        initVirtualNodes: true,
      });

      // Call init() three times in parallel
      await Promise.all([
        serverInstance.init(),
        serverInstance.init(),
        serverInstance.init(),
      ]);

      // Exactly 3 virtual nodes registered once
      expect(mockSim.addVirtualNode).toHaveBeenCalledTimes(3);
      expect(nodeRegistry.getAllNodes().length).toBe(3);

      // Call again sequentially
      await serverInstance.init();
      expect(mockSim.addVirtualNode).toHaveBeenCalledTimes(3);
      expect(nodeRegistry.getAllNodes().length).toBe(3);
    });
  });

  describe('Orchestrator Async Simulator Step Integration', () => {
    it('awaits async sim.step(nowMs) during tick() and records outputs', async () => {
      const mockOutputs: SimNodeOutput[] = [
        {
          node: {
            id: '00000000-0000-0000-0000-000000000001' as UUID,
            name: 'V-Alpha',
            kind: 'virtual',
            public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000001=',
            created_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            online: true,
          },
          heartbeat: {
            node_id: '00000000-0000-0000-0000-000000000001' as UUID,
            seq: 1,
            t_local_ms: 1700000005000,
            prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
            hash: '0000000000000000000000000000000000000000000000000000000000000000',
            sig: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000001=',
            exchange: [],
            osc_residual_ms: null,
            health: null,
          },
          gnss_resid_ms: 0,
          camera_resid_ms: 0,
        },
      ];

      const mockSim = createMockSim({
        step: vi.fn(async (nowMs: number): Promise<SimNodeOutput[]> => {
          await new Promise((r) => setTimeout(r, 5));
          return mockOutputs.map((o) => ({
            ...o,
            heartbeat: { ...o.heartbeat, t_local_ms: nowMs },
          }));
        }),
      });

      const orchestrator = new Orchestrator({
        nodeRegistry,
        engine: stubEngine,
        sim: mockSim,
        now: () => 1700000005000,
      });

      const tickOutput = await orchestrator.tick();
      expect(mockSim.step).toHaveBeenCalledWith(1700000005000);
      expect(orchestrator.getLatestSimOutputs().length).toBe(1);
      expect(orchestrator.getLatestSimOutputs()[0]!.heartbeat.t_local_ms).toBe(1700000005000);
      expect(tickOutput.now_ms).toBe(1700000005000);
    });

    it('prevents overlapping orchestrator ticks via mutex lock', async () => {
      let resolveStep!: () => void;
      const delayedStepPromise = new Promise<SimNodeOutput[]>((resolve) => {
        resolveStep = () => resolve([]);
      });

      const mockSim = createMockSim({
        step: vi.fn(() => delayedStepPromise),
      });

      const orchestrator = new Orchestrator({
        nodeRegistry,
        engine: stubEngine,
        sim: mockSim,
      });

      // Start first tick (which will wait on delayedStepPromise)
      const tick1 = orchestrator.tick();

      // Immediately attempt second tick while first is running
      await expect(orchestrator.tick()).rejects.toThrow('Concurrent tick execution prevented');

      // Unblock first tick
      resolveStep();
      const output1 = await tick1;
      expect(output1).toBeDefined();

      // Subsequent tick succeeds normally
      mockSim.step = vi.fn(async () => []);
      const output2 = await orchestrator.tick();
      expect(output2).toBeDefined();
    });

    it('recovers cleanly when sim.step rejects without leaving tick mutex permanently locked', async () => {
      const failingSim = createMockSim({
        step: vi.fn(async () => {
          throw new Error('Physics engine singularity');
        }),
      });

      const orchestrator = new Orchestrator({
        nodeRegistry,
        engine: stubEngine,
        sim: failingSim,
      });

      await expect(orchestrator.tick()).rejects.toThrow('Physics engine singularity');

      // Mutex was unlocked in finally block; subsequent call works if sim recovers
      failingSim.step = vi.fn(async () => []);
      const recovered = await orchestrator.tick();
      expect(recovered).toBeDefined();
    });
  });
});
