import type {
  Exchange,
  Fault,
  HeartbeatBody,
  ISim,
  NodeInfo,
  SimNodeOutput,
  UUID,
} from '@chronyx/contracts';
import { GENESIS_PREV_HASH } from '@chronyx/contracts';
import { createSignedHeartbeat, getPublicKeyBase64, hexToBytes, sha256hex } from '@chronyx/crypto';
import {
  cameraDelayMs,
  createFaultRng,
  faultContributionMs,
  gnssClockFollowMs,
  gnssSpoofHealthDelta,
  noiseBurstStreamsMs,
} from './faults.js';

const DEFAULT_SEED = 42;
const DEFAULT_NAMES = ['V-Alpha', 'V-Bravo', 'V-Charlie'] as const;

/** Standard deviation of each timing stream, milliseconds. */
const PEER_NOISE_MS = 0.3;
const OSC_NOISE_MS = 0.05;
const GNSS_NOISE_MS = 0.05;
const CAMERA_NOISE_MS = 0.1;
const CN0_MEAN_DBHZ = 45;
const AGC_MEAN_DB = 20;
const CN0_NOISE_DBHZ = 0.5;
const AGC_NOISE_DB = 0.2;

const MAX_BIAS_MS = 0.5;
const MAX_DRIFT_PPM = 0.1;
const ONE_WAY_MS = 1;
const PROC_MS = 0.25;
const MAX_EXCHANGES = 8;

interface Rng {
  next(): number;
  fork(): Rng;
}

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    fork() {
      return mulberry32(state);
    },
  };
}

/** Box-Muller. Always consumes two uniform draws. */
function unitGaussian(next: () => number): number {
  const u1 = Math.max(next(), 1e-12);
  const u2 = next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function streamSeed(master: number, salt: string): number {
  return Number.parseInt(sha256hex(`${master}:${salt}`).slice(0, 8), 16);
}

function uuidFor(master: number, index: number, name: string): UUID {
  const hex = sha256hex(`chronyx-sim-uuid:${master}:${index}:${name}`).slice(0, 32);
  const chars = hex.split('');
  chars[12] = '4';
  const nibble = Number.parseInt(chars[16] ?? '0', 16);
  chars[16] = (8 + (nibble % 4)).toString(16);
  const h = chars.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function privateKeyFor(master: number, index: number, name: string): Uint8Array {
  return hexToBytes(sha256hex(`chronyx-sim-key:${master}:${index}:${name}`));
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

interface TimingTrack {
  originMs: number | null;
  exchanges: Exchange[];
  rng: Rng;
  info: NodeInfo;
}

interface VirtualNode {
  privateKey: Uint8Array;
  biasMs: number;
  driftPerMs: number;
  seq: number;
  prevHash: string;
  signed: TimingTrack;
  unsigned: TimingTrack;
}

/** Timing sample for benchmarks. It is not a Heartbeat and has no hash or signature. */
export interface UnsignedNodeSample {
  node_id: UUID;
  online: boolean;
  peer_offset_ms: number;
  osc_residual_ms: number;
  gnss_resid_ms: number;
  camera_resid_ms: number;
  health: { cn0_dbhz: number; agc_db: number };
}

interface AdvancedNode {
  info: NodeInfo;
  body: HeartbeatBody;
  gnss_resid_ms: number;
  camera_resid_ms: number;
}

export class Simulator implements ISim {
  private readonly seed: number;
  private readonly nodes: VirtualNode[] = [];
  private readonly faults = new Map<UUID, Fault>();
  private readonly noiseRngs = new Map<UUID, () => number>();

  public constructor(seed: number = DEFAULT_SEED) {
    this.seed = seed;
  }

  public async addVirtualNode(name: string): Promise<NodeInfo> {
    const index = this.nodes.length;
    const setup = mulberry32(streamSeed(this.seed, `${index}:${name}`));
    const biasMs = (setup.next() * 2 - 1) * MAX_BIAS_MS;
    const driftPpm = (setup.next() * 2 - 1) * MAX_DRIFT_PPM;
    const privateKey = privateKeyFor(this.seed, index, name);
    const publicKey = await getPublicKeyBase64(privateKey);
    const info: NodeInfo = {
      id: uuidFor(this.seed, index, name),
      name,
      kind: 'virtual',
      public_key: publicKey,
      created_at: isoFromMs(0),
      last_seen_at: null,
      online: true,
    };
    const track = (): TimingTrack => ({
      originMs: null,
      exchanges: [],
      rng: setup.fork(),
      info: { ...info },
    });
    this.nodes.push({
      privateKey,
      biasMs,
      driftPerMs: driftPpm * 1e-6,
      seq: 0,
      prevHash: GENESIS_PREV_HASH,
      signed: track(),
      unsigned: track(),
    });
    return info;
  }

  public async step(nowMs: number): Promise<SimNodeOutput[]> {
    const outputs: SimNodeOutput[] = [];
    for (const node of this.nodes) {
      outputs.push(await this.stepNode(node, nowMs));
    }
    return outputs;
  }

  /** Advances the same timing state as step() and does not sign a heartbeat. */
  public stepUnsigned(nowMs: number): UnsignedNodeSample[] {
    return this.nodes.map((node) => {
      const advanced = this.advanceNode(node, node.unsigned, nowMs, {
        seq: 0,
        prevHash: GENESIS_PREV_HASH,
      });
      const latest = advanced.body.exchange[advanced.body.exchange.length - 1];
      const peerOffsetMs = latest === undefined ? 0 : ((latest.t1 - latest.t2) + (latest.t4 - latest.t3)) / 2;
      return {
        node_id: advanced.info.id,
        online: advanced.info.online,
        peer_offset_ms: peerOffsetMs,
        osc_residual_ms: advanced.body.osc_residual_ms ?? 0,
        gnss_resid_ms: advanced.gnss_resid_ms,
        camera_resid_ms: advanced.camera_resid_ms,
        health: {
          cn0_dbhz: advanced.body.health?.cn0_dbhz ?? 0,
          agc_db: advanced.body.health?.agc_db ?? 0,
        },
      };
    });
  }

  public applyFault(fault: Fault): void {
    this.faults.set(fault.id, { ...fault, params: { ...fault.params } });
    if (fault.type === 'noise_burst') {
      this.noiseRngs.set(fault.id, createFaultRng(streamSeed(this.seed, `noise:${fault.id}`)));
    }
  }

  public stopFault(id: UUID): void {
    const existing = this.faults.get(id);
    if (!existing) return;
    this.faults.set(id, { ...existing, status: 'stopped' });
  }

  public faultOffsetMs(nodeId: UUID, nowMs: number): number {
    let sum = 0;
    for (const fault of this.faults.values()) {
      if (fault.node_id !== nodeId) continue;
      sum += faultContributionMs(fault, nowMs);
    }
    return sum;
  }

  private async stepNode(node: VirtualNode, nowMs: number): Promise<SimNodeOutput> {
    const advanced = this.advanceNode(node, node.signed, nowMs, {
      seq: node.seq,
      prevHash: node.prevHash,
    });
    const heartbeat = await createSignedHeartbeat(advanced.body, node.privateKey);
    node.prevHash = heartbeat.hash;
    node.seq += 1;
    return {
      node: advanced.info,
      heartbeat,
      gnss_resid_ms: advanced.gnss_resid_ms,
      camera_resid_ms: advanced.camera_resid_ms,
    };
  }

  private advanceNode(
    node: VirtualNode,
    track: TimingTrack,
    nowMs: number,
    chain: { seq: number; prevHash: string },
  ): AdvancedNode {
    if (track.originMs === null) track.originMs = nowMs;
    const elapsedMs = nowMs - track.originMs;
    const faultMs = this.faultOffsetMs(track.info.id, nowMs);
    const trueErrorMs = node.biasMs + node.driftPerMs * elapsedMs + faultMs;

    let gnssCancelMs = 0;
    let cameraExtraMs = 0;
    let burstPeerMs = 0;
    let burstOscMs = 0;
    let burstGnssMs = 0;
    let burstCameraMs = 0;
    let cn0Delta = 0;
    let agcDelta = 0;
    for (const fault of this.faults.values()) {
      if (fault.node_id !== track.info.id) continue;
      if (fault.type === 'gnss_spoof') {
        gnssCancelMs += gnssClockFollowMs(fault, nowMs);
        const health = gnssSpoofHealthDelta(fault, nowMs);
        cn0Delta += health.cn0Dbhz;
        agcDelta += health.agcDb;
      } else if (fault.type === 'camera_delay') {
        cameraExtraMs += cameraDelayMs(fault, nowMs);
      } else if (fault.type === 'noise_burst') {
        const next = this.noiseRngs.get(fault.id);
        if (!next) continue;
        const burst = noiseBurstStreamsMs(fault, nowMs, next);
        burstPeerMs += burst.peer;
        burstOscMs += burst.oscillator;
        burstGnssMs += burst.gnss;
        burstCameraMs += burst.camera;
      }
    }

    const next = () => track.rng.next();
    const peerNoise = unitGaussian(next) * PEER_NOISE_MS + burstPeerMs;
    const oscNoise = unitGaussian(next) * OSC_NOISE_MS + burstOscMs;
    const gnssNoise = unitGaussian(next) * GNSS_NOISE_MS + burstGnssMs;
    const cameraNoise = unitGaussian(next) * CAMERA_NOISE_MS + burstCameraMs;
    const cn0 = CN0_MEAN_DBHZ + unitGaussian(next) * CN0_NOISE_DBHZ + cn0Delta;
    const agc = AGC_MEAN_DB + unitGaussian(next) * AGC_NOISE_DB + agcDelta;

    const t2 = nowMs;
    const t3 = nowMs + PROC_MS;
    const t1 = nowMs - ONE_WAY_MS + trueErrorMs;
    const t4 = t3 + ONE_WAY_MS + trueErrorMs + 2 * peerNoise;
    const exchange: Exchange = { t1, t2, t3, t4 };
    track.exchanges.push(exchange);
    if (track.exchanges.length > MAX_EXCHANGES) track.exchanges.shift();

    const body: HeartbeatBody = {
      node_id: track.info.id,
      seq: chain.seq,
      t_local_ms: t1,
      prev_hash: chain.prevHash,
      exchange: track.exchanges.map((item) => ({ ...item })),
      osc_residual_ms: trueErrorMs - node.biasMs + oscNoise,
      health: { cn0_dbhz: cn0, agc_db: agc },
    };
    const info: NodeInfo = { ...track.info, last_seen_at: isoFromMs(nowMs), online: true };
    track.info = info;

    return {
      info,
      body,
      gnss_resid_ms: trueErrorMs - gnssCancelMs + gnssNoise,
      camera_resid_ms: trueErrorMs + cameraNoise + cameraExtraMs,
    };
  }
}

export async function createSim(seed: number = DEFAULT_SEED): Promise<Simulator> {
  const sim = new Simulator(seed);
  for (const name of DEFAULT_NAMES) {
    await sim.addVirtualNode(name);
  }
  return sim;
}
