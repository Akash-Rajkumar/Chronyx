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
    <div
      data-testid="scoreboard-benchmark"
      className={`mc-panel border-t-2 ${
        selectedRun?.status === 'done' ? 'border-t-trust-trusted/75' : 'border-t-indigo-400/75'
      } rounded-[14px] p-5 space-y-5`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-white/[0.08]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-indigo-300">
              Simulated Noise Harness
            </span>
            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-indigo-500/15 border border-indigo-400/35 text-indigo-200">
              Simulated noise
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-foreground">
              Benchmark (simulated noise)
            </h3>
            <InfoTip text="Runs fast-forward deterministic Monte Carlo trials against the real detection engine using simulated Gaussian noise." />
          </div>
          <p className="text-xs text-muted">
            Seeded repeatability harness (1–500 trials, fast-forward simulation) — separate from live
            session evidence above
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => void fetchRuns()}>
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!selectedRun}
            onClick={handleExportBenchmark}
          >
            Export JSON
          </Button>
        </div>
      </div>

      {/* Compact Experiment Control Bar */}
      <form
        onSubmit={(e) => void handleRunBenchmark(e)}
        className="mc-well grid grid-cols-1 sm:grid-cols-12 gap-3 items-end p-3.5 rounded-[10px]"
      >
        <label className="sm:col-span-4 block space-y-1 text-xs">
          <span className="text-muted">Scenario</span>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as BenchScenario)}
            className="mc-input w-full px-3 py-2 rounded-[8px] text-xs"
          >
            {SCENARIO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="sm:col-span-3 block space-y-1 text-xs">
          <span className="text-muted">Repeats (1–500)</span>
          <input
            type="number"
            min={1}
            max={500}
            value={repeats}
            onChange={(e) => setRepeats(Number(e.target.value))}
            className="mc-input w-full px-3 py-2 rounded-[8px] font-mono text-xs tabular-nums"
          />
        </label>

        <label className="sm:col-span-2 block space-y-1 text-xs">
          <span className="text-muted">Seed</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
            className="mc-input w-full px-3 py-2 rounded-[8px] font-mono text-xs tabular-nums"
          />
        </label>

        <div className="sm:col-span-3">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={submitting}
            className="w-full py-2"
          >
            Run Benchmark
          </Button>
        </div>
      </form>

      {error && (
        <div className="mc-well border-rose-400/30 border-l-2 border-l-trust-quarantined rounded-[10px] p-3 text-xs text-rose-100 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchRuns()}
            className="underline font-medium hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {runs.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-mono text-muted mr-1">Recent runs:</span>
          {runs.slice(0, 6).map((run) => {
            const isSelected = selectedRun?.id === run.id;
            return (
              <button
                key={run.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedRunId(run.id)}
                className={`px-2.5 py-1 rounded-[8px] font-mono border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
                  isSelected
                    ? 'bg-indigo-500/18 border-indigo-400/50 text-foreground'
                    : 'bg-black/30 border-white/[0.1] text-muted hover:border-white/[0.22] hover:text-foreground'
                }`}
              >
                {`${run.scenario} (${run.repeats}x, ${run.status})`}
              </button>
            );
          })}
        </div>
      )}

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
        <div className="mc-well rounded-[10px] p-4 space-y-4">
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <span className="text-foreground font-semibold uppercase">{selectedRun.scenario}</span>
                <span className="text-muted">seed={selectedRun.seed}</span>
                <span
                  className={`px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase border ${
                    selectedRun.status === 'done'
                      ? 'bg-trust-trusted/12 text-trust-trusted border-trust-trusted/30'
                      : selectedRun.status === 'failed'
                        ? 'bg-trust-quarantined/12 text-trust-quarantined border-trust-quarantined/30'
                        : 'bg-accent-cyan/12 text-accent-cyan border-accent-cyan/30'
                  }`}
                >
                  {selectedRun.status}
                </span>
              </div>
              {activeProgress && (
                <span className="font-mono text-muted tabular-nums">
                  {activeProgress.done} / {activeProgress.total} ({activeProgress.pct}%)
                </span>
              )}
            </div>

            {activeProgress && (
              <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-150 ${
                    selectedRun.status === 'failed'
                      ? 'bg-trust-quarantined'
                      : selectedRun.status === 'done'
                        ? 'bg-trust-trusted'
                        : 'bg-accent-cyan'
                  }`}
                  style={{ width: `${activeProgress.pct}%` }}
                />
              </div>
            )}
          </div>

          {selectedRun.status === 'failed' ? (
            <div className="p-3 rounded-[8px] bg-trust-quarantined/12 border border-trust-quarantined/30 text-xs text-rose-100">
              Benchmark run failed on the server. Try running again or check server logs.
            </div>
          ) : selectedRun.results ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-muted pt-2 border-t border-white/[0.07]">
                <span>
                  {`Noise model: ${selectedRun.results.noise_model} · Nodes: ${selectedRun.results.n_nodes} · Repeats: ${selectedRun.repeats}`}
                </span>
                <span>run: {selectedRun.id.slice(0, 8)}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-[8px] bg-white/[0.04] border border-white/[0.09] space-y-1">
                  <div className="text-[11px] text-muted">Time to detect</div>
                  <div className="font-mono text-sm font-semibold text-accent-cyan tabular-nums">
                    {formatDist(selectedRun.results.time_to_detect_s, 's')}
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white/[0.04] border border-white/[0.09] space-y-1">
                  <div className="text-[11px] text-muted">Error at detection</div>
                  <div className="font-mono text-sm font-semibold text-foreground tabular-nums">
                    {formatDist(selectedRun.results.error_at_detect_ms, 'ms')}
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white/[0.04] border border-white/[0.09] space-y-1">
                  <div className="text-[11px] text-muted">Detect rate vs Baseline</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    <span className="text-trust-trusted">
                      {`${(selectedRun.results.detect_rate * 100).toFixed(1)}%`}
                    </span>
                    <span className="text-muted font-normal"> vs </span>
                    <span className="text-trust-quarantined">
                      {`${(selectedRun.results.baseline_detect_rate * 100).toFixed(1)}%`}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white/[0.04] border border-white/[0.09] space-y-1">
                  <div className="text-[11px] text-muted">False alarms / hour (clean)</div>
                  <div className="font-mono text-sm font-semibold text-indigo-200 tabular-nums">
                    {selectedRun.results.false_alarms_per_hour !== null
                      ? selectedRun.results.false_alarms_per_hour.toFixed(2)
                      : '--'}
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white/[0.04] border border-white/[0.09] space-y-1 sm:col-span-2">
                  <div className="text-[11px] text-muted">
                    Science size error (without vs with Chronyx)
                  </div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {selectedRun.results.science_error_pct ? (
                      <>
                        <span className="text-trust-quarantined">
                          {`${selectedRun.results.science_error_pct.without.toFixed(1)}%`}
                        </span>
                        <span className="text-muted font-normal"> without vs </span>
                        <span className="text-accent-cyan">
                          {`${selectedRun.results.science_error_pct.with.toFixed(1)}%`}
                        </span>
                        <span className="text-muted font-normal"> with Chronyx</span>
                      </>
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-[8px] bg-white/[0.03] border border-white/[0.08] text-xs text-muted">
              Benchmark is queued or running. Results will appear automatically when{' '}
              <code className="font-mono text-accent-cyan">benchmark:progress</code> completes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
