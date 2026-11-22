import type { Server } from 'socket.io';
import type {
  EngineTickInput,
  EngineTickOutput,
  IEngine,
  ISim,
  NodeTickInput,
  SimNodeOutput,
  Assessment,
  NetworkHealth,
  UUID,
  Fault,
} from '@chronyx/contracts';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import type { NodeRegistry } from './nodeRegistry.js';
import type { DatabaseRepositories } from './db/index.js';
import type { Json } from './db/schema.js';
import { logger } from '../logger.js';

export interface AnchorStatus {
  ok: boolean;
  offset_ms: number | null;
  sigma_ms: number | null;
}

export interface OrchestratorDependencies {
  nodeRegistry: NodeRegistry;
  engine: IEngine;
  db?: DatabaseRepositories | null;
  io?: Server | null;
  sim?: ISim | null;
  now?: () => number;
  anchorProvider?: () => AnchorStatus;
  faultRegistry?: { expireAt(nowMs: number): void | Promise<void> } | null;
  faultService?: { runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void> } | null;
}

export interface OrchestratorState {
  lastTickMs: number | null;
  latestAssessments: Map<UUID, Assessment>;
  latestNetwork: NetworkHealth | null;
  consensusMs: number;
}

export class Orchestrator {
  private readonly nodeRegistry: NodeRegistry;
  private readonly engine: IEngine;
  private readonly db: DatabaseRepositories | null;
  private readonly io: Server | null;
  private sim: ISim | null;
  private readonly now: () => number;
  private readonly anchorProvider: () => AnchorStatus;
  private readonly faultRegistry: { expireAt(nowMs: number): void | Promise<void> } | null;
  private readonly faultService: { runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void> } | null;

  private isRunning = false;
  private isTickRunning = false;
  private timer: NodeJS.Timeout | null = null;

  private lastTickMs: number | null = null;
  private latestAssessments = new Map<UUID, Assessment>();
  private latestNetwork: NetworkHealth | null = null;
  private consensusMs = 0;
  private latestSimOutputs: SimNodeOutput[] = [];
  private readonly persistedNodeIds = new Set<string>();

  constructor(deps: OrchestratorDependencies) {
    this.nodeRegistry = deps.nodeRegistry;
    this.engine = deps.engine;
    this.db = deps.db ?? null;
    this.io = deps.io ?? null;
    this.sim = deps.sim ?? null;
    this.now = deps.now ?? (() => Date.now());
    this.anchorProvider =
      deps.anchorProvider ??
      (() => ({
        ok: true,
        offset_ms: null,
        sigma_ms: null,
      }));
    this.faultRegistry = deps.faultRegistry ?? null;
    this.faultService = deps.faultService ?? null;
  }

  /**
   * Identifies whether the wired engine is a production P2 engine
   * or a development StubEngine.
   */
  public isRealEngine(): boolean {
    const name = this.engine.constructor.name;
    return Boolean(name && name !== 'StubEngine');
  }

  public getSimulator(): ISim | null {
    return this.sim;
  }

  public setSimulator(sim: ISim | null): void {
    this.sim = sim;
  }

  public getFaultService(): { runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void> } | null {
    return this.faultService;
  }

  public getLatestSimOutputs(): SimNodeOutput[] {
    return this.latestSimOutputs;
  }

  /**
   * Virtual node ingestion gate:
   * Explicitly prevents unverified/mock-signed virtual node heartbeats
   * from bypassing Gateway cryptographic verification.
   */
  public isVirtualNodeIngestGated(): boolean {
    // When no simulator or simulator generates unverified/mock signatures, gate ingestion
    return true;
  }

  /**
   * Builds the frozen NodeTickInput for a given node.
   * STRICT CONTRACT: Never fabricates missing measurements.
   */
  public buildNodeTickInput(nodeId: UUID, nowMs: number): NodeTickInput | null {
    const node = this.nodeRegistry.getNodeSync(nodeId);
    if (!node) {
      return null;
    }

    const sample = this.nodeRegistry.getLatestSample(nodeId);
    const integrity = this.nodeRegistry.getIntegrityState(nodeId, nowMs);

    return {
      node_id: node.id,
      online: node.online,
      peer_offset_ms: sample?.peer_offset_ms ?? null,
      osc_residual_ms: sample?.osc_residual_ms ?? null,
      gnss_resid_ms: null, // Real browser nodes have no GNSS hardware
      camera_resid_ms: null, // Real browser nodes have no camera-sync hardware
      health: sample?.health ?? null,
      integrity: {
        bad_signature: integrity.bad_signature,
        chain_break: integrity.chain_break,
        heartbeat_gap: integrity.heartbeat_gap,
      },
    };
  }

  /**
   * Constructs a complete frozen EngineTickInput from Gateway real nodes.
   */
  public buildEngineTickInput(nowMs: number): EngineTickInput {
    const allNodes = this.nodeRegistry.getAllNodes();
    const nodeInputs: NodeTickInput[] = [];

    for (const node of allNodes) {
      const input = this.buildNodeTickInput(node.id, nowMs);
      if (input) {
        nodeInputs.push(input);
      }
    }

    const anchor = this.anchorProvider();

    return {
      now_ms: nowMs,
      nodes: nodeInputs,
      anchor: {
        ok: anchor.ok,
        offset_ms: anchor.offset_ms,
        sigma_ms: anchor.sigma_ms,
      },
    };
  }

  /**
   * Executes a single deterministic orchestration tick.
   * Guarded against overlapping executions.
   */
  public async tick(overrideNowMs?: number): Promise<EngineTickOutput> {
    if (this.isTickRunning) {
      logger.warn('Orchestrator tick skipped: previous tick still in progress');
      throw new Error('Concurrent tick execution prevented');
    }

    this.isTickRunning = true;
    const nowMs = overrideNowMs ?? this.now();

    try {
      // Deterministically run fault lifecycle at injected nowMs before assessment
      if (this.faultService && typeof this.faultService.runLifecycle === 'function') {
        try {
          await Promise.resolve(this.faultService.runLifecycle(nowMs));
        } catch (err) {
          logger.error({ err, nowMs }, 'Fault lifecycle execution failed during orchestrator tick');
        }
      } else if (this.faultRegistry && typeof this.faultRegistry.expireAt === 'function') {
        try {
          await this.faultRegistry.expireAt(nowMs);
        } catch (err) {
          logger.error({ err, nowMs }, 'Fault expiration failed during orchestrator tick');
        }
      }

      // Step simulation if present (await async ISim.step per D-001)
      if (this.sim) {
        const outputs = await this.sim.step(nowMs);
        this.latestSimOutputs = outputs;
      }

      // 1. Build frozen EngineTickInput from real Gateway nodes
      const tickInput = this.buildEngineTickInput(nowMs);

      // 2. Execute engine assessment
      const output = this.engine.tick(tickInput);

      // 3. Durable persistence via typed repositories (if configured)
      if (this.db) {
        await this.persistTickResults(output);
      }

      // 4. Update in-memory orchestrator state
      this.lastTickMs = output.now_ms;
      this.latestNetwork = output.network;
      this.consensusMs = output.consensus_ms;
      for (const a of output.assessments) {
        this.latestAssessments.set(a.node_id, a);
      }

      // 5. Broadcast to Socket.IO dashboard room (if connected)
      if (this.io) {
        this.broadcastDashboardEvents(output);
      }

      return output;
    } catch (err) {
      logger.error({ err, nowMs }, 'Orchestrator tick failed');
      throw err;
    } finally {
      this.isTickRunning = false;
    }
  }

  /**
   * Persists assessments and transitions into the Supabase database.
   */
  private async persistTickResults(output: EngineTickOutput): Promise<void> {
    if (!this.db) return;

    // Ensure nodes exist in database for foreign key constraints
    for (const a of output.assessments) {
      if (!this.persistedNodeIds.has(a.node_id)) {
        try {
          const existing = await this.db.nodes.findById(a.node_id);
          if (!existing) {
            const nodeInfo = this.nodeRegistry.getNodeSync(a.node_id);
            if (nodeInfo) {
              const existingByKey = await this.db.nodes.findByPublicKey(nodeInfo.public_key);
              if (!existingByKey) {
                await this.db.nodes.create({
                  id: nodeInfo.id,
                  name: nodeInfo.name,
                  kind: nodeInfo.kind,
                  public_key: nodeInfo.public_key,
                });
              }
            }
          }
          this.persistedNodeIds.add(a.node_id);
        } catch (err) {
          logger.warn({ err, nodeId: a.node_id }, 'Failed to ensure node in database before assessment persist');
        }
      }
    }

    // Persist all node assessments in parallel
    await Promise.all(
      output.assessments.map((a) =>
        this.db!.assessments.create({
          node_id: a.node_id,
          t_ms: a.t_ms,
          state: a.state,
          error_est_ms: a.error_est_ms,
          sigma_ms: a.sigma_ms,
          z: a.z,
          cusum: a.cusum,
          confidence: a.confidence,
          reasons: a.reasons,
          suspected_cause: a.suspected_cause,
          streams: a.streams as unknown as Json,
        }),
      ),
    );

    // Persist state transitions in parallel
    if (output.transitions.length > 0) {
      await Promise.all(
        output.transitions.map((t) =>
          this.db!.transitions.create({
            node_id: t.node_id,
            at_ms: t.at_ms,
            from_state: t.from,
            to_state: t.to,
            reasons: t.reasons,
            error_est_ms: t.error_est_ms,
          }),
        ),
      );
    }
  }

  /**
   * Emits contract-compliant realtime events to dashboard subscribers.
   */
  private broadcastDashboardEvents(output: EngineTickOutput): void {
    if (!this.io) return;

    // Broadcast assessments array
    this.io.to('dashboard').emit(SOCKET_EVENTS.ASSESSMENTS, output.assessments);

    // Broadcast individual transitions
    for (const t of output.transitions) {
      this.io.to('dashboard').emit(SOCKET_EVENTS.TRANSITION, t);
    }
  }

  /**
   * Starts the 1 Hz production background tick loop.
   */
  public start(intervalMs = 1000): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.timer = setInterval(() => {
      if (this.isTickRunning) {
        return;
      }
      this.tick().catch((err) => {
        logger.error({ err }, 'Error in recurring orchestrator tick loop');
      });
    }, intervalMs);

    logger.info({ intervalMs }, 'Orchestrator started');
  }

  /**
   * Stops the background tick loop cleanly.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('Orchestrator stopped');
  }

  public getState(): OrchestratorState {
    return {
      lastTickMs: this.lastTickMs,
      latestAssessments: new Map(this.latestAssessments),
      latestNetwork: this.latestNetwork,
      consensusMs: this.consensusMs,
    };
  }

  public getLatestAssessment(nodeId: UUID): Assessment | null {
    return this.latestAssessments.get(nodeId) ?? null;
  }

  public setAssessment(assessment: Assessment): void {
    this.latestAssessments.set(assessment.node_id, assessment);
  }

  /**
   * Resets orchestrator in-memory state and the underlying engine.
   */
  public reset(): void {
    this.latestAssessments.clear();
    this.latestNetwork = null;
    this.consensusMs = 0;
    this.engine.reset();
  }
}
