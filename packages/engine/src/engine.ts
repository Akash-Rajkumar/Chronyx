import type {
  Assessment,
  EngineConfig,
  EngineTickInput,
  EngineTickOutput,
  IEngine,
  NodeTickInput,
  ReasonCode,
  StreamReading,
  SuspectedCause,
  Transition,
  TrustState,
} from '@chronyx/contracts';
import { DEFAULT_ENGINE_CONFIG } from '@chronyx/contracts';
import { mad, median, normalCdf } from './stats.js';

const MAD_SCALE = 1.4826;
const INTEGRITY_QUARANTINE_MS = 10_000;

interface Sample {
  tMs: number;
  value: number;
}

interface NodeMemory {
  state: TrustState;
  sPos: number;
  sNeg: number;
  peerHist: Sample[];
  gnssHist: Sample[];
  cameraHist: Sample[];
  oscRaw: Sample[];
  oscDiffHist: Sample[];
  suspectStreak: number;
  quarantineStreak: number;
  driftStreak: number;
  calmStreak: number;
  recoverCalmStreak: number;
  integritySinceMs: number | null;
  quarantinedSinceMs: number | null;
}

function emptyMemory(): NodeMemory {
  return {
    state: 'trusted',
    sPos: 0,
    sNeg: 0,
    peerHist: [],
    gnssHist: [],
    cameraHist: [],
    oscRaw: [],
    oscDiffHist: [],
    suspectStreak: 0,
    quarantineStreak: 0,
    driftStreak: 0,
    calmStreak: 0,
    recoverCalmStreak: 0,
    integritySinceMs: null,
    quarantinedSinceMs: null,
  };
}

function prune(samples: Sample[], oldestMs: number): void {
  let drop = 0;
  while (drop < samples.length && (samples[drop]?.tMs ?? 0) < oldestMs) drop += 1;
  if (drop > 0) samples.splice(0, drop);
}

function sigmaHat(samples: Sample[], nowMs: number, windowMs: number, floorMs: number): number {
  const values: number[] = [];
  const oldest = nowMs - windowMs;
  for (const sample of samples) {
    if (sample.tMs >= oldest && sample.tMs < nowMs) values.push(sample.value);
  }
  return Math.max(floorMs, MAD_SCALE * mad(values));
}

function pushSample(samples: Sample[], sample: Sample, oldestMs: number): void {
  samples.push(sample);
  prune(samples, oldestMs);
}

export class Engine implements IEngine {
  private config: EngineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    gate: { ...DEFAULT_ENGINE_CONFIG.gate },
  };
  private readonly nodes = new Map<string, NodeMemory>();

  public tick(input: EngineTickInput): EngineTickOutput {
    const eligible = input.nodes.filter(
      (node) => node.online && node.peer_offset_ms !== null,
    );
    const insufficient = eligible.length < 3;
    const consensusMs =
      eligible.length === 0 ? 0 : median(eligible.map((node) => node.peer_offset_ms ?? 0));
    const anchorSigma =
      input.anchor.sigma_ms !== null && Number.isFinite(input.anchor.sigma_ms)
        ? input.anchor.sigma_ms
        : 0;
    const transitions: Transition[] = [];
    const assessments = input.nodes.map((node) =>
      this.assessNode(node, input.now_ms, consensusMs, insufficient, anchorSigma, transitions),
    );

    let onlineConfidence = 0;
    let onlineCount = 0;
    const counts = { trusted: 0, suspect: 0, quarantined: 0, recovering: 0 };
    for (let i = 0; i < assessments.length; i += 1) {
      const assessment = assessments[i];
      const source = input.nodes[i];
      if (!assessment || !source) continue;
      counts[assessment.state] += 1;
      if (source.online) {
        onlineConfidence += assessment.confidence;
        onlineCount += 1;
      }
    }
    const anchorAvailable = input.anchor.ok && input.anchor.offset_ms !== null;
    const anchorOk =
      anchorAvailable && Math.abs(input.anchor.offset_ms ?? 0) <= this.config.tolerance_ms;

    return {
      now_ms: input.now_ms,
      assessments,
      transitions,
      network: {
        score: Math.round(100 * (onlineCount === 0 ? 0 : onlineConfidence / onlineCount)),
        n: input.nodes.length,
        trusted: counts.trusted,
        suspect: counts.suspect,
        quarantined: counts.quarantined,
        recovering: counts.recovering,
        fault_tolerance_f: Math.floor((input.nodes.length - 1) / 3),
        anchor_ok: anchorOk,
      },
      consensus_ms: consensusMs,
    };
  }

  public reset(): void {
    this.nodes.clear();
  }

  public setConfig(patch: Partial<EngineConfig>): void {
    this.config = {
      ...this.config,
      ...patch,
      gate: patch.gate ? { ...patch.gate } : { ...this.config.gate },
    };
  }

  public getConfig(): EngineConfig {
    return { ...this.config, gate: { ...this.config.gate } };
  }

  private memory(nodeId: string): NodeMemory {
    const existing = this.nodes.get(nodeId);
    if (existing) return existing;
    const created = emptyMemory();
    this.nodes.set(nodeId, created);
    return created;
  }

  private assessNode(
    node: NodeTickInput,
    nowMs: number,
    consensusMs: number,
    insufficient: boolean,
    anchorSigma: number,
    transitions: Transition[],
  ): Assessment {
    const memory = this.memory(node.node_id);
    const cfg = this.config;
    const windowMs = cfg.mad_window_s * 1000;
    const oldest = nowMs - Math.max(cfg.mad_window_s, cfg.osc_window_s) * 1000 - 2000;

    if (!node.online) {
      return {
        node_id: node.node_id,
        t_ms: nowMs,
        state: memory.state,
        error_est_ms: 0,
        sigma_ms: cfg.min_sigma_ms,
        z: 0,
        cusum: Math.max(memory.sPos, memory.sNeg),
        confidence: 0,
        streams: [],
        reasons: insufficient ? ['NODE_OFFLINE', 'INSUFFICIENT_PEERS'] : ['NODE_OFFLINE'],
        suspected_cause: memory.state === 'trusted' ? 'none' : 'unknown',
        quarantined_since_ms: memory.quarantinedSinceMs,
      };
    }

    const peerSigma = sigmaHat(memory.peerHist, nowMs, windowMs, cfg.min_sigma_ms);
    const hasPeer = node.peer_offset_ms !== null;
    const residual = hasPeer ? (node.peer_offset_ms ?? 0) - consensusMs : 0;
    let z = 0;
    let cusum = Math.max(memory.sPos, memory.sNeg);
    let drift = false;
    if (hasPeer) {
      z = peerSigma === 0 ? 0 : residual / peerSigma;
      memory.sPos = Math.max(0, memory.sPos + z - cfg.cusum_k_sigma);
      memory.sNeg = Math.max(0, memory.sNeg - z - cfg.cusum_k_sigma);
      cusum = Math.max(memory.sPos, memory.sNeg);
      drift = cusum > cfg.cusum_h_sigma;
    }

    const oscDiff = this.oscDifference(memory, node.osc_residual_ms, nowMs);
    const gnssPresent = node.gnss_resid_ms !== null;
    const cameraPresent = node.camera_resid_ms !== null;
    const oscReading = this.secondary(memory.oscDiffHist, oscDiff, nowMs, windowMs);
    const gnssReading = this.secondary(memory.gnssHist, node.gnss_resid_ms, nowMs, windowMs);
    const cameraReading = this.secondary(memory.cameraHist, node.camera_resid_ms, nowMs, windowMs);
    const secondaryFlags =
      (oscReading?.flagged ? 1 : 0) +
      (gnssReading?.flagged ? 1 : 0) +
      (cameraReading?.flagged ? 1 : 0);
    const peerFlagged = hasPeer && Math.abs(z) >= cfg.z_suspect;

    const integrityOn = node.integrity.bad_signature || node.integrity.chain_break;
    if (integrityOn) {
      if (memory.integritySinceMs === null) memory.integritySinceMs = nowMs;
    } else {
      memory.integritySinceMs = null;
    }
    const integrityPersisted =
      memory.integritySinceMs !== null && nowMs - memory.integritySinceMs >= INTEGRITY_QUARANTINE_MS;

    if (!insufficient && hasPeer) {
      memory.suspectStreak = Math.abs(z) >= cfg.z_suspect ? memory.suspectStreak + 1 : 0;
      memory.quarantineStreak = Math.abs(z) >= cfg.z_quarantine ? memory.quarantineStreak + 1 : 0;
      memory.driftStreak = drift ? memory.driftStreak + 1 : 0;
      const calm = Math.abs(z) < cfg.recover_band_sigma && cusum < cfg.cusum_h_sigma / 2;
      if (memory.state === 'suspect' || memory.state === 'quarantined') {
        memory.calmStreak = calm ? memory.calmStreak + 1 : 0;
      } else {
        memory.calmStreak = 0;
      }

      const wantSuspect =
        memory.suspectStreak >= cfg.suspect_min_ticks ||
        drift ||
        secondaryFlags >= 2 ||
        integrityOn;
      const wantQuarantine =
        memory.quarantineStreak >= cfg.quarantine_min_ticks ||
        memory.driftStreak >= cfg.quarantine_min_ticks ||
        integrityPersisted;
      const started = memory.state;

      if (memory.state === 'trusted' && wantSuspect) {
        this.transition(transitions, node, nowMs, 'trusted', 'suspect', residual);
        memory.state = 'suspect';
        memory.calmStreak = 0;
      }
      if (memory.state === 'suspect') {
        if (wantQuarantine) {
          this.transition(transitions, node, nowMs, 'suspect', 'quarantined', residual);
          memory.state = 'quarantined';
          memory.quarantinedSinceMs = nowMs;
          memory.calmStreak = 0;
        } else if (started === 'suspect' && memory.calmStreak >= cfg.recover_ticks) {
          this.transition(transitions, node, nowMs, 'suspect', 'trusted', residual);
          memory.state = 'trusted';
          memory.calmStreak = 0;
        }
      }
      if (memory.state === 'quarantined' && started === 'quarantined' && memory.calmStreak >= cfg.recover_ticks) {
        this.transition(transitions, node, nowMs, 'quarantined', 'recovering', residual);
        memory.state = 'recovering';
        memory.sPos = 0;
        memory.sNeg = 0;
        cusum = 0;
        memory.quarantinedSinceMs = null;
        memory.calmStreak = 0;
        memory.recoverCalmStreak = 0;
      }
      if (memory.state === 'recovering' && started === 'recovering') {
        if (Math.abs(z) >= cfg.z_suspect) {
          this.transition(transitions, node, nowMs, 'recovering', 'quarantined', residual);
          memory.state = 'quarantined';
          memory.quarantinedSinceMs = nowMs;
          memory.recoverCalmStreak = 0;
        } else if (calm) {
          memory.recoverCalmStreak += 1;
          if (memory.recoverCalmStreak >= cfg.trusted_after_ticks) {
            this.transition(transitions, node, nowMs, 'recovering', 'trusted', residual);
            memory.state = 'trusted';
            memory.recoverCalmStreak = 0;
          }
        } else {
          memory.recoverCalmStreak = 0;
        }
      }
    }

    if (node.osc_residual_ms !== null) {
      pushSample(memory.oscRaw, { tMs: nowMs, value: node.osc_residual_ms }, oldest);
    }
    if (memory.state === 'trusted') {
      if (hasPeer) pushSample(memory.peerHist, { tMs: nowMs, value: residual }, oldest);
      if (gnssPresent && node.gnss_resid_ms !== null) {
        pushSample(memory.gnssHist, { tMs: nowMs, value: node.gnss_resid_ms }, oldest);
      }
      if (cameraPresent && node.camera_resid_ms !== null) {
        pushSample(memory.cameraHist, { tMs: nowMs, value: node.camera_resid_ms }, oldest);
      }
      if (oscDiff !== null) pushSample(memory.oscDiffHist, { tMs: nowMs, value: oscDiff }, oldest);
    }

    const streams: StreamReading[] = [];
    if (hasPeer) {
      streams.push({ stream: 'peer', residual_ms: residual, z, flagged: peerFlagged });
    }
    if (oscReading) streams.push({ stream: 'oscillator', ...oscReading });
    if (gnssReading) streams.push({ stream: 'gnss', ...gnssReading });
    if (cameraReading) streams.push({ stream: 'camera', ...cameraReading });

    const reasons: ReasonCode[] = [];
    if (insufficient) reasons.push('INSUFFICIENT_PEERS');
    if (peerFlagged) reasons.push('PEER_OUTLIER');
    if (drift) reasons.push('CUSUM_DRIFT');
    if (oscReading?.flagged) reasons.push('OSC_STEP');
    if (gnssReading?.flagged) reasons.push('GNSS_DISAGREE');
    if (cameraReading?.flagged) reasons.push('CAMERA_DISAGREE');
    if (node.integrity.bad_signature) reasons.push('BAD_SIGNATURE');
    if (node.integrity.chain_break) reasons.push('CHAIN_BREAK');
    if (node.integrity.heartbeat_gap) reasons.push('HEARTBEAT_GAP');

    const sigmaTotal = Math.sqrt(peerSigma * peerSigma + anchorSigma * anchorSigma);
    let confidence = this.confidence(memory.state, hasPeer ? residual : 0, sigmaTotal);
    if (insufficient) confidence = Math.min(confidence, 0.5);

    return {
      node_id: node.node_id,
      t_ms: nowMs,
      state: memory.state,
      error_est_ms: hasPeer ? residual : 0,
      sigma_ms: peerSigma,
      z,
      cusum,
      confidence,
      streams,
      reasons,
      suspected_cause: this.cause(
        memory.state,
        peerFlagged,
        gnssPresent,
        gnssReading?.flagged === true,
        oscReading?.flagged === true,
        cameraReading?.flagged === true,
        drift,
        node.integrity.heartbeat_gap,
      ),
      quarantined_since_ms: memory.quarantinedSinceMs,
    };
  }

  private secondary(
    history: Sample[],
    value: number | null,
    nowMs: number,
    windowMs: number,
  ): { residual_ms: number; z: number; flagged: boolean } | null {
    if (value === null) return null;
    const sigma = sigmaHat(history, nowMs, windowMs, this.config.min_sigma_ms);
    const z = sigma === 0 ? 0 : value / sigma;
    return {
      residual_ms: value,
      z,
      flagged: Math.abs(z) >= this.config.z_suspect,
    };
  }

  private oscDifference(memory: NodeMemory, current: number | null, nowMs: number): number | null {
    if (current === null) return null;
    const target = nowMs - this.config.osc_window_s * 1000;
    let prior: Sample | null = null;
    for (const sample of memory.oscRaw) {
      if (sample.tMs <= target && (prior === null || sample.tMs > prior.tMs)) prior = sample;
    }
    if (prior === null || target - prior.tMs > 1500) return null;
    return current - prior.value;
  }

  private confidence(state: TrustState, mu: number, sigmaTotal: number): number {
    const gate = this.config.gate[state];
    if (!(sigmaTotal > 0)) {
      const certain = Math.abs(mu) <= this.config.tolerance_ms ? gate : 0;
      return Math.min(1, Math.max(0, certain));
    }
    const tol = this.config.tolerance_ms;
    const probability =
      normalCdf((tol - mu) / sigmaTotal) - normalCdf((-tol - mu) / sigmaTotal);
    const value = gate * probability;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private cause(
    state: TrustState,
    peerFlagged: boolean,
    gnssPresent: boolean,
    gnssFlagged: boolean,
    oscFlagged: boolean,
    cameraFlagged: boolean,
    drift: boolean,
    heartbeatGap: boolean,
  ): SuspectedCause {
    if (state === 'trusted') return 'none';
    if (peerFlagged && gnssPresent && !gnssFlagged) return 'gnss_spoof';
    if (peerFlagged && (gnssFlagged || oscFlagged)) return 'local_clock';
    if (cameraFlagged && !peerFlagged) return 'camera_path';
    if ((peerFlagged && !drift) || heartbeatGap) return 'network';
    return 'unknown';
  }

  private transition(
    transitions: Transition[],
    node: NodeTickInput,
    nowMs: number,
    from: TrustState,
    to: TrustState,
    errorEstMs: number,
  ): void {
    const reasons: ReasonCode[] = [];
    if (node.integrity.bad_signature) reasons.push('BAD_SIGNATURE');
    if (node.integrity.chain_break) reasons.push('CHAIN_BREAK');
    transitions.push({
      node_id: node.node_id,
      from,
      to,
      at_ms: nowMs,
      reasons,
      error_est_ms: errorEstMs,
    });
  }
}

export function createEngine(): IEngine {
  return new Engine();
}
