import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEMO_PRESETS } from '@chronyx/contracts';
import type { Fault, FaultParams, FaultSpec, FaultType, NodeInfo } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useAssessments,
  useConnectionStatus,
  useDashboardStore,
  useFaults,
  useIsLoading,
  useNodes,
  useStoreError,
} from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { InfoTip } from '../../ui/InfoTip.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { StateChip } from '../../ui/StateChip.js';

interface FaultTypeOption {
  type: FaultType;
  label: string;
  description: string;
  browserSupported: boolean;
}

const FAULT_TYPE_OPTIONS: ReadonlyArray<FaultTypeOption> = [
  {
    type: 'clock_step',
    label: 'Clock Step',
    description: 'Immediate jump in node clock offset (ms).',
    browserSupported: true,
  },
  {
    type: 'clock_ramp',
    label: 'Clock Ramp',
    description: 'Gradual drift rate (ms/min) with optional acceleration.',
    browserSupported: true,
  },
  {
    type: 'gnss_spoof',
    label: 'GNSS Spoof',
    description: 'Simulated satellite time drag with 30 s clock lag (virtual nodes only).',
    browserSupported: false,
  },
  {
    type: 'camera_delay',
    label: 'Camera Delay',
    description: 'Simulated camera-trigger timestamp offset (virtual nodes only).',
    browserSupported: false,
  },
  {
    type: 'noise_burst',
    label: 'Noise Burst',
    description: 'Temporary Gaussian jitter added to node timing streams.',
    browserSupported: true,
  },
];

interface FaultPreset {
  id: string;
  label: string;
  type: FaultType;
  params: FaultParams;
}

const FAULT_PRESETS: ReadonlyArray<FaultPreset> = [
  {
    id: 'jump',
    label: `Jump +${DEMO_PRESETS.jump_offset_ms} ms`,
    type: 'clock_step',
    params: { offset_ms: DEMO_PRESETS.jump_offset_ms, duration_s: null },
  },
  {
    id: 'slow_drag',
    label: `Slow drag (${DEMO_PRESETS.slow_drag_rate_ms_per_min} ms/min)`,
    type: 'clock_ramp',
    params: { rate_ms_per_min: DEMO_PRESETS.slow_drag_rate_ms_per_min, accel_ms_per_min2: 0, duration_s: null },
  },
  {
    id: 'gnss_spoof',
    label: 'GNSS spoof',
    type: 'gnss_spoof',
    params: {
      rate_ms_per_min: DEMO_PRESETS.gnss_spoof.rate_ms_per_min,
      accel_ms_per_min2: DEMO_PRESETS.gnss_spoof.accel_ms_per_min2,
      duration_s: null,
    },
  },
  {
    id: 'pmu_style',
    label: 'PMU-style ramp (inspired by published research, scaled to ms)',
    type: DEMO_PRESETS.pmu_style.type,
    params: {
      rate_ms_per_min: DEMO_PRESETS.pmu_style.rate_ms_per_min,
      accel_ms_per_min2: DEMO_PRESETS.pmu_style.accel_ms_per_min2,
      duration_s: null,
    },
  },
  {
    id: 'judge_attack',
    label: `Judge attack (${DEMO_PRESETS.judge_attack.rate_ms_per_min} ms/min)`,
    type: DEMO_PRESETS.judge_attack.type,
    params: {
      rate_ms_per_min: DEMO_PRESETS.judge_attack.rate_ms_per_min,
      accel_ms_per_min2: 0,
      duration_s: null,
    },
  },
];

function isFaultAllowedForNode(type: FaultType, node: NodeInfo | undefined): boolean {
  if (!node) return true;
  if (node.kind === 'virtual') return true;
  return type === 'clock_step' || type === 'clock_ramp' || type === 'noise_burst';
}

function formatElapsed(startedAtMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${mins}m ${rem}s`;
}

function formatFaultMagnitude(fault: Fault): string {
  if (fault.params.offset_ms !== undefined) {
    const sign = fault.params.offset_ms >= 0 ? '+' : '';
    return `${sign}${fault.params.offset_ms} ms`;
  }
  if (fault.params.rate_ms_per_min !== undefined) {
    const sign = fault.params.rate_ms_per_min >= 0 ? '+' : '';
    return `${sign}${fault.params.rate_ms_per_min} ms/min`;
  }
  if (fault.params.noise_sigma_ms !== undefined) {
    return `σ=${fault.params.noise_sigma_ms} ms`;
  }
  return '--';
}

/**
 * Red-Team Console Page (Part G4.4)
 * Owned by Person 4 (P4-T3)
 */
export function RedTeamPage() {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const nodesHook = useNodes();
  const assessmentsHook = useAssessments();
  const storeFaultsHook = useFaults();
  const isLoadingHook = useIsLoading();
  const storeErrorHook = useStoreError();
  const connectionStatusHook = useConnectionStatus();

  const isClient = typeof window !== 'undefined';
  const snapshotState = isClient ? null : useDashboardStore.getState();

  const nodes = isClient ? nodesHook : snapshotState!.nodes;
  const assessments = isClient ? assessmentsHook : snapshotState!.assessments;
  const storeFaults = isClient ? storeFaultsHook : snapshotState!.faults;
  const isLoading = isClient ? isLoadingHook : snapshotState!.isLoading;
  const storeError = isClient ? storeErrorHook : snapshotState!.error;
  const connectionStatus = isClient ? connectionStatusHook : snapshotState!.connectionStatus;

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [selectedType, setSelectedType] = useState<FaultType>('clock_step');
  const [offsetMs, setOffsetMs] = useState<number>(DEMO_PRESETS.jump_offset_ms);
  const [rateMsPerMin, setRateMsPerMin] = useState<number>(DEMO_PRESETS.slow_drag_rate_ms_per_min);
  const [accelMsPerMin2, setAccelMsPerMin2] = useState<number>(0);
  const [noiseSigmaMs, setNoiseSigmaMs] = useState<number>(5);
  const [durationS, setDurationS] = useState<number>(0); // 0 => null (until stopped)

  const [fetchedFaults, setFetchedFaults] = useState<Fault[]>([]);
  const [faultsError, setFaultsError] = useState<string | null>(null);
  const [starting, setStarting] = useState<boolean>(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Default to first available node
  useEffect(() => {
    if (!selectedNodeId && sortedNodes.length > 0) {
      setSelectedNodeId(sortedNodes[0]!.id);
    }
  }, [selectedNodeId, sortedNodes]);

  const selectedNode = useMemo(
    () => sortedNodes.find((n) => n.id === selectedNodeId) ?? sortedNodes[0],
    [sortedNodes, selectedNodeId],
  );

  // If user selects a browser node while a virtual-only fault is picked, fall back safely
  useEffect(() => {
    if (selectedNode && !isFaultAllowedForNode(selectedType, selectedNode)) {
      setSelectedType('clock_step');
    }
  }, [selectedNode, selectedType]);

  const loadActiveFaults = useCallback(async () => {
    setFaultsError(null);
    try {
      const list = await api.getFaults('active');
      setFetchedFaults(list);
    } catch (err) {
      setFaultsError(err instanceof Error ? err.message : 'Unable to fetch active faults');
    }
  }, []);

  useEffect(() => {
    void loadActiveFaults();
  }, [loadActiveFaults]);

  // Merge store faults (live socket updates) and fetched faults, preferring latest by id
  const activeFaults = useMemo(() => {
    const byId = new Map<string, Fault>();
    for (const f of fetchedFaults) {
      byId.set(f.id, f);
    }
    for (const f of storeFaults) {
      byId.set(f.id, f);
    }
    return Array.from(byId.values())
      .filter((f) => f.status === 'active')
      .sort((a, b) => b.started_at_ms - a.started_at_ms);
  }, [fetchedFaults, storeFaults]);

  // Lightweight local display timer for elapsed seconds (no network polling)
  useEffect(() => {
    if (activeFaults.length === 0) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeFaults.length]);

  const buildFaultParams = (): FaultParams => {
    const duration = durationS > 0 ? durationS : null;
    switch (selectedType) {
      case 'clock_step':
      case 'camera_delay':
        return { offset_ms: offsetMs, duration_s: duration };
      case 'clock_ramp':
      case 'gnss_spoof':
        return {
          rate_ms_per_min: rateMsPerMin,
          accel_ms_per_min2: accelMsPerMin2,
          duration_s: duration,
        };
      case 'noise_burst':
        return { noise_sigma_ms: noiseSigmaMs, duration_s: duration };
    }
  };

  const applyPreset = (preset: FaultPreset) => {
    if (selectedNode && !isFaultAllowedForNode(preset.type, selectedNode)) {
      return;
    }
    setSelectedType(preset.type);
    if (preset.params.offset_ms !== undefined) setOffsetMs(preset.params.offset_ms);
    if (preset.params.rate_ms_per_min !== undefined) setRateMsPerMin(preset.params.rate_ms_per_min);
    setAccelMsPerMin2(preset.params.accel_ms_per_min2 ?? 0);
    if (preset.params.noise_sigma_ms !== undefined) setNoiseSigmaMs(preset.params.noise_sigma_ms);
    setDurationS(preset.params.duration_s ?? 0);
  };

  const handleStartFault = async () => {
    if (!selectedNode) return;
    if (!isFaultAllowedForNode(selectedType, selectedNode)) {
      setActionError('Selected fault type is not supported on browser nodes.');
      return;
    }

    setStarting(true);
    setActionError(null);
    const spec: FaultSpec = {
      type: selectedType,
      node_id: selectedNode.id,
      params: buildFaultParams(),
    };

    try {
      const created = await api.createFault(spec);
      useDashboardStore.getState().applyFaultChanged(created);
      setFetchedFaults((prev) => [created, ...prev.filter((f) => f.id !== created.id)]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start fault');
    } finally {
      setStarting(false);
    }
  };

  const handleStopFault = async (faultId: string) => {
    setStoppingId(faultId);
    setActionError(null);
    try {
      const stopped = await api.stopFault(faultId);
      useDashboardStore.getState().applyFaultChanged(stopped);
      setFetchedFaults((prev) => prev.map((f) => (f.id === stopped.id ? stopped : f)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to stop fault');
    } finally {
      setStoppingId(null);
    }
  };

  const isReconnecting = connectionStatus === 'disconnected' || connectionStatus === 'error';
  const isMock = connectionStatus === 'mock';

  if (isLoading && nodes.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton width={240} height={32} />
        <Skeleton height={44} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton height={280} />
          <Skeleton height={280} />
        </div>
      </div>
    );
  }

  if (storeError && nodes.length === 0) {
    return (
      <EmptyState
        title="Unable to load observatory nodes"
        description={storeError}
        action={
          <Button variant="primary" size="sm" onClick={() => void loadActiveFaults()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div
      className={`space-y-5 transition-opacity duration-[180ms] ease-out ${
        isReconnecting ? 'opacity-70' : 'opacity-100'
      }`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Red-Team Console
            </h2>
            {isMock ? (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-amber-200">
                SIMULATED (MOCK)
              </span>
            ) : isReconnecting ? (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-trust-suspect">
                RECONNECTING
              </span>
            ) : (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-emerald-500/12 border border-emerald-400/30 text-trust-trusted">
                LIVE CLUSTER
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Inject controlled software faults to verify detection and quarantine latency
          </p>
        </div>

        <div className="mc-well px-3 py-1.5 rounded-[8px] font-mono text-xs tabular-nums flex items-center gap-2 shrink-0">
          <span
            className={`h-2 w-2 rounded-full ${
              activeFaults.length > 0 ? 'bg-trust-quarantined' : 'bg-muted/50'
            }`}
            aria-hidden="true"
          />
          <span className="text-foreground">
            {activeFaults.length} active {activeFaults.length === 1 ? 'fault' : 'faults'}
          </span>
        </div>
      </div>

      {/* Software-Only Safety Banner */}
      <div
        role="status"
        className="mc-well border-amber-400/30 border-l-2 border-l-trust-suspect px-4 py-3 rounded-[10px] flex items-center gap-3 text-xs text-amber-100 font-medium"
      >
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-trust-suspect font-mono font-bold text-[11px] shrink-0"
          aria-hidden="true"
        >
          !
        </span>
        <span>Software-only simulation. No signals are transmitted.</span>
      </div>

      {nodes.length === 0 ? (
        <EmptyState
          title="No observatory nodes online"
          description="Connect a browser node or start virtual nodes on the server before injecting a fault."
          action={
            <Link
              to="/join"
              className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-[10px] bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35 hover:bg-accent-cyan/22"
            >
              Join as a node
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left (7 cols): Single Structured Fault-Injection Deck */}
          <div className="lg:col-span-7 mc-panel-primary mc-ticks rounded-[14px] p-5 space-y-6">
            {/* Step 1: Target Node */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30">
                    01
                  </span>
                  <span>Target Node</span>
                </h3>
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {sortedNodes.length} available
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sortedNodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const assessment = assessments[node.id];
                  return (
                    <button
                      key={node.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`text-left p-3 rounded-[10px] border transition-[background-color,border-color] duration-[160ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
                        isSelected
                          ? 'bg-accent-cyan/[0.12] border-accent-cyan/65 text-foreground'
                          : 'bg-black/30 border-white/[0.1] text-muted hover:border-white/[0.22] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {node.name}
                        </span>
                        <span className="text-[10px] font-mono text-muted shrink-0">
                          {node.kind === 'virtual' ? 'Simulated' : 'Real'}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        {assessment ? (
                          <StateChip state={assessment.state} size="sm" />
                        ) : (
                          <span className="text-[11px] font-mono text-muted">Unassessed</span>
                        )}
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-muted">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              node.online ? 'bg-trust-trusted' : 'bg-muted/50'
                            }`}
                            aria-hidden="true"
                          />
                          {node.online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Step 2: Fault Type */}
            <section className="space-y-2.5 pt-5 border-t border-white/[0.08]">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30">
                  02
                </span>
                <span>Fault Type</span>
                <InfoTip text="Browser nodes only support software agent-shim faults (clock_step, clock_ramp, noise_burst). Virtual nodes support all five." />
              </h3>

              <div className="space-y-2">
                {FAULT_TYPE_OPTIONS.map((opt) => {
                  const allowed = isFaultAllowedForNode(opt.type, selectedNode);
                  const isSelected = selectedType === opt.type;
                  const disabledReason =
                    'Virtual nodes only: browser nodes do not simulate GNSS or camera-trigger streams.';
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      disabled={!allowed}
                      aria-pressed={isSelected}
                      title={!allowed ? disabledReason : opt.description}
                      onClick={() => setSelectedType(opt.type)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-[10px] border text-xs transition-[background-color,border-color] duration-[160ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
                        !allowed
                          ? 'opacity-45 cursor-not-allowed bg-black/25 border-white/[0.06] text-muted'
                          : isSelected
                            ? 'bg-accent-cyan/[0.12] border-accent-cyan/65 text-foreground'
                            : 'bg-black/30 border-white/[0.1] text-muted hover:border-white/[0.22] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isSelected ? 'bg-accent-cyan' : 'bg-white/20'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="font-semibold text-foreground">{opt.label}</span>
                          {!allowed && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/12 border border-amber-400/30 text-amber-200">
                              Virtual only
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-muted">{opt.type}</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1 pl-4">
                        {allowed ? opt.description : disabledReason}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Step 3: Contract Presets & Parameters */}
            <section className="space-y-4 pt-5 border-t border-white/[0.08]">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30">
                  03
                </span>
                <span>Presets &amp; Parameters</span>
              </h3>

              <div className="flex flex-wrap gap-1.5">
                {FAULT_PRESETS.map((preset) => {
                  const allowed = isFaultAllowedForNode(preset.type, selectedNode);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!allowed}
                      title={!allowed ? 'Not supported on browser nodes' : undefined}
                      onClick={() => applyPreset(preset)}
                      className={`px-2.5 py-1.5 rounded-[8px] text-[11px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
                        !allowed
                          ? 'opacity-40 cursor-not-allowed border-white/[0.06] text-muted bg-black/20'
                          : 'bg-white/[0.05] border-white/[0.12] text-foreground hover:border-accent-cyan/50 hover:bg-accent-cyan/10'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="mc-well rounded-[10px] p-4 space-y-4">
                {(selectedType === 'clock_step' || selectedType === 'camera_delay') && (
                  <label className="block space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Offset (ms)</span>
                      <span className="font-mono text-foreground font-semibold tabular-nums">
                        {offsetMs} ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={0.5}
                      value={offsetMs}
                      onChange={(e) => setOffsetMs(Number(e.target.value))}
                      className="w-full accent-accent-cyan"
                    />
                  </label>
                )}

                {(selectedType === 'clock_ramp' || selectedType === 'gnss_spoof') && (
                  <>
                    <label className="block space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Drift rate (ms/min)</span>
                        <span className="font-mono text-foreground font-semibold tabular-nums">
                          {rateMsPerMin} ms/min
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        step={0.1}
                        value={rateMsPerMin}
                        onChange={(e) => setRateMsPerMin(Number(e.target.value))}
                        className="w-full accent-accent-cyan"
                      />
                    </label>
                    <label className="block space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Acceleration (ms/min²)</span>
                        <span className="font-mono text-foreground font-semibold tabular-nums">
                          {accelMsPerMin2} ms/min²
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.05}
                        value={accelMsPerMin2}
                        onChange={(e) => setAccelMsPerMin2(Number(e.target.value))}
                        className="w-full accent-accent-cyan"
                      />
                    </label>
                  </>
                )}

                {selectedType === 'noise_burst' && (
                  <label className="block space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Noise sigma (ms)</span>
                      <span className="font-mono text-foreground font-semibold tabular-nums">
                        {noiseSigmaMs} ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={20}
                      step={0.5}
                      value={noiseSigmaMs}
                      onChange={(e) => setNoiseSigmaMs(Number(e.target.value))}
                      className="w-full accent-accent-cyan"
                    />
                  </label>
                )}

                <label className="block space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Duration (s, 0 = until stopped)</span>
                    <span className="font-mono text-foreground font-semibold tabular-nums">
                      {durationS > 0 ? `${durationS} s` : 'Until stopped'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={300}
                    step={10}
                    value={durationS}
                    onChange={(e) => setDurationS(Number(e.target.value))}
                    className="w-full accent-accent-cyan"
                  />
                </label>
              </div>
            </section>

            {actionError && (
              <div className="mc-well border-rose-400/35 border-l-2 border-l-trust-quarantined rounded-[10px] p-3 text-xs text-rose-100">
                {actionError}
              </div>
            )}

            <div className="pt-4 border-t border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs">
                <span className="text-muted block">Armed Simulation Target</span>
                <span className="font-mono text-foreground font-medium">
                  {selectedNode?.name ?? '--'} · {selectedType}
                </span>
              </div>
              <Button
                data-testid="redteam-start"
                variant="danger"
                loading={starting}
                disabled={!selectedNode || starting}
                onClick={() => void handleStartFault()}
                className="px-5 py-2.5 font-semibold"
              >
                Start Fault
              </Button>
            </div>
          </div>

          {/* Right (5 cols): Active Faults Telemetry Panel */}
          <div
            data-testid="redteam-active-faults"
            className="lg:col-span-5 mc-panel border-rose-400/20 border-t-2 border-t-trust-quarantined/75 rounded-[14px] p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
              <div>
                <span className="text-[11px] font-mono text-trust-quarantined block">
                  Live Fault Telemetry
                </span>
                <h3 className="text-base font-semibold text-foreground mt-0.5">Active Faults</h3>
                <p className="text-xs text-muted">
                  Server-tracked faults with ground truth and detection latency
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void loadActiveFaults()}>
                Refresh
              </Button>
            </div>

            {faultsError && (
              <div className="mc-well border-amber-400/30 border-l-2 border-l-trust-suspect rounded-[10px] p-3 text-xs text-amber-100 flex items-center justify-between gap-2">
                <span>{faultsError}</span>
                <button
                  type="button"
                  onClick={() => void loadActiveFaults()}
                  className="underline font-medium"
                >
                  Retry
                </button>
              </div>
            )}

            {activeFaults.length === 0 ? (
              <EmptyState
                title="No active faults"
                description="Select a node and fault type on the left, then click Start Fault to inject a software-only test fault."
              />
            ) : (
              <div className="space-y-3">
                {activeFaults.map((fault) => {
                  const targetNode = nodes.find((n) => n.id === fault.node_id);
                  const isStopping = stoppingId === fault.id;
                  return (
                    <div
                      key={fault.id}
                      className="mc-well rounded-[10px] p-3.5 space-y-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-sm text-foreground truncate">
                              {targetNode?.name ?? fault.node_id.slice(0, 8)}
                            </span>
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-accent-cyan">
                              {fault.type}
                            </span>
                            <span className="font-mono text-[10px] text-muted">
                              ({fault.applies_to})
                            </span>
                          </div>
                          <div>
                            {fault.detection_latency_s !== null ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] font-mono text-[11px] bg-trust-trusted/12 text-trust-trusted border border-trust-trusted/30 tabular-nums">
                                {`Detected in ${fault.detection_latency_s.toFixed(1)} s`}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] font-mono text-[11px] bg-trust-suspect/12 text-trust-suspect border border-trust-suspect/30">
                                Awaiting detection
                              </span>
                            )}
                          </div>
                        </div>

                        <Button
                          variant="secondary"
                          size="sm"
                          loading={isStopping}
                          disabled={isStopping}
                          onClick={() => void handleStopFault(fault.id)}
                          className="shrink-0"
                        >
                          Stop
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 divide-x divide-white/[0.08] pt-2.5 border-t border-white/[0.07] font-mono tabular-nums">
                        <div className="pr-2">
                          <span className="text-[10px] text-muted block font-sans">Elapsed</span>
                          <span className="text-foreground font-medium">
                            {formatElapsed(fault.started_at_ms, nowMs)}
                          </span>
                        </div>
                        <div className="px-2">
                          <span className="text-[10px] text-muted block font-sans">Size</span>
                          <span className="text-accent-cyan font-medium">
                            {formatFaultMagnitude(fault)}
                          </span>
                        </div>
                        <div className="pl-2">
                          <span className="text-[10px] text-muted block font-sans">At detect</span>
                          <span className="text-foreground font-medium">
                            {fault.error_at_detect_ms !== null
                              ? `${fault.error_at_detect_ms.toFixed(2)} ms`
                              : '--'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end text-[10px] font-mono text-muted/75">
                        id: {fault.id.slice(0, 8)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
