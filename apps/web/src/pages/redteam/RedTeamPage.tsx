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
import { GlassPanel, LiquidGlassShell } from '../../present/LiquidGlass.js';

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
    <LiquidGlassShell accent="coral" speed={1.15} dimmed={isReconnecting}>
      {/* Liquid-Glass Header */}
      <GlassPanel tone="default" padding="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose-300/90">
                Controlled Fault Injection Console
              </span>
              {isMock ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-cyan-400/15 border border-cyan-300/45 text-cyan-200 shadow-[0_0_14px_rgba(61,214,245,0.22)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                  SIMULATED (MOCK)
                </span>
              ) : isReconnecting ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/45 text-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
                  RECONNECTING
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/45 text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
                  LIVE CLUSTER
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Red-Team Console</h2>
            <p className="text-sm text-slate-300">
              Inject controlled software faults to verify detection and quarantine latency
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full font-mono text-xs border tabular-nums shrink-0 ${
              activeFaults.length > 0
                ? 'bg-rose-500/20 border-rose-300/45 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.28)]'
                : 'bg-white/[0.06] border-white/15 text-slate-200'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                activeFaults.length > 0 ? 'bg-rose-400' : 'bg-slate-400'
              }`}
              aria-hidden="true"
            />
            {`${activeFaults.length} active ${activeFaults.length === 1 ? 'fault' : 'faults'}`}
          </span>
        </div>
      </GlassPanel>

      {/* Amber Liquid-Glass Safety Banner */}
      <GlassPanel tone="amber" padding="px-4 py-3">
        <div role="status" className="flex items-center gap-3 text-xs text-amber-100 font-semibold">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/25 border border-amber-300/50 text-amber-200 font-mono font-bold text-xs shrink-0"
            aria-hidden="true"
          >
            !
          </span>
          <span>Software-only simulation. No signals are transmitted.</span>
        </div>
      </GlassPanel>

      {nodes.length === 0 ? (
        <GlassPanel tone="default">
          <EmptyState
            title="No observatory nodes online"
            description="Connect a browser node or start virtual nodes on the server before injecting a fault."
            action={
              <Link
                to="/join"
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl bg-cyan-400/20 text-cyan-100 border border-cyan-300/45 hover:bg-cyan-400/30 transition-colors"
              >
                Join as a node
              </Link>
            }
          />
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left (7 cols): Glass Injection Configuration Deck */}
          <div className="lg:col-span-7 space-y-5">
            {/* Step 1: Target Node */}
            <GlassPanel tone="default">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-cyan-400/15 text-cyan-200 border border-cyan-300/35">
                      01
                    </span>
                    <span>Target Node</span>
                  </h3>
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                    {`${sortedNodes.length} available`}
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
                        className={`text-left p-3 rounded-xl border backdrop-blur-md transition-all hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-cyan-300/60 ${
                          isSelected
                            ? 'bg-cyan-400/15 border-cyan-300/60 text-white shadow-[0_0_24px_rgba(61,214,245,0.22),inset_0_1px_0_rgba(255,255,255,0.25)]'
                            : 'bg-white/[0.045] border-white/12 text-slate-300 hover:bg-white/[0.08] hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                isSelected
                                  ? 'bg-cyan-300 shadow-[0_0_10px_rgba(61,214,245,0.9)]'
                                  : 'bg-white/25'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="text-xs font-semibold text-white truncate">
                              {node.name}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-black/30 border border-white/15 text-slate-200 shrink-0">
                            {node.kind === 'virtual' ? 'Simulated' : 'Real'}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between">
                          {assessment ? (
                            <StateChip state={assessment.state} size="sm" />
                          ) : (
                            <span className="text-[11px] font-mono text-slate-300/80">
                              Unassessed
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-slate-300">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                node.online ? 'bg-emerald-400' : 'bg-slate-500'
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
              </div>
            </GlassPanel>

            {/* Step 2: Fault Type */}
            <GlassPanel tone="default">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-cyan-400/15 text-cyan-200 border border-cyan-300/35">
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
                        className={`w-full text-left px-3.5 py-3 rounded-xl border text-xs backdrop-blur-md transition-all focus:outline-none focus:ring-2 focus:ring-cyan-300/60 ${
                          !allowed
                            ? 'opacity-50 cursor-not-allowed bg-black/25 border-white/8 text-slate-400'
                            : isSelected
                              ? 'bg-cyan-400/15 border-cyan-300/60 text-white shadow-[0_0_24px_rgba(61,214,245,0.2),inset_0_1px_0_rgba(255,255,255,0.22)]'
                              : 'bg-white/[0.045] border-white/12 text-slate-300 hover:bg-white/[0.08] hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full border ${
                                isSelected
                                  ? 'border-cyan-200 bg-cyan-300 shadow-[0_0_10px_rgba(61,214,245,0.85)]'
                                  : 'border-white/35 bg-transparent'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="font-semibold text-white">{opt.label}</span>
                            {!allowed && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/35 text-amber-200">
                                Virtual only
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-slate-200 px-2 py-0.5 rounded-md bg-black/30 border border-white/12">
                            {opt.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300/85 mt-1 pl-4">
                          {allowed ? opt.description : disabledReason}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </GlassPanel>

            {/* Step 3: Presets, Parameters & Armed Start Action */}
            <GlassPanel tone="violet">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-violet-400/20 text-violet-200 border border-violet-300/40">
                    03
                  </span>
                  <span>Presets &amp; Parameters</span>
                </h3>

                {/* Contract Presets */}
                <div className="space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-violet-200/80">
                    Presets (from contract)
                  </div>
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
                          className={`px-3 py-1.5 rounded-full text-[11px] border transition-all focus:outline-none focus:ring-2 focus:ring-violet-300/60 ${
                            !allowed
                              ? 'opacity-40 cursor-not-allowed border-white/10 text-slate-400 bg-black/20'
                              : 'bg-white/[0.06] border-white/18 text-slate-100 hover:bg-violet-400/20 hover:border-violet-300/50 hover:-translate-y-[1px]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Parameter Sliders in Frosted Well */}
                <div className="p-4 rounded-xl bg-black/30 border border-white/12 space-y-4">
                  {(selectedType === 'clock_step' || selectedType === 'camera_delay') && (
                    <label className="block space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200">Offset (ms)</span>
                        <span className="font-mono text-cyan-200 font-semibold px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/35 tabular-nums">
                          {`${offsetMs} ms`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-50}
                        max={50}
                        step={0.5}
                        value={offsetMs}
                        onChange={(e) => setOffsetMs(Number(e.target.value))}
                        className="w-full accent-cyan-400"
                      />
                    </label>
                  )}

                  {(selectedType === 'clock_ramp' || selectedType === 'gnss_spoof') && (
                    <>
                      <label className="block space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-200">Drift rate (ms/min)</span>
                          <span className="font-mono text-cyan-200 font-semibold px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/35 tabular-nums">
                            {`${rateMsPerMin} ms/min`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-20}
                          max={20}
                          step={0.1}
                          value={rateMsPerMin}
                          onChange={(e) => setRateMsPerMin(Number(e.target.value))}
                          className="w-full accent-cyan-400"
                        />
                      </label>
                      <label className="block space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-200">Acceleration (ms/min²)</span>
                          <span className="font-mono text-cyan-200 font-semibold px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/35 tabular-nums">
                            {`${accelMsPerMin2} ms/min²`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={5}
                          step={0.05}
                          value={accelMsPerMin2}
                          onChange={(e) => setAccelMsPerMin2(Number(e.target.value))}
                          className="w-full accent-cyan-400"
                        />
                      </label>
                    </>
                  )}

                  {selectedType === 'noise_burst' && (
                    <label className="block space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200">Noise sigma (ms)</span>
                        <span className="font-mono text-cyan-200 font-semibold px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/35 tabular-nums">
                          {`${noiseSigmaMs} ms`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={20}
                        step={0.5}
                        value={noiseSigmaMs}
                        onChange={(e) => setNoiseSigmaMs(Number(e.target.value))}
                        className="w-full accent-cyan-400"
                      />
                    </label>
                  )}

                  <label className="block space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-200">Duration (s, 0 = until stopped)</span>
                      <span className="font-mono text-violet-200 font-semibold px-2 py-0.5 rounded-md bg-violet-400/15 border border-violet-300/35 tabular-nums">
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
                      className="w-full accent-violet-400"
                    />
                  </label>
                </div>

                {actionError && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-300/40 text-xs text-rose-200">
                    {actionError}
                  </div>
                )}

                {/* Intentional Coral-Glass Start Fault Footer */}
                <div className="pt-3 border-t border-white/12 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-300 block">
                      Armed Simulation Target
                    </span>
                    <span className="font-mono text-white font-semibold">
                      {`${selectedNode?.name ?? '--'} · ${selectedType}`}
                    </span>
                  </div>
                  <Button
                    data-testid="redteam-start"
                    variant="danger"
                    loading={starting}
                    disabled={!selectedNode || starting}
                    onClick={() => void handleStartFault()}
                    className="px-5 py-2.5 font-semibold bg-rose-500/25 text-rose-100 border-rose-300/55 hover:bg-rose-500/35 hover:-translate-y-[1px] shadow-[0_0_24px_rgba(244,63,94,0.28)]"
                  >
                    Start Fault
                  </Button>
                </div>
              </div>
            </GlassPanel>
          </div>

          {/* Right (5 cols): Active Faults Coral-Glass Panel */}
          <div data-testid="redteam-active-faults" className="lg:col-span-5">
            <GlassPanel tone="coral">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/12">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-rose-300">
                      Live Fault Telemetry
                    </span>
                    <h3 className="text-base font-bold text-white">Active Faults</h3>
                    <p className="text-xs text-slate-300/85">
                      Server-tracked faults with ground truth and detection latency
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadActiveFaults()}
                    className="text-slate-200 hover:bg-white/10"
                  >
                    Refresh
                  </Button>
                </div>

                {faultsError && (
                  <div className="p-3 rounded-xl bg-amber-400/15 border border-amber-300/40 text-xs text-amber-100 flex items-center justify-between gap-2">
                    <span>{faultsError}</span>
                    <button
                      type="button"
                      onClick={() => void loadActiveFaults()}
                      className="underline font-semibold"
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
                          className="p-3.5 rounded-xl bg-black/35 border border-white/15 backdrop-blur-md space-y-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-sm text-white truncate">
                                  {targetNode?.name ?? fault.node_id.slice(0, 8)}
                                </span>
                                <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/35 text-cyan-200">
                                  {fault.type}
                                </span>
                                <span className="font-mono text-[10px] text-slate-300">
                                  {`(${fault.applies_to})`}
                                </span>
                              </div>
                              <div>
                                {fault.detection_latency_s !== null ? (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-mono text-[11px] bg-emerald-400/15 text-emerald-200 border border-emerald-300/40 tabular-nums shadow-[0_0_14px_rgba(16,185,129,0.2)]">
                                    {`Detected in ${fault.detection_latency_s.toFixed(1)} s`}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-mono text-[11px] bg-amber-400/15 text-amber-200 border border-amber-300/40">
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
                              className="shrink-0 bg-white/[0.08] border-white/20 text-white hover:bg-rose-500/25 hover:border-rose-300/50 hover:-translate-y-[1px]"
                            >
                              Stop
                            </Button>
                          </div>

                          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-white/10 font-mono tabular-nums">
                            <div>
                              <span className="text-[10px] text-slate-300/80 block uppercase">
                                Elapsed
                              </span>
                              <span className="text-white font-semibold">
                                {formatElapsed(fault.started_at_ms, nowMs)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-300/80 block uppercase">
                                Size
                              </span>
                              <span className="text-cyan-200 font-semibold">
                                {formatFaultMagnitude(fault)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-300/80 block uppercase">
                                At detect
                              </span>
                              <span className="text-white font-semibold">
                                {fault.error_at_detect_ms !== null
                                  ? `${fault.error_at_detect_ms.toFixed(2)} ms`
                                  : '--'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-end text-[10px] font-mono text-slate-400">
                            {`id: ${fault.id.slice(0, 8)}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </LiquidGlassShell>
  );
}
