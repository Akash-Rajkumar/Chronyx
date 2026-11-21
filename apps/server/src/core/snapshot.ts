import {
  CONTRACT_VERSION,
  DEFAULT_ENGINE_CONFIG,
} from '@chronyx/contracts';
import type {
  Snapshot,
  NetworkHealth,
  AnchorInfo,
  IncidentSummary,
  BaselineState,
  IEngine,
  SuspectedCause,
} from '@chronyx/contracts';
import type { NodeRegistry } from './nodeRegistry.js';
import type { Orchestrator } from './orchestrator.js';
import type { DatabaseRepositories } from './db/index.js';
import { logger } from '../logger.js';

/**
 * Builds the canonical Snapshot object adhering to frozen Snapshot contract (Part E2b, E2c).
 * Shared identically between GET /api/v1/state and Socket.IO dashboard:subscribe.
 */
export async function buildSnapshot(
  nodeRegistry: NodeRegistry,
  orchestrator?: Orchestrator,
  engine?: IEngine,
  db?: DatabaseRepositories | null,
): Promise<Snapshot> {
  const nowMs = Date.now();
  const nodes = nodeRegistry.getAllNodes();
  const orchestratorState = orchestrator?.getState();
  const assessments = orchestratorState
    ? Array.from(orchestratorState.latestAssessments.values())
    : [];

  let trusted = 0;
  let suspect = 0;
  let quarantined = 0;
  let recovering = 0;
  for (const a of assessments) {
    if (a.state === 'trusted') trusted++;
    else if (a.state === 'suspect') suspect++;
    else if (a.state === 'quarantined') quarantined++;
    else if (a.state === 'recovering') recovering++;
  }

  const n = nodes.length;
  const score = n > 0 ? Math.round((trusted / n) * 100) : 0;
  const network: NetworkHealth = orchestratorState?.latestNetwork ?? {
    score,
    n,
    trusted,
    suspect,
    quarantined,
    recovering,
    fault_tolerance_f: Math.max(0, Math.floor((n - 1) / 3)),
    anchor_ok: false,
  };

  const config = engine?.getConfig() ?? DEFAULT_ENGINE_CONFIG;

  const anchors: AnchorInfo[] = [
    {
      host: 'time.nplindia.org',
      offset_ms: null,
      rtt_ms: null,
      ok: false,
      sampled_at_ms: nowMs,
    },
  ];

  let openIncidents: IncidentSummary[] = [];
  if (db) {
    try {
      const dbIncidents = await db.incidents.listByStatus('open', 50);
      openIncidents = dbIncidents.map((row) => ({
        id: row.id,
        node_id: row.node_id,
        node_name: nodeRegistry.getNodeSync(row.node_id)?.name ?? 'Unknown Node',
        status: row.status as 'open' | 'closed',
        opened_at_ms: row.opened_at_ms,
        closed_at_ms: row.closed_at_ms,
        peak_error_ms: row.peak_error_ms,
        detection_latency_s: row.detection_latency_s,
        cause: row.cause as SuspectedCause,
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to query open incidents for snapshot');
    }
  }

  const baseline: BaselineState = {
    source: 'model',
    label: 'Naive follower (model)',
    per_node: [],
    cluster_time_error_ms: 0,
  };

  return {
    contract_version: CONTRACT_VERSION,
    server_time_ms: nowMs,
    nodes,
    assessments,
    network,
    anchors,
    faults: [],
    baseline,
    config,
    open_incidents: openIncidents,
  };
}
