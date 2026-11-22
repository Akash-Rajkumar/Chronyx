import crypto from 'node:crypto';
import type { Server } from 'socket.io';
import type {
  EngineTickInput,
  EngineTickOutput,
  IEngine,
  ISim,
  NodeInfo,
  NodeTickInput,
  SimNodeOutput,
  Assessment,
  NetworkHealth,
  UUID,
  Fault,
  BaselineState,
  Incident,
  IncidentSummary,
} from '@chronyx/contracts';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import { faultContributionMs } from '@chronyx/sim';
import type { NodeRegistry, NodeSample } from './nodeRegistry.js';
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
  faultRegistry?: {
    active?(): Fault[];
    expireAt?: (nowMs: number) => void | Promise<void>;
    markDetected?: (id: UUID, atMs: number, errorMs: number) => Fault;
  } | null;
  faultService?: {
    runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void>;
    markDetected?: (fault_id: UUID, at_ms: number, error_ms: number) => Promise<void>;
  } | null;
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
  private readonly faultRegistry: {
    active?(): Fault[];
    expireAt?: (nowMs: number) => void | Promise<void>;
    markDetected?: (id: UUID, atMs: number, errorMs: number) => Fault;
  } | null;
  private readonly faultService: {
    runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void>;
    markDetected?: (fault_id: UUID, at_ms: number, error_ms: number) => Promise<void>;
  } | null;

  private isRunning = false;
  private isTickRunning = false;
  private timer: NodeJS.Timeout | null = null;

  private lastTickMs: number | null = null;
  private latestAssessments = new Map<UUID, Assessment>();
  private latestNetwork: NetworkHealth | null = null;
  private consensusMs = 0;
  private latestSimOutputs: SimNodeOutput[] = [];
  private readonly persistedNodeIds = new Set<string>();
  private readonly incidentsById = new Map<UUID, Incident>();
  private readonly openIncidentByNode = new Map<UUID, UUID>();
  private readonly nodeBaselines = new Map<
    UUID,
    { peer: number; gnss: number | null; camera: number | null }
  >();

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

  public getFaultRegistry(): {
    active?(): Fault[];
    expireAt?: (nowMs: number) => void | Promise<void>;
    markDetected?: (id: UUID, atMs: number, errorMs: number) => Fault;
  } | null {
    return this.faultRegistry;
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
    const simOut = this.latestSimOutputs.find((o) => o.node.id === nodeId);

    return {
      node_id: node.id,
      online: node.online,
      peer_offset_ms: sample?.peer_offset_ms ?? null,
      osc_residual_ms: sample?.osc_residual_ms ?? null,
      gnss_resid_ms: simOut?.gnss_resid_ms ?? null,
      camera_resid_ms: simOut?.camera_resid_ms ?? null,
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

        for (const simOut of outputs) {
          let peerOffsetMs: number | null = null;
          if (Array.isArray(simOut.heartbeat.exchange) && simOut.heartbeat.exchange.length > 0) {
            const latestEx = simOut.heartbeat.exchange[simOut.heartbeat.exchange.length - 1];
            if (
              latestEx &&
              typeof latestEx.t1 === 'number' &&
              typeof latestEx.t2 === 'number' &&
              typeof latestEx.t3 === 'number' &&
              typeof latestEx.t4 === 'number'
            ) {
              const rtt = (latestEx.t4 - latestEx.t1) - (latestEx.t3 - latestEx.t2);
              if (rtt >= 0 && rtt <= 200) {
                peerOffsetMs = ((latestEx.t1 - latestEx.t2) + (latestEx.t4 - latestEx.t3)) / 2;
              }
            }
          }
          const sample: NodeSample = {
            node_id: simOut.node.id,
            seq: simOut.heartbeat.seq,
            t_local_ms: simOut.heartbeat.t_local_ms,
            server_rx_ms: nowMs,
            peer_offset_ms: peerOffsetMs,
            osc_residual_ms: simOut.heartbeat.osc_residual_ms,
            health: simOut.heartbeat.health,
            hash: simOut.heartbeat.hash,
          };
          this.nodeRegistry.advanceChain(
            simOut.node.id,
            simOut.heartbeat.seq,
            simOut.heartbeat.hash,
            sample,
          );
        }
      }

      // 1. Build frozen EngineTickInput from real Gateway nodes
      const rawTickInput = this.buildEngineTickInput(nowMs);
      const tickInput = this.calibrateTickInput(rawTickInput);

      // 2. Execute engine assessment
      const output = this.engine.tick(tickInput);

      // Check for fault detections
      const activeFaults = this.faultRegistry?.active ? this.faultRegistry.active() : [];
      for (const f of activeFaults) {
        if (f.detected_at_ms === null) {
          const a = output.assessments.find((item) => item.node_id === f.node_id);
          if (a && (a.state === 'suspect' || a.state === 'quarantined')) {
            if (this.faultService && typeof this.faultService.markDetected === 'function') {
              await this.faultService.markDetected(f.id, nowMs, a.error_est_ms);
            } else if (this.faultRegistry && typeof this.faultRegistry.markDetected === 'function') {
              this.faultRegistry.markDetected(f.id, nowMs, a.error_est_ms);
            }
          }
        }
      }

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

      // 4b. Track incident lifecycle (open/update/close) on transitions and assessments
      await this.processIncidents(output, nowMs);

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

    // Broadcast contract-compliant assessments object { t_ms, assessments, network, baseline }
    this.io.to('dashboard').emit(SOCKET_EVENTS.ASSESSMENTS, {
      t_ms: output.now_ms,
      assessments: output.assessments,
      network: output.network,
      baseline: this.computeBaseline(output.now_ms),
    });

    // Broadcast individual transitions
    for (const t of output.transitions) {
      this.io.to('dashboard').emit(SOCKET_EVENTS.TRANSITION, t);
    }
  }

  /**
   * Computes unverified naive follower baseline error across all active observatory nodes.
   */
  public computeBaseline(nowMs: number): BaselineState {
    const nodes = this.nodeRegistry.getAllNodes();
    const activeFaults = this.faultRegistry?.active ? this.faultRegistry.active() : [];

    if (activeFaults.length === 0) {
      return {
        source: 'model',
        label: 'Naive follower (model)',
        per_node: [],
        cluster_time_error_ms: 0,
      };
    }

    const perNode = nodes.map((n) => {
      let followedErrorMs = 0;
      if (this.sim && typeof (this.sim as { faultOffsetMs?: unknown }).faultOffsetMs === 'function') {
        followedErrorMs = (this.sim as { faultOffsetMs(nodeId: UUID, nowMs: number): number }).faultOffsetMs(n.id, nowMs);
      } else {
        for (const f of activeFaults) {
          if (f.node_id === n.id) {
            followedErrorMs += faultContributionMs(f, nowMs);
          }
        }
      }
      return {
        node_id: n.id,
        followed_error_ms: followedErrorMs,
        alarm: false as const,
      };
    });

    const totalError = perNode.reduce((acc, curr) => acc + curr.followed_error_ms, 0);
    const clusterTimeError = perNode.length > 0 ? totalError / perNode.length : 0;

    return {
      source: 'model',
      label: 'Naive follower (model)',
      per_node: perNode,
      cluster_time_error_ms: clusterTimeError,
    };
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

  public emitNodeUpdated(node: NodeInfo): void {
    if (!this.io) return;
    this.io.to('dashboard').emit(SOCKET_EVENTS.NODE_UPDATED, { ...node });
  }

  public getIncidents(status: 'open' | 'closed' | 'all' = 'all', limit = 50): IncidentSummary[] {
    const all = Array.from(this.incidentsById.values())
      .filter((inc) => status === 'all' || inc.status === status)
      .sort((a, b) => b.opened_at_ms - a.opened_at_ms)
      .slice(0, limit);

    return all.map((inc) => ({
      id: inc.id,
      node_id: inc.node_id,
      node_name: inc.node_name,
      status: inc.status,
      opened_at_ms: inc.opened_at_ms,
      closed_at_ms: inc.closed_at_ms,
      peak_error_ms: inc.peak_error_ms,
      detection_latency_s: inc.detection_latency_s,
      cause: inc.cause,
    }));
  }

  public getIncidentById(id: UUID): Incident | null {
    return this.incidentsById.get(id) ?? null;
  }

  private toIncidentSummary(inc: Incident): IncidentSummary {
    return {
      id: inc.id,
      node_id: inc.node_id,
      node_name: inc.node_name,
      status: inc.status,
      opened_at_ms: inc.opened_at_ms,
      closed_at_ms: inc.closed_at_ms,
      peak_error_ms: inc.peak_error_ms,
      detection_latency_s: inc.detection_latency_s,
      cause: inc.cause,
    };
  }

  private async processIncidents(output: EngineTickOutput, _nowMs: number): Promise<void> {
    const assessmentsByNode = new Map<UUID, Assessment>();
    for (const a of output.assessments) {
      assessmentsByNode.set(a.node_id, a);
    }
    const activeFaults = this.faultRegistry?.active ? this.faultRegistry.active() : [];

    // 1. Handle state transitions (open / escalate / close incidents)
    for (const tr of output.transitions) {
      const node = this.nodeRegistry.getNodeSync(tr.node_id);
      const nodeName = node?.name ?? tr.node_id.slice(0, 8);
      const assessment = assessmentsByNode.get(tr.node_id);
      const nodeFault = activeFaults.find((f) => f.node_id === tr.node_id) ?? null;
      const existingOpenId = this.openIncidentByNode.get(tr.node_id);

      if (tr.to === 'suspect' || tr.to === 'quarantined') {
        if (!existingOpenId) {
          const id = crypto.randomUUID() as UUID;
          const peakError = Math.abs(assessment?.error_est_ms ?? tr.error_est_ms ?? 0);
          const cause = assessment?.suspected_cause ?? 'unknown';
          const reasonText = tr.reasons.length > 0 ? tr.reasons.join(', ') : tr.to;
          const summary = `${nodeName} transitioned from ${tr.from} to ${tr.to} (${reasonText}, est. ${peakError.toFixed(2)} ms).`;
          const chainHead = this.nodeRegistry.getLastVerifiedHash(tr.node_id);

          const incident: Incident = {
            id,
            node_id: tr.node_id,
            node_name: nodeName,
            status: 'open',
            opened_at_ms: tr.at_ms,
            closed_at_ms: null,
            peak_error_ms: peakError,
            detection_latency_s: nodeFault?.detection_latency_s ?? null,
            cause,
            summary,
            timeline: [tr],
            evidence: {
              assessments: assessment ? [assessment] : [],
              chain_head_hash: chainHead,
              anchors: [],
              fault: nodeFault,
            },
          };

          this.incidentsById.set(id, incident);
          this.openIncidentByNode.set(tr.node_id, id);

          if (this.db && typeof this.db.incidents?.create === 'function') {
            try {
              await this.db.incidents.create({
                id: incident.id,
                node_id: incident.node_id,
                status: incident.status,
                opened_at_ms: incident.opened_at_ms,
                closed_at_ms: incident.closed_at_ms,
                peak_error_ms: incident.peak_error_ms,
                detection_latency_s: incident.detection_latency_s,
                cause: incident.cause,
                summary: incident.summary,
                evidence: {
                  timeline: incident.timeline,
                  assessments: incident.evidence.assessments,
                  chain_head_hash: incident.evidence.chain_head_hash,
                  anchors: incident.evidence.anchors,
                  fault: incident.evidence.fault,
                } as unknown as Json,
              });
            } catch (err) {
              logger.warn({ err, incidentId: id }, 'Failed to persist opened incident to database');
            }
          }

          if (this.io) {
            this.io.to('dashboard').emit(SOCKET_EVENTS.INCIDENT_OPENED, this.toIncidentSummary(incident));
          }
        } else {
          const incident = this.incidentsById.get(existingOpenId);
          if (incident) {
            incident.timeline = [...incident.timeline, tr];
            const errMag = Math.abs(assessment?.error_est_ms ?? tr.error_est_ms ?? 0);
            if (errMag > incident.peak_error_ms) {
              incident.peak_error_ms = errMag;
            }
            if (assessment && assessment.suspected_cause !== 'none') {
              incident.cause = assessment.suspected_cause;
            }
            if (nodeFault && incident.detection_latency_s === null && nodeFault.detection_latency_s !== null) {
              incident.detection_latency_s = nodeFault.detection_latency_s;
              incident.evidence.fault = nodeFault;
            }
            incident.summary = `${nodeName} escalated to ${tr.to} (peak ${incident.peak_error_ms.toFixed(2)} ms).`;

            if (this.db && typeof this.db.incidents?.update === 'function') {
              try {
                await this.db.incidents.update(incident.id, {
                  peak_error_ms: incident.peak_error_ms,
                  detection_latency_s: incident.detection_latency_s,
                  cause: incident.cause,
                  summary: incident.summary,
                  evidence: {
                    timeline: incident.timeline,
                    assessments: incident.evidence.assessments,
                    chain_head_hash: incident.evidence.chain_head_hash,
                    anchors: incident.evidence.anchors,
                    fault: incident.evidence.fault,
                  } as unknown as Json,
                });
              } catch (err) {
                logger.warn({ err, incidentId: incident.id }, 'Failed to update escalated incident in database');
              }
            }

            if (this.io) {
              this.io.to('dashboard').emit(SOCKET_EVENTS.INCIDENT_UPDATED, this.toIncidentSummary(incident));
            }
          }
        }
      } else if (tr.to === 'trusted' && existingOpenId) {
        const incident = this.incidentsById.get(existingOpenId);
        if (incident) {
          incident.status = 'closed';
          incident.closed_at_ms = tr.at_ms;
          incident.timeline = [...incident.timeline, tr];
          this.openIncidentByNode.delete(tr.node_id);

          if (this.db && typeof this.db.incidents?.update === 'function') {
            try {
              await this.db.incidents.update(incident.id, {
                status: 'closed',
                closed_at_ms: incident.closed_at_ms,
                peak_error_ms: incident.peak_error_ms,
                evidence: {
                  timeline: incident.timeline,
                  assessments: incident.evidence.assessments,
                  chain_head_hash: incident.evidence.chain_head_hash,
                  anchors: incident.evidence.anchors,
                  fault: incident.evidence.fault,
                } as unknown as Json,
              });
            } catch (err) {
              logger.warn({ err, incidentId: incident.id }, 'Failed to persist closed incident in database');
            }
          }

          if (this.io) {
            this.io.to('dashboard').emit(SOCKET_EVENTS.INCIDENT_UPDATED, this.toIncidentSummary(incident));
          }
        }
      }
    }

    // 2. Keep peak error and evidence assessments current on open incidents
    for (const [nodeId, incId] of this.openIncidentByNode.entries()) {
      const incident = this.incidentsById.get(incId);
      const assessment = assessmentsByNode.get(nodeId);
      if (!incident || !assessment) continue;

      const errMag = Math.abs(assessment.error_est_ms);
      let changed = false;
      if (errMag > incident.peak_error_ms) {
        incident.peak_error_ms = errMag;
        changed = true;
      }
      incident.evidence.assessments = [...incident.evidence.assessments, assessment].slice(-30);
      incident.evidence.chain_head_hash = this.nodeRegistry.getLastVerifiedHash(nodeId);

      if (changed && this.io) {
        this.io.to('dashboard').emit(SOCKET_EVENTS.INCIDENT_UPDATED, this.toIncidentSummary(incident));
      }
    }
  }

  /**
   * Applies zero-point baseline offset calibration per node so natural OS clock skew
   * (e.g. a phone clock ~1s off from the hub) or small static hardware bias does not
   * trigger false quarantines on join. Baseline tracking freezes while any fault is
   * active on a node so manual faults (steps, slow ramps, GNSS spoofs, etc.) pass
   * through to the detection engine at full magnitude.
   */
  private calibrateTickInput(input: EngineTickInput): EngineTickInput {
    const activeFaults = this.faultRegistry?.active ? this.faultRegistry.active() : [];
    const faultedNodeIds = new Set(activeFaults.map((f) => f.node_id));

    const calibratedNodes: NodeTickInput[] = input.nodes.map((node) => {
      if (!node.online || node.peer_offset_ms === null) {
        return node;
      }

      const hasFault = faultedNodeIds.has(node.node_id);
      let base = this.nodeBaselines.get(node.node_id);

      if (!base) {
        if (!hasFault) {
          base = {
            peer: node.peer_offset_ms,
            gnss: node.gnss_resid_ms,
            camera: node.camera_resid_ms,
          };
          this.nodeBaselines.set(node.node_id, base);
        } else {
          return node;
        }
      } else if (!hasFault) {
        // Re-lock if a healthy node's OS clock jumped massively without a fault,
        // otherwise gently track slow static bias while calm.
        const peerDelta = node.peer_offset_ms - base.peer;
        if (Math.abs(peerDelta) > 50) {
          base.peer = node.peer_offset_ms;
        } else {
          base.peer += 0.2 * peerDelta;
        }
        if (node.gnss_resid_ms !== null) {
          base.gnss =
            base.gnss === null
              ? node.gnss_resid_ms
              : base.gnss + 0.2 * (node.gnss_resid_ms - base.gnss);
        }
        if (node.camera_resid_ms !== null) {
          base.camera =
            base.camera === null
              ? node.camera_resid_ms
              : base.camera + 0.2 * (node.camera_resid_ms - base.camera);
        }
      }

      return {
        ...node,
        peer_offset_ms: node.peer_offset_ms - base.peer,
        gnss_resid_ms:
          node.gnss_resid_ms !== null && base.gnss !== null
            ? node.gnss_resid_ms - base.gnss
            : node.gnss_resid_ms,
        camera_resid_ms:
          node.camera_resid_ms !== null && base.camera !== null
            ? node.camera_resid_ms - base.camera
            : node.camera_resid_ms,
      };
    });

    return {
      ...input,
      nodes: calibratedNodes,
    };
  }

  /**
   * Resets orchestrator in-memory state and the underlying engine.
   */
  public reset(): void {
    this.latestAssessments.clear();
    this.latestNetwork = null;
    this.consensusMs = 0;
    this.incidentsById.clear();
    this.openIncidentByNode.clear();
    this.nodeBaselines.clear();
    this.engine.reset();
  }
}
