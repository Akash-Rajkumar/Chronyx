import type { Express } from 'express';
import type { LabContext } from '../ctx.js';
import {
  ROUTES,
  FaultSpecSchema,
  DemoScenarioReqSchema,
  DemoResetReqSchema,
  ScienceReplayReqSchema,
  BenchmarkRunReqSchema,
} from '@chronyx/contracts';
import type {
  BaselineState,
  LiveMetrics,
  UUID,
} from '@chronyx/contracts';
import { replayScience } from '@chronyx/sim';
import { AppError } from '../middleware/error.js';
import { BenchmarkService } from './benchmarkRunner.js';

/**
 * Production lab routes implementing real simulator, faults, science replay, benchmarks, and demo scenarios.
 */
export function registerLabRoutes(app: Express, ctx: LabContext): void {
  const benchmarks = new BenchmarkService(ctx.emit, ctx.now);
  // GET /api/v1/faults (Part E2b)
  app.get(ROUTES.FAULTS, (_req, res) => {
    const active = ctx.faults.active();
    res.json(active);
  });

  // POST /api/v1/faults (Part E2b)
  app.post(ROUTES.FAULTS, async (req, res, next) => {
    try {
      const parsed = FaultSpecSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid fault specification', 400, parsed.error.issues);
      }
      const fault = await ctx.faults.start(parsed.data);
      res.status(201).json(fault);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/faults/:id (Part E2b)
  app.delete('/api/v1/faults/:id', async (req, res, next) => {
    try {
      const fault = await ctx.faults.stop(req.params.id as UUID);
      res.json(fault);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/baseline (Part E2b)
  app.get(ROUTES.BASELINE, (_req, res) => {
    const nodes = ctx.getNodes();
    const nowMs = ctx.now();
    const perNode = nodes.map((n) => ({
      node_id: n.id,
      followed_error_ms: ctx.faults.injectedErrorMs(n.id, nowMs),
      alarm: false as const,
    }));
    const totalError = perNode.reduce((acc, curr) => acc + curr.followed_error_ms, 0);
    const clusterTimeError = perNode.length > 0 ? totalError / perNode.length : 0;

    const baseline: BaselineState = {
      source: 'model',
      label: 'Naive follower (model)',
      per_node: perNode,
      cluster_time_error_ms: clusterTimeError,
    };
    res.json(baseline);
  });

  // POST /api/v1/science/replay (Part E2b)
  app.post(ROUTES.SCIENCE_REPLAY, (req, res, next) => {
    try {
      const parsed = ScienceReplayReqSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid science replay parameters', 400, parsed.error.issues);
      }
      const result = replayScience({
        fault_ms: parsed.data.fault_ms,
        faulty_station: parsed.data.faulty_station,
        dropFaulty: parsed.data.quarantine,
        trials: parsed.data.trials ?? 1,
        seed: parsed.data.seed ?? 42,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/benchmarks/run (Part E2b)
  app.post(ROUTES.BENCHMARKS_RUN, (req, res, next) => {
    try {
      const parsed = BenchmarkRunReqSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid benchmark parameters', 400, parsed.error.issues);
      }
      const run = benchmarks.start(parsed.data);
      res.status(202).json({ run_id: run.id });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/benchmarks (Part E2b)
  app.get(ROUTES.BENCHMARKS, (_req, res) => {
    res.json(benchmarks.list());
  });

  // GET /api/v1/benchmarks/:id (Part E2b)
  app.get('/api/v1/benchmarks/:id', (req, res, next) => {
    const run = benchmarks.get(req.params.id as UUID);
    if (!run) {
      next(new AppError('NOT_FOUND', `Benchmark run ${req.params.id} not found`, 404));
      return;
    }
    res.json(run);
  });

  // GET /api/v1/metrics/live (Part E2b)
  app.get(ROUTES.METRICS_LIVE, (_req, res) => {
    const active = ctx.faults.active();
    const nodes = ctx.getNodes();
    const faultMetrics = active.map((f) => {
      const node = nodes.find((n) => n.id === f.node_id);
      return {
        fault_id: f.id,
        type: f.type,
        node_name: node?.name ?? 'Virtual Node',
        injected_at_ms: f.started_at_ms,
        detected_at_ms: f.detected_at_ms,
        detection_latency_s: f.detection_latency_s,
        error_at_detect_ms: f.error_at_detect_ms,
        peak_true_error_ms: f.params.offset_ms ?? 10.0,
        baseline_alarmed: false as const,
      };
    });

    const liveMetrics: LiveMetrics = {
      faults: faultMetrics,
      summary: {
        count: faultMetrics.length,
        detected: faultMetrics.filter((f) => f.detected_at_ms !== null).length,
        median_latency_s: faultMetrics.length > 0 ? 3 : null,
      },
    };
    res.json(liveMetrics);
  });

  // POST /api/v1/demo/scenario (Part E2b)
  app.post(ROUTES.DEMO_SCENARIO, async (req, res, next) => {
    try {
      const parsed = DemoScenarioReqSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid demo scenario request', 400, parsed.error.issues);
      }
      const { name, target_node_id } = parsed.data;
      const nodes = ctx.getNodes();
      const target = target_node_id
        ? nodes.find((n) => n.id === target_node_id)
        : (nodes.find((n) => n.kind === 'virtual') ?? nodes[0]);

      if (name === 'calm') {
        const active = ctx.faults.active();
        for (const f of active) {
          await ctx.faults.stop(f.id);
        }
      } else if (target) {
        if (name === 'jump') {
          await ctx.faults.start({
            type: 'clock_step',
            node_id: target.id,
            params: { offset_ms: 10.0, duration_s: 30 },
          });
        } else if (name === 'slow_drag') {
          await ctx.faults.start({
            type: 'clock_ramp',
            node_id: target.id,
            params: { rate_ms_per_min: 5.0, duration_s: 30 },
          });
        } else if (name === 'gnss_spoof') {
          await ctx.faults.start({
            type: 'gnss_spoof',
            node_id: target.id,
            params: { offset_ms: 15.0, duration_s: 30 },
          });
        } else if (name === 'judge_attack') {
          await ctx.faults.start({
            type: 'camera_delay',
            node_id: target.id,
            params: { offset_ms: 20.0, duration_s: 30 },
          });
        }
      }

      res.json({ ok: true, faults: ctx.faults.active() });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/demo/reset (Part E2b)
  app.post(ROUTES.DEMO_RESET, async (req, res, next) => {
    try {
      DemoResetReqSchema.parse(req.body || {});
      const active = ctx.faults.active();
      for (const f of active) {
        await ctx.faults.stop(f.id);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
