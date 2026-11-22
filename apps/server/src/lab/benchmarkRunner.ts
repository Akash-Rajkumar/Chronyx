import crypto from 'node:crypto';
import {
  DEMO_PRESETS,
  SOCKET_EVENTS,
} from '@chronyx/contracts';
import type {
  BenchmarkRun,
  BenchmarkRunReq,
  Dist,
  EngineTickInput,
  NodeTickInput,
  UUID,
} from '@chronyx/contracts';
import { createEngine } from '@chronyx/engine';
import { replayScience } from '@chronyx/sim';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx]!;
}

function computeDist(values: readonly number[]): Dist | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: Number(quantile(sorted, 0.5).toFixed(3)),
    p90: Number(quantile(sorted, 0.9).toFixed(3)),
  };
}

const NODE_IDS: readonly UUID[] = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
];

const PEER_NOISE_MS = 0.3;
const OSC_NOISE_MS = 0.05;
const GNSS_NOISE_MS = 0.05;
const CAMERA_NOISE_MS = 0.1;

interface TrialOutcome {
  detected: boolean;
  timeToDetectS: number | null;
  errorAtDetectMs: number | null;
  falseAlarms: number;
  cleanSeconds: number;
}

function runSingleTrial(req: BenchmarkRunReq, trialIdx: number): TrialOutcome {
  const rng = mulberry32((req.seed ^ Math.imul(trialIdx + 1, 2654435761)) >>> 0);
  const engine = createEngine();
  const biases = NODE_IDS.map(() => (rng() - 0.5) * 0.4);

  const warmupTicks = 10;
  const offsetMs = req.params?.offset_ms ?? DEMO_PRESETS.jump_offset_ms;
  const rateMsPerMin = req.params?.rate_ms_per_min ?? DEMO_PRESETS.slow_drag_rate_ms_per_min;
  const maxEvalTicks = req.scenario === 'jump' ? 30 : req.scenario === 'ramp' ? 180 : 60;
  const baseTimeMs = 1_700_000_000_000;

  let falseAlarms = 0;
  const totalTicks = warmupTicks + maxEvalTicks;

  for (let tick = 0; tick < totalTicks; tick++) {
    const nowMs = baseTimeMs + tick * 1000;
    const elapsedFaultS = tick >= warmupTicks ? tick - warmupTicks + 1 : 0;

    let injectedErrorMs = 0;
    if (elapsedFaultS > 0) {
      if (req.scenario === 'jump') {
        injectedErrorMs = offsetMs;
      } else if (req.scenario === 'ramp') {
        injectedErrorMs = (rateMsPerMin / 60) * elapsedFaultS;
      }
    }

    const nodes: NodeTickInput[] = NODE_IDS.map((nodeId, idx) => {
      const faultContribution = idx === 0 ? injectedErrorMs : 0;
      const trueErr = biases[idx]! + faultContribution;
      return {
        node_id: nodeId,
        online: true,
        peer_offset_ms: trueErr + gaussian(rng) * PEER_NOISE_MS,
        osc_residual_ms: faultContribution + gaussian(rng) * OSC_NOISE_MS,
        gnss_resid_ms: trueErr + gaussian(rng) * GNSS_NOISE_MS,
        camera_resid_ms: trueErr + gaussian(rng) * CAMERA_NOISE_MS,
        health: {
          cn0_dbhz: 45 + gaussian(rng) * 0.4,
          agc_db: 20 + gaussian(rng) * 0.2,
          rtt_ms: 2.0 + Math.abs(gaussian(rng) * 0.3),
        },
        integrity: {
          bad_signature: false,
          chain_break: false,
          heartbeat_gap: false,
        },
      };
    });

    const input: EngineTickInput = {
      now_ms: nowMs,
      nodes,
      anchor: { ok: true, offset_ms: 0, sigma_ms: 0.5 },
    };

    const output = engine.tick(input);

    if (tick >= warmupTicks) {
      if (req.scenario === 'clean') {
        for (const tr of output.transitions) {
          if (tr.to === 'suspect' || tr.to === 'quarantined') {
            falseAlarms += 1;
          }
        }
      } else {
        const target = output.assessments.find((a) => a.node_id === NODE_IDS[0]);
        if (target && (target.state === 'suspect' || target.state === 'quarantined')) {
          return {
            detected: true,
            timeToDetectS: elapsedFaultS,
            errorAtDetectMs: Math.abs(injectedErrorMs),
            falseAlarms: 0,
            cleanSeconds: 0,
          };
        }
      }
    }
  }

  return {
    detected: false,
    timeToDetectS: null,
    errorAtDetectMs: null,
    falseAlarms,
    cleanSeconds: req.scenario === 'clean' ? maxEvalTicks : 0,
  };
}

export class BenchmarkService {
  private readonly runs = new Map<UUID, BenchmarkRun>();

  public constructor(
    private readonly emit: (event: string, payload: unknown) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public list(): BenchmarkRun[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }

  public get(id: UUID): BenchmarkRun | undefined {
    return this.runs.get(id);
  }

  public start(req: BenchmarkRunReq): BenchmarkRun {
    const id = crypto.randomUUID() as UUID;
    const run: BenchmarkRun = {
      id,
      status: 'running',
      scenario: req.scenario,
      repeats: req.repeats,
      seed: req.seed,
      params: req.params ?? {},
      created_at: new Date(this.now()).toISOString(),
      progress: { done: 0, total: req.repeats },
      results: null,
    };

    this.runs.set(id, run);

    // Keep memory bounded to latest 30 benchmark runs
    if (this.runs.size > 30) {
      const oldest = this.list().at(-1);
      if (oldest) this.runs.delete(oldest.id);
    }

    this.executeAsync(id, req);
    return run;
  }

  private executeAsync(id: UUID, req: BenchmarkRunReq): void {
    const total = req.repeats;
    const batchSize = Math.max(1, Math.min(10, Math.ceil(total / 15)));
    let done = 0;

    const detectTimes: number[] = [];
    const detectErrors: number[] = [];
    let detectedCount = 0;
    let totalFalseAlarms = 0;
    let totalCleanSeconds = 0;

    const stepBatch = () => {
      const current = this.runs.get(id);
      if (!current) return;

      try {
        const end = Math.min(total, done + batchSize);
        for (let i = done; i < end; i++) {
          const outcome = runSingleTrial(req, i);
          if (outcome.detected) {
            detectedCount += 1;
            if (outcome.timeToDetectS !== null) detectTimes.push(outcome.timeToDetectS);
            if (outcome.errorAtDetectMs !== null) detectErrors.push(outcome.errorAtDetectMs);
          }
          totalFalseAlarms += outcome.falseAlarms;
          totalCleanSeconds += outcome.cleanSeconds;
        }
        done = end;

        current.progress = { done, total };

        if (done < total) {
          this.emit(SOCKET_EVENTS.BENCHMARK_PROGRESS, { run_id: id, done, total });
          setTimeout(stepBatch, 20);
          return;
        }

        // Compute final aggregate metrics from real engine trials
        const timeDist = computeDist(detectTimes);
        const errDist = computeDist(detectErrors);
        const detectRate = req.scenario === 'clean' ? 0 : detectedCount / Math.max(1, total);
        const falseAlarmsPerHour =
          req.scenario === 'clean'
            ? Number(((totalFalseAlarms / Math.max(1, totalCleanSeconds)) * 3600).toFixed(2))
            : 0;

        let scienceErrorPct: { without: number; with: number } | null = null;
        if (req.scenario !== 'clean') {
          const faultMsForScience =
            errDist?.median ??
            (req.scenario === 'jump'
              ? (req.params?.offset_ms ?? DEMO_PRESETS.jump_offset_ms)
              : 5);
          const withoutChronyx = replayScience({
            fault_ms: faultMsForScience,
            faulty_station: 2,
            dropFaulty: false,
            trials: Math.min(50, total),
            seed: req.seed,
          });
          const withChronyx = replayScience({
            fault_ms: faultMsForScience,
            faulty_station: 2,
            dropFaulty: true,
            trials: Math.min(50, total),
            seed: req.seed,
          });
          scienceErrorPct = {
            without: Number(withoutChronyx.mean_size_error_pct.toFixed(2)),
            with: Number(withChronyx.mean_size_error_pct.toFixed(2)),
          };
        }

        current.status = 'done';
        current.progress = { done: total, total };
        current.results = {
          noise_model: 'simulated',
          n_nodes: NODE_IDS.length,
          time_to_detect_s: timeDist,
          error_at_detect_ms: errDist,
          detect_rate: Number(detectRate.toFixed(4)),
          false_alarms_per_hour: falseAlarmsPerHour,
          baseline_detect_rate: 0,
          science_error_pct: scienceErrorPct,
        };

        this.emit(SOCKET_EVENTS.BENCHMARK_PROGRESS, { run_id: id, done: total, total });
      } catch {
        current.status = 'failed';
        this.emit(SOCKET_EVENTS.BENCHMARK_PROGRESS, { run_id: id, done, total });
      }
    };

    setTimeout(stepBatch, 20);
  }
}
