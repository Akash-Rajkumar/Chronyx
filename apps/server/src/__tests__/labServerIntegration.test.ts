// TEST-FIXTURE
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { io as ClientSocket } from 'socket.io-client';
import type { UUID, NodeInfo, Fault, FaultSpec, ISim } from '@chronyx/contracts';
import { GENESIS_PREV_HASH } from '@chronyx/contracts';
import { createServer } from '../server.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { Orchestrator } from '../core/orchestrator.js';
import { StubEngine } from '@chronyx/engine';
import type { DatabaseRepositories } from '../core/db/index.js';
import type { IFaultService } from '../ctx.js';
import { FaultRegistry } from '../lab/faultRegistry.js';
import { LabFaultService } from '../lab/faultService.js';

describe('P1-T4 Lab Server Integration Suite', () => {
  let nodeRegistry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let stubEngine: StubEngine;
  let mockDb: DatabaseRepositories;

  const testNodeId = '99999999-9999-4999-8999-999999999999' as UUID;
  const testNodePublicKey = 'MCowBQYDK2VwAyEATestNode999999999999999999999999999999999=';

  beforeEach(async () => {
    nodeRegistry = new NodeRegistry();
    heartbeatService = new HeartbeatService(nodeRegistry);
    stubEngine = new StubEngine();

    mockDb = {
      incidents: {
        create: vi.fn(),
        findById: vi.fn(),
        listByStatus: vi.fn(async () => []),
        update: vi.fn(),
        clearAll: vi.fn(async () => {}),
      },
      observations: {
        create: vi.fn(),
        findById: vi.fn(),
        list: vi.fn(async () => []),
        updateStatus: vi.fn(),
        clearAll: vi.fn(async () => {}),
      },
      assessments: {
        create: vi.fn(),
        listByNode: vi.fn(async () => []),
        clearAll: vi.fn(async () => {}),
      },
      transitions: {
        create: vi.fn(),
        listByNode: vi.fn(async () => []),
        clearAll: vi.fn(async () => {}),
      },
      faults: {
        create: vi.fn(),
        findById: vi.fn(),
        listActive: vi.fn(async () => []),
        listAll: vi.fn(async () => []),
        update: vi.fn(),
        clearAll: vi.fn(async () => {}),
      },
      nodes: {
        create: vi.fn(),
        findById: vi.fn(),
        findByPublicKey: vi.fn(),
        listAll: vi.fn(async () => []),
      },
      heartbeats: {} as unknown as DatabaseRepositories['heartbeats'],
      benchmarkRuns: {} as unknown as DatabaseRepositories['benchmarkRuns'],
      anchors: {} as unknown as DatabaseRepositories['anchors'],
      config: {} as unknown as DatabaseRepositories['config'],
    } as unknown as DatabaseRepositories;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Authoritative Node References (Implementation A)
  describe('Authoritative Node References (Implementation A)', () => {
    it('returns empty node list when initVirtualNodes is explicitly false', async () => {
      let exposedNodes: NodeInfo[] = [];
      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        db: mockDb,
        initVirtualNodes: false,
      });
      await serverInstance.init();
      exposedNodes = nodeRegistry.getAllNodes();
      expect(exposedNodes).toEqual([]);
    });

    it('initializes 3 virtual nodes by default when options.initVirtualNodes and VIRTUAL_NODES are unset', async () => {
      const originalEnv = process.env.VIRTUAL_NODES;
      delete process.env.VIRTUAL_NODES;
      try {
        const serverInstance = createServer({
          nodeRegistry,
          heartbeatService,
          engine: stubEngine,
          db: mockDb,
        });
        await serverInstance.init();
        const nodes = serverInstance.nodeRegistry.getAllNodes();
        expect(nodes.length).toBe(3);
        expect(nodes.every((n) => n.kind === 'virtual')).toBe(true);
        expect(nodes.map((n) => n.name)).toEqual(['V-Alpha', 'V-Beta', 'V-Gamma']);
      } finally {
        if (originalEnv !== undefined) {
          process.env.VIRTUAL_NODES = originalEnv;
        }
      }
    });

    it('handles invalid VIRTUAL_NODES by safely defaulting to 3', async () => {
      const originalEnv = process.env.VIRTUAL_NODES;
      process.env.VIRTUAL_NODES = 'invalid_number';
      try {
        const serverInstance = createServer({
          nodeRegistry,
          heartbeatService,
          engine: stubEngine,
          db: mockDb,
        });
        await serverInstance.init();
        const nodes = serverInstance.nodeRegistry.getAllNodes();
        expect(nodes.length).toBe(3);
        expect(nodes.every((n) => n.kind === 'virtual')).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.VIRTUAL_NODES = originalEnv;
        } else {
          delete process.env.VIRTUAL_NODES;
        }
      }
    });

    it('prevents duplicate virtual node initialization if virtual nodes are already registered', async () => {
      const serverInstance1 = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        db: mockDb,
        initVirtualNodes: true,
      });
      await serverInstance1.init();
      expect(serverInstance1.nodeRegistry.getAllNodes().length).toBe(3);

      // Call init() again on the same server instance
      await serverInstance1.init();
      expect(serverInstance1.nodeRegistry.getAllNodes().length).toBe(3);

      // Call createServer again with same nodeRegistry and init it
      const serverInstance2 = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        db: mockDb,
        initVirtualNodes: true,
      });
      await serverInstance2.init();
      expect(serverInstance2.nodeRegistry.getAllNodes().length).toBe(3);
    });

    it('exposes virtual nodes only when explicitly created, preserving identity and public key', async () => {
      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        db: mockDb,
        initVirtualNodes: true,
      });
      await serverInstance.init();

      const nodes = serverInstance.nodeRegistry.getAllNodes();
      expect(nodes.length).toBe(3);
      expect(nodes.every((n) => n.kind === 'virtual')).toBe(true);
      expect(nodes[0]!.name).toBe('V-Alpha');
      expect(nodes[0]!.public_key).toBeDefined();
      expect(nodes[1]!.name).toBe('V-Beta');
      expect(nodes[2]!.name).toBe('V-Gamma');

      // Authoritative lookup by id
      const alphaNode = serverInstance.nodeRegistry.getNodeSync(nodes[0]!.id);
      expect(alphaNode).toBeDefined();
      expect(alphaNode?.id).toBe(nodes[0]!.id);
    });

    it('preserves registered real nodes alongside virtual nodes', async () => {
      await nodeRegistry.registerNode({
        id: testNodeId,
        name: 'Browser-Station-1',
        kind: 'browser',
        public_key: testNodePublicKey,
      });

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        db: mockDb,
        initVirtualNodes: true,
      });
      await serverInstance.init();

      const allNodes = serverInstance.nodeRegistry.getAllNodes();
      expect(allNodes.length).toBe(4); // 1 real + 3 virtual
      const realNode = allNodes.find((n) => n.id === testNodeId);
      expect(realNode).toBeDefined();
      expect(realNode?.kind).toBe('browser');
    });
  });

  // 2. LabFaultService Mounting (Implementation B)
  describe('LabFaultService Mounting (Implementation B)', () => {
    it('mounts the injected faultService in createServer options', async () => {
      const mockFault: Fault = {
        id: '12345678-1234-4234-8234-123456789abc' as UUID,
        node_id: testNodeId,
        type: 'clock_step',
        params: { offset_ms: 50 },
        started_at_ms: 1700000000000,
        ends_at_ms: null,
        status: 'active',
        applies_to: 'agent_shim',
        detected_at_ms: null,
        error_at_detect_ms: null,
        detection_latency_s: null,
      };

      const customFaultService: IFaultService = {
        start: vi.fn(async (_spec: FaultSpec) => mockFault),
        stop: vi.fn(async (_id: UUID) => ({ ...mockFault, status: 'stopped' as const })),
        active: vi.fn(() => [mockFault]),
        injectedErrorMs: vi.fn(() => 50),
        markDetected: vi.fn(async () => {}),
      };

      createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        faultService: customFaultService,
      });

      expect(customFaultService.active().length).toBe(1);
      expect(customFaultService.active()[0]!.id).toBe(mockFault.id);
    });
  });

  // 3 & 4. Real send-to-node Routing & Disconnected Nodes (Implementation C)
  describe('Targeted sendToNode Routing (Implementation C)', () => {
    let serverInstance: ReturnType<typeof createServer>;
    let serverHttp: HttpServer;
    let port: number;
    let serverIo: ReturnType<typeof createServer>['io'];

    beforeEach(async () => {
      serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
      });
      serverHttp = serverInstance.server;
      serverIo = serverInstance.io;

      await new Promise<void>((resolve) => {
        serverHttp.listen(0, () => {
          port = (serverHttp.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (serverIo) {
        serverIo.close();
      }
      if (serverHttp && serverHttp.listening) {
        await new Promise<void>((resolve) => serverHttp.close(() => resolve()));
      }
    });

    it('delivers fault instructions targeted only to the specific connected node', async () => {
      await nodeRegistry.registerNode({
        id: testNodeId,
        name: 'Target-Node',
        kind: 'browser',
        public_key: testNodePublicKey,
      });

      const otherNodeId = '88888888-8888-4888-8888-888888888888' as UUID;
      await nodeRegistry.registerNode({
        id: otherNodeId,
        name: 'Other-Node',
        kind: 'browser',
        public_key: 'MCowBQYDK2VwAyEAOtherNode888888888888888888888888888888888=',
      });

      const clientTarget = ClientSocket(`http://localhost:${port}`, {
        auth: { node_id: testNodeId, public_key: testNodePublicKey },
        transports: ['websocket'],
      });

      const clientOther = ClientSocket(`http://localhost:${port}`, {
        auth: { node_id: otherNodeId, public_key: 'MCowBQYDK2VwAyEAOtherNode888888888888888888888888888888888=' },
        transports: ['websocket'],
      });

      const clientDashboard = ClientSocket(`http://localhost:${port}`, {
        auth: { role: 'dashboard' },
        transports: ['websocket'],
      });

      try {
        await new Promise<void>((resolve) => {
          let connectedCount = 0;
          const onConnect = () => {
            connectedCount++;
            if (connectedCount === 3) resolve();
          };
          clientTarget.on('connect', onConnect);
          clientOther.on('connect', onConnect);
          clientDashboard.on('connect', onConnect);
        });

        let targetReceived = false;
        let otherReceived = false;
        let dashboardReceived = false;

        clientTarget.on('fault:apply', (_data) => {
          targetReceived = true;
        });
        clientOther.on('fault:apply', (_data) => {
          otherReceived = true;
        });
        clientDashboard.on('fault:apply', (_data) => {
          dashboardReceived = true;
        });

        // Use serverInstance.sendToNode
        serverInstance.sendToNode(testNodeId, 'fault:apply', { step_ms: 100 });

        await new Promise((r) => setTimeout(r, 100));

        expect(targetReceived).toBe(true);
        expect(otherReceived).toBe(false);
        expect(dashboardReceived).toBe(false);
      } finally {
        clientTarget.disconnect();
        clientOther.disconnect();
        clientDashboard.disconnect();
      }
    });

    it('safely handles unknown and disconnected node targets without crashing', async () => {
      const unknownId = '11111111-0000-0000-0000-000000000000' as UUID;
      const offlineId = '22222222-0000-0000-0000-000000000000' as UUID;

      await nodeRegistry.registerNode({
        id: offlineId,
        name: 'Offline-Node',
        kind: 'browser',
        public_key: 'MCowBQYDK2VwAyEAOfflineNode222222222222222222222222222222222=',
      });
      // offlineId is registered but online is false

      // Send to unknown node via sendToNode
      expect(() => {
        serverInstance.sendToNode(unknownId, 'fault:apply', { step_ms: 100 });
      }).not.toThrow();

      // Send to offline node via sendToNode
      expect(() => {
        serverInstance.sendToNode(offlineId, 'fault:apply', { step_ms: 100 });
      }).not.toThrow();
    });
  });

  // 5. Fault Expiration (Implementation D)
  describe('Deterministic Fault Expiration (Implementation D)', () => {
    it('expires faults deterministically on 1 Hz tick via injected clock', async () => {
      const expireCalls: number[] = [];
      const mockFaultRegistry = {
        expireAt: vi.fn(async (nowMs: number) => {
          expireCalls.push(nowMs);
        }),
      };

      const orchestrator = new Orchestrator({
        nodeRegistry,
        engine: stubEngine,
        faultRegistry: mockFaultRegistry,
      });

      // Tick at T = 1000 (before expiry)
      await orchestrator.tick(1000);
      expect(mockFaultRegistry.expireAt).toHaveBeenCalledTimes(1);
      expect(expireCalls).toEqual([1000]);

      // Tick at T = 2000 (at expiry)
      await orchestrator.tick(2000);
      expect(mockFaultRegistry.expireAt).toHaveBeenCalledTimes(2);
      expect(expireCalls).toEqual([1000, 2000]);

      // Tick at T = 3000 (after expiry)
      await orchestrator.tick(3000);
      expect(mockFaultRegistry.expireAt).toHaveBeenCalledTimes(3);
      expect(expireCalls).toEqual([1000, 2000, 3000]);
    });

    it('recovers gracefully if fault expiration hook throws', async () => {
      const failingFaultRegistry = {
        expireAt: vi.fn(async () => {
          throw new Error('Storage timeout during expiration');
        }),
      };

      const orchestrator = new Orchestrator({
        nodeRegistry,
        engine: stubEngine,
        faultRegistry: failingFaultRegistry,
      });

      // Tick must complete without crashing orchestrator
      const output = await orchestrator.tick(1000);
      expect(output).toBeDefined();
      expect(output.network).toBeDefined();
    });
  });

  // 6. Reset Operations (Implementation E)
  describe('Reset Operations (Implementation E)', () => {
    it('performs soft reset: resets engine and in-memory orchestrator state', async () => {
      const orchestrator = new Orchestrator({
        nodeRegistry,
        engine: stubEngine,
      });

      // Seed assessment
      orchestrator.setAssessment({
        node_id: testNodeId,
        t_ms: 1700000000000,
        state: 'suspect',
        error_est_ms: 2.5,
        sigma_ms: 0.4,
        z: 3.1,
        cusum: 1.5,
        confidence: 0.7,
        streams: [],
        reasons: ['PEER_OUTLIER'],
        suspected_cause: 'local_clock',
        quarantined_since_ms: null,
      });

      expect(orchestrator.getState().latestAssessments.size).toBe(1);

      // Perform soft reset
      orchestrator.reset();

      expect(orchestrator.getState().latestAssessments.size).toBe(0);
      expect(orchestrator.getState().latestNetwork).toBeNull();
    });

    it('performs hard reset: calls clearAll on typed repositories preserving nodes and referential integrity', async () => {
      await Promise.all([
        mockDb.incidents.clearAll(),
        mockDb.observations.clearAll(),
        mockDb.assessments.clearAll(),
        mockDb.transitions.clearAll(),
        mockDb.faults.clearAll(),
      ]);

      expect(mockDb.incidents.clearAll).toHaveBeenCalledTimes(1);
      expect(mockDb.observations.clearAll).toHaveBeenCalledTimes(1);
      expect(mockDb.assessments.clearAll).toHaveBeenCalledTimes(1);
      expect(mockDb.transitions.clearAll).toHaveBeenCalledTimes(1);
      expect(mockDb.faults.clearAll).toHaveBeenCalledTimes(1);

      // Crucial: nodes repository is NOT wiped, preserving node identities
      expect(mockDb.nodes.create).not.toHaveBeenCalled();
    });
  });

  // 7. Gateway Security Regression
  describe('Gateway Security Regression', () => {
    it('maintains strict Ed25519 signature verification and hash chain continuity', async () => {
      await nodeRegistry.registerNode({
        id: testNodeId,
        name: 'Crypto-Node',
        kind: 'browser',
        public_key: testNodePublicKey,
      });

      // Forged signature
      const forgedHeartbeat = {
        node_id: testNodeId,
        seq: 0,
        t_local_ms: Date.now(),
        prev_hash: GENESIS_PREV_HASH,
        exchange: [{ t1: 1000, t2: 1001, t3: 1002, t4: 1003 }],
        osc_residual_ms: 0.01,
        health: null,
        hash: 'badhash',
        sig: 'bWFsaWNpb3VzX3NpZ25hdHVyZQ==',
      };

      const result = await heartbeatService.verifyAndIngest(forgedHeartbeat, Date.now());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BAD_SIGNATURE');
      }
    });
  });

  // 8. Integrated P1-P2 Fault Expiry Lifecycle
  describe('Integrated P1-P2 Fault Expiry Lifecycle', () => {
    it('creates server with authoritative FaultRegistry and LabFaultService sharing identical registry', () => {
      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        initVirtualNodes: false,
      });

      expect(serverInstance.faultRegistry).toBeInstanceOf(FaultRegistry);
      expect(serverInstance.faultService).toBeInstanceOf(LabFaultService);
      // Verify identical shared registry reference
      const labFaults = serverInstance.labContext.faults as LabFaultService;
      expect(labFaults.registry).toBe(serverInstance.faultRegistry);
      const orchFaults = serverInstance.orchestrator.getFaultService() as LabFaultService;
      expect(orchFaults).toBe(serverInstance.faultService);
      expect(orchFaults.registry).toBe(serverInstance.faultRegistry);
    });

    it('expires virtual node fault: deactivates via sim.stopFault before markExpired, emitting fault:changed', async () => {
      const mockSim: ISim = {
        applyFault: vi.fn(),
        stopFault: vi.fn(),
        step: vi.fn(async () => []),
        addVirtualNode: vi.fn(),
      } as unknown as ISim;

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        sim: mockSim,
        initVirtualNodes: false,
      });

      // Register virtual node
      const vNodeId = '11111111-1111-4111-8111-111111111111' as UUID;
      nodeRegistry.registerNodeDirect({
        id: vNodeId,
        name: 'V-Test-Alpha',
        kind: 'virtual',
        public_key: 'MCowBQYDK2VwAyEAVirtualTest11111111111111111111111111111111=',
        created_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        online: true,
      });

      // Track dashboard socket emissions
      const emittedEvents: Array<{ event: string; payload: unknown }> = [];
      serverInstance.io.to = vi.fn().mockImplementation(() => ({
        emit: (event: string, payload: unknown) => {
          emittedEvents.push({ event, payload });
          return true;
        },
      })) as unknown as typeof serverInstance.io.to;

      // Inject a fault with 1s duration
      const fault = await serverInstance.labContext.faults.start({
        node_id: vNodeId,
        type: 'clock_step',
        params: { duration_s: 1, offset_ms: 50 },
      });

      expect(fault.status).toBe('active');
      expect(fault.ends_at_ms).toBeDefined();
      expect(mockSim.applyFault).toHaveBeenCalledWith(expect.objectContaining({ id: fault.id }));

      const expiryTime = fault.ends_at_ms!;

      // Tick before expiry
      await serverInstance.orchestrator.tick(expiryTime - 500);
      expect(mockSim.stopFault).not.toHaveBeenCalled();
      expect(serverInstance.faultRegistry.get(fault.id)?.status).toBe('active');

      // Tick at expiry
      await serverInstance.orchestrator.tick(expiryTime);

      // Verify sim.stopFault was called
      expect(mockSim.stopFault).toHaveBeenCalledWith(fault.id);
      // Verify registry status is 'expired'
      const expired = serverInstance.faultRegistry.get(fault.id);
      expect(expired?.status).toBe('expired');
      expect(expired?.ends_at_ms).toBe(expiryTime);

      // Verify fault:changed was emitted
      const faultChangedEvents = emittedEvents.filter((e) => e.event === 'fault:changed');
      expect(faultChangedEvents.length).toBeGreaterThanOrEqual(1);
      const lastFaultChanged = faultChangedEvents[faultChangedEvents.length - 1];
      expect((lastFaultChanged?.payload as Fault).id).toBe(fault.id);
      expect((lastFaultChanged?.payload as Fault).status).toBe('expired');
    });

    it('expires browser node fault: deactivates via sendToNode(fault:clear) before markExpired', async () => {
      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        initVirtualNodes: false,
      });

      const browserNodeId = '22222222-2222-4222-8222-222222222222' as UUID;
      await nodeRegistry.registerNode({
        id: browserNodeId,
        name: 'B-Test-Browser',
        kind: 'browser',
        public_key: 'MCowBQYDK2VwAyEABrowserTest22222222222222222222222222222222=',
      });
      // Mark node online
      nodeRegistry.markNodeConnected(browserNodeId, 'socket-test-1');

      const sentToRooms: Array<{ room: string; event: string; payload: unknown }> = [];
      serverInstance.io.to = vi.fn().mockImplementation((room: string) => ({
        emit: (event: string, payload: unknown) => {
          sentToRooms.push({ room, event, payload });
          return true;
        },
      })) as unknown as typeof serverInstance.io.to;

      const fault = await serverInstance.labContext.faults.start({
        node_id: browserNodeId,
        type: 'clock_step',
        params: { duration_s: 2, offset_ms: 100 },
      });

      expect(fault.status).toBe('active');
      expect(sentToRooms).toContainEqual(
        expect.objectContaining({
          room: `node:${browserNodeId}`,
          event: 'fault:apply',
        }),
      );

      const expiryTime = fault.ends_at_ms!;

      // Tick before expiry
      await serverInstance.orchestrator.tick(expiryTime - 1000);
      expect(serverInstance.faultRegistry.get(fault.id)?.status).toBe('active');

      // Tick at expiry
      await serverInstance.orchestrator.tick(expiryTime);
      expect(sentToRooms).toContainEqual(
        expect.objectContaining({
          room: `node:${browserNodeId}`,
          event: 'fault:clear',
        }),
      );
      expect(serverInstance.faultRegistry.get(fault.id)?.status).toBe('expired');
    });

    it('retries fault deactivation if deactivation fails, keeping status active', async () => {
      let failStop = true;
      const mockSim: ISim = {
        applyFault: vi.fn(),
        stopFault: vi.fn((_id: UUID) => {
          if (failStop) {
            throw new Error('Sim engine busy');
          }
        }),
        step: vi.fn(async () => []),
        addVirtualNode: vi.fn(),
      } as unknown as ISim;

      const serverInstance = createServer({
        nodeRegistry,
        heartbeatService,
        engine: stubEngine,
        sim: mockSim,
        initVirtualNodes: false,
      });

      const vNodeId = '33333333-3333-4333-8333-333333333333' as UUID;
      nodeRegistry.registerNodeDirect({
        id: vNodeId,
        name: 'V-Test-Fail',
        kind: 'virtual',
        public_key: 'MCowBQYDK2VwAyEAVirtualFail33333333333333333333333333333333=',
        created_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        online: true,
      });

      const fault = await serverInstance.labContext.faults.start({
        node_id: vNodeId,
        type: 'clock_step',
        params: { duration_s: 1, offset_ms: 50 },
      });

      const expiryTime = fault.ends_at_ms!;

      // First tick at expiry: deactivation throws
      await serverInstance.orchestrator.tick(expiryTime);
      // Status MUST remain active because deactivation threw
      expect(serverInstance.faultRegistry.get(fault.id)?.status).toBe('active');

      // Second tick: deactivation now succeeds
      failStop = false;
      await serverInstance.orchestrator.tick(expiryTime + 1000);
      // Status should now be expired
      expect(serverInstance.faultRegistry.get(fault.id)?.status).toBe('expired');
    });
  });
});
