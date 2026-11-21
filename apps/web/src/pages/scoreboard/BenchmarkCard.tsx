import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ENGINE_CONFIG, SOCKET_EVENTS } from '@chronyx/contracts';
import type { BenchScenario, BenchmarkRun, BenchmarkRunReq } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { getDashboardSocket } from '../../api/socket.js';
import { useConnectionStatus } from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { InfoTip } from '../../ui/InfoTip.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { GlassPanel } from '../../present/LiquidGlass.js';

interface BenchmarkProgressEvent {
  run_id: string;
  done: number;
  total: number;
}

const SCENARIO_OPTIONS: ReadonlyArray<{ value: BenchScenario; label: string }> = [
  { value: 'jump', label: 'Jump' },
  { value: 'ramp', label: 'Ramp (slow drag)' },
  { value: 'clean', label: 'Clean (false alarms)' },
];

function formatDist(dist: { median: number; p90: number } | null, unit: string): string {
  if (!dist) return '--';
  return `${dist.median.toFixed(2)} ${unit} (p90: ${dist.p90.toFixed(2)} ${unit})`;
}

export function BenchmarkCard() {
  const connectionStatus = useConnectionStatus();

  const [scenario, setScenario] = useState<BenchScenario>('jump');
  const [repeats, setRepeats] = useState<number>(50);
  const [seed, setSeed] = useState<number>(DEFAULT_ENGINE_CONFIG.seed);

  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [progressById, setProgressById] = useState<Record<string, { done: number; total: number }>>(
    {},
  );

  const [loadingRuns, setLoadingRuns] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);
    try {
      const list = await api.getBenchmarks();
      setRuns(list);
      setSelectedRunId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load benchmark runs');
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const fetchSingleRun = useCallback(async (runId: string) => {
    try {
      const run = await api.getBenchmark(runId);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      setSelectedRunId(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch benchmark result');
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  // Listen for live benchmark:progress Socket.IO events (Part E2c)
  useEffect(() => {
    const socket = getDashboardSocket();
    if (!socket) return;

    const handleProgress = (evt: BenchmarkProgressEvent) => {
      if (!evt || typeof evt.run_id !== 'string') return;
      setProgressById((prev) => ({
        ...prev,
        [evt.run_id]: { done: evt.done, total: evt.total },
      }));

      setRuns((prev) =>
        prev.map((r) =>
          r.id === evt.run_id
            ? {
              ...r,
              status: evt.done >= evt.total ? r.status : 'running',
              progress: { done: evt.done, total: evt.total },
            }
            : r,
        ),
      );

      if (evt.total > 0 && evt.done >= evt.total) {
        void fetchSingleRun(evt.run_id);
      }
    };

    socket.on(SOCKET_EVENTS.BENCHMARK_PROGRESS, handleProgress);
    return () => {
      socket.off(SOCKET_EVENTS.BENCHMARK_PROGRESS, handleProgress);
    };
  }, [connectionStatus, fetchSingleRun]);

  const handleRunBenchmark = async (e: React.FormEvent) => {
    e.preventDefault();
    const clampedRepeats = Math.min(500, Math.max(1, Math.round(repeats)));
    const req: BenchmarkRunReq = {
      scenario,
      repeats: clampedRepeats,
      seed: Math.round(seed),
    };

    setSubmitting(true);
    setError(null);
    try {
      const { run_id } = await api.runBenchmark(req);
      setProgressById((prev) => ({
        ...prev,
        [run_id]: { done: 0, total: clampedRepeats },
      }));
      setSelectedRunId(run_id);
      await fetchSingleRun(run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start benchmark run');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const activeProgress = useMemo(() => {
    if (!selectedRun) return null;
    const live = progressById[selectedRun.id];
    const done = live ? live.done : selectedRun.progress.done;
    const total = live ? live.total : selectedRun.progress.total;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    return { done, total, pct };
  }, [selectedRun, progressById]);

  const handleExportBenchmark = () => {
    if (!selectedRun) return;
    const blob = new Blob([JSON.stringify(selectedRun, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronyx-benchmark-${selectedRun.scenario}-${selectedRun.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="scoreboard-benchmark">
      <GlassPanel tone={selectedRun?.status === 'done' ? 'emerald' : 'violet'}>
        <div className="space-y-5">
          {/* Card Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-white/12">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-300">
                  Simulated Noise Harness
                </span>
                <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-violet-400/20 border border-violet-300/45 text-violet-100">
                  Simulated noise
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-lg font-bold text-white">Benchmark (simulated noise)</h3>
                <InfoTip text="Runs fast-forward deterministic Monte Carlo trials against the real detection engine using simulated Gaussian noise." />
              </div>
              <p className="text-xs text-slate-300/85">
                Seeded repeatability harness (1–500 trials, fast-forward simulation) — separate from
                live session evidence above
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchRuns()}
                className="text-slate-200 hover:bg-white/10"
              >
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!selectedRun}
                onClick={handleExportBenchmark}
                className="bg-white/[0.08] border-white/20 text-white hover:bg-violet-400/20 hover:border-violet-300/45 hover:-translate-y-[1px]"
              >
                Export JSON
              </Button>
            </div>
          </div>

          {/* Compact Experiment Control Surface */}
          <form
            onSubmit={(e) => void handleRunBenchmark(e)}
            className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end p-3.5 rounded-xl bg-black/35 border border-white/15 backdrop-blur-md"
          >
            <label className="sm:col-span-4 block space-y-1 text-xs">
              <span className="font-mono text-[10px] uppercase tracking-wider text-violet-200/85">
                Scenario
              </span>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value as BenchScenario)}
                className="w-full px-3 py-2 rounded-lg bg-[#0A1328]/85 border border-white/18 text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-300/60"
              >
                {SCENARIO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="sm:col-span-3 block space-y-1 text-xs">
              <span className="font-mono text-[10px] uppercase tracking-wider text-violet-200/85">
                Repeats (1–500)
              </span>
              <input
                type="number"
                min={1}
                max={500}
                value={repeats}
                onChange={(e) => setRepeats(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0A1328]/85 border border-white/18 text-white font-mono text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-300/60"
              />
            </label>

            <label className="sm:col-span-2 block space-y-1 text-xs">
              <span className="font-mono text-[10px] uppercase tracking-wider text-violet-200/85">
                Seed
              </span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0A1328]/85 border border-white/18 text-white font-mono text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-300/60"
              />
            </label>

            <div className="sm:col-span-3">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={submitting}
                disabled={submitting}
                className="w-full py-2 hover:-translate-y-[1px] shadow-[0_0_20px_rgba(61,214,245,0.3)]"
              >
                Run Benchmark
              </Button>
            </div>
          </form>

          {/* Error banner */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/18 border border-rose-300/40 text-xs text-rose-100 flex items-center justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void fetchRuns()}
                className="underline font-semibold hover:text-white"
              >
                Retry
              </button>
            </div>
          )}

          {/* Run Selector (when multiple runs exist) */}
          {runs.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-300 mr-1">
                Recent runs:
              </span>
              {runs.slice(0, 6).map((run) => {
                const isSelected = selectedRun?.id === run.id;
                return (
                  <button
                    key={run.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`px-2.5 py-1 rounded-full font-mono border transition-all focus:outline-none focus:ring-2 focus:ring-violet-300/60 ${
                      isSelected
                        ? 'bg-violet-400/22 border-violet-300/55 text-white shadow-[0_0_16px_rgba(139,92,246,0.25)]'
                        : 'bg-white/[0.05] border-white/12 text-slate-300 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {`${run.scenario} (${run.repeats}x, ${run.status})`}
                  </button>
                );
              })}
            </div>
          )}

          {/* Body: Loading / Empty / Active Run Progress & Experiment Report */}
          {loadingRuns && runs.length === 0 ? (
            <div className="space-y-2">
              <Skeleton height={24} />
              <Skeleton height={110} />
            </div>
          ) : !selectedRun ? (
            <EmptyState
              title="No benchmark runs yet"
              description="Choose a scenario, repeat count, and seed above, then click Run Benchmark to evaluate the detector under simulated noise."
            />
          ) : (
            <div className="p-4 rounded-xl bg-black/35 border border-white/15 backdrop-blur-md space-y-4">
              {/* Status & Progress Bar */}
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono">
                    <span className="text-white font-bold uppercase tracking-wide">
                      {selectedRun.scenario}
                    </span>
                    <span className="text-violet-200/80">{`seed=${selectedRun.seed}`}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${
                        selectedRun.status === 'done'
                          ? 'bg-emerald-400/18 text-emerald-200 border-emerald-300/45 shadow-[0_0_12px_rgba(16,185,129,0.22)]'
                          : selectedRun.status === 'failed'
                            ? 'bg-rose-500/20 text-rose-200 border-rose-300/45'
                            : 'bg-cyan-400/18 text-cyan-200 border-cyan-300/45'
                      }`}
                    >
                      {selectedRun.status}
                    </span>
                  </div>
                  {activeProgress && (
                    <span className="font-mono text-slate-200 tabular-nums">
                      {`${activeProgress.done} / ${activeProgress.total} (${activeProgress.pct}%)`}
                    </span>
                  )}
                </div>

                {activeProgress && (
                  <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-150 ${
                        selectedRun.status === 'failed'
                          ? 'bg-gradient-to-r from-rose-500 to-fuchsia-400'
                          : selectedRun.status === 'done'
                            ? 'bg-gradient-to-r from-emerald-400 to-cyan-300'
                            : 'bg-gradient-to-r from-cyan-400 to-violet-400'
                      }`}
                      style={{ width: `${activeProgress.pct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Results Grid (strictly from API BenchmarkRun.results) */}
              {selectedRun.status === 'failed' ? (
                <div className="p-3 rounded-xl bg-rose-500/18 border border-rose-300/40 text-xs text-rose-100">
                  Benchmark run failed on the server. Try running again or check server logs.
                </div>
              ) : selectedRun.results ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-violet-200/85 pt-2 border-t border-white/10">
                    <span>
                      {`Noise model: ${selectedRun.results.noise_model} · Nodes: ${selectedRun.results.n_nodes} · Repeats: ${selectedRun.repeats}`}
                    </span>
                    <span className="text-slate-400">{`run: ${selectedRun.id.slice(0, 8)}`}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-white/[0.045] border border-cyan-300/25 space-y-1">
                      <div className="text-[11px] text-slate-300">Time to detect</div>
                      <div className="font-mono text-sm font-bold text-cyan-200 tabular-nums">
                        {formatDist(selectedRun.results.time_to_detect_s, 's')}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.045] border border-cyan-300/25 space-y-1">
                      <div className="text-[11px] text-slate-300">Error at detection</div>
                      <div className="font-mono text-sm font-bold text-cyan-100 tabular-nums">
                        {formatDist(selectedRun.results.error_at_detect_ms, 'ms')}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.045] border border-white/15 space-y-1">
                      <div className="text-[11px] text-slate-300">Detect rate vs Baseline</div>
                      <div className="font-mono text-sm font-bold tabular-nums">
                        <span className="text-emerald-300">
                          {`${(selectedRun.results.detect_rate * 100).toFixed(1)}%`}
                        </span>
                        <span className="text-slate-400 font-normal"> vs </span>
                        <span className="text-rose-300">
                          {`${(selectedRun.results.baseline_detect_rate * 100).toFixed(1)}%`}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.045] border border-violet-300/25 space-y-1">
                      <div className="text-[11px] text-slate-300">False alarms / hour (clean)</div>
                      <div className="font-mono text-sm font-bold text-violet-200 tabular-nums">
                        {selectedRun.results.false_alarms_per_hour !== null
                          ? selectedRun.results.false_alarms_per_hour.toFixed(2)
                          : '--'}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.045] border border-white/15 space-y-1 sm:col-span-2">
                      <div className="text-[11px] text-slate-300">
                        Science size error (without vs with Chronyx)
                      </div>
                      <div className="font-mono text-sm font-bold tabular-nums">
                        {selectedRun.results.science_error_pct ? (
                          <>
                            <span className="text-rose-300">
                              {`${selectedRun.results.science_error_pct.without.toFixed(1)}%`}
                            </span>
                            <span className="text-slate-400 font-normal"> without vs </span>
                            <span className="text-cyan-200">
                              {`${selectedRun.results.science_error_pct.with.toFixed(1)}%`}
                            </span>
                            <span className="text-slate-400 font-normal"> with Chronyx</span>
                          </>
                        ) : (
                          <span className="text-slate-400">--</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-white/[0.04] border border-white/12 text-xs text-slate-300">
                  Benchmark is queued or running. Results will appear automatically when{' '}
                  <code className="font-mono text-cyan-200">benchmark:progress</code> completes.
                </div>
              )}
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
