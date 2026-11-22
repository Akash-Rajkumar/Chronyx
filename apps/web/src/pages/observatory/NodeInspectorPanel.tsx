import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEMO_PRESETS } from '@chronyx/contracts';
import type {
  Assessment,
  Fault,
  FaultParams,
  FaultSpec,
  FaultType,
  NodeInfo,
} from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { useDashboardStore } from '../../state/useDashboardStore.js';
import { StateChip } from '../../ui/StateChip.js';
import { formatRelativeTime, formatSignedOffset } from '../overview/OverviewPage.js';

interface FaultTypeMeta {
  type: FaultType;
  label: string;
  browserSupported: boolean;
}

const FAULT_OPTIONS: ReadonlyArray<FaultTypeMeta> = [
  { type: 'clock_step', label: 'Clock Step', browserSupported: true },
  { type: 'clock_ramp', label: 'Clock Ramp', browserSupported: true },
  { type: 'gnss_spoof', label: 'GNSS Spoof', browserSupported: false },
  { type: 'camera_delay', label: 'Camera Delay', browserSupported: false },
  { type: 'noise_burst', label: 'Noise Burst', browserSupported: true },
];

const DETAIL_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/compare', label: 'Before vs After' },
  { to: '/redteam', label: 'Red-Team Console' },
  { to: '/science', label: 'Science Impact' },
  { to: '/scoreboard', label: 'Scoreboard' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/passport', label: 'Timing Passport' },
];

export interface NodeInspectorPanelProps {
  node: NodeInfo;
  assessment?: Assessment;
  activeFaults: Fault[];
  onClose: () => void;
  onFaultChanged: (fault: Fault) => void;
}

function isAllowed(type: FaultType, node: NodeInfo): boolean {
  if (node.kind === 'virtual') return true;
  return type === 'clock_step' || type === 'clock_ramp' || type === 'noise_burst';
}

export const NodeInspectorPanel: React.FC<NodeInspectorPanelProps> = ({
  node,
  assessment,
  activeFaults,
  onClose,
  onFaultChanged,
}) => {
  const [selectedType, setSelectedType] = useState<FaultType>('clock_step');
  const [offsetMs, setOffsetMs] = useState<number>(DEMO_PRESETS.jump_offset_ms);
  const [rateMsPerMin, setRateMsPerMin] = useState<number>(
    DEMO_PRESETS.slow_drag_rate_ms_per_min,
  );
  const [accelMsPerMin2, setAccelMsPerMin2] = useState<number>(0);
  const [noiseSigmaMs, setNoiseSigmaMs] = useState<number>(5);
  const [durationS, setDurationS] = useState<number>(0);

  const [starting, setStarting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Reset incompatible fault selection when switching to a browser node
  useEffect(() => {
    if (!isAllowed(selectedType, node)) {
      setSelectedType('clock_step');
    }
    setActionError(null);
  }, [node, selectedType]);

  const buildParams = (): FaultParams => {
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

  const handleStartFault = async () => {
    if (!isAllowed(selectedType, node)) {
      setActionError('Selected fault type is only supported on virtual nodes.');
      return;
    }
    setStarting(true);
    setActionError(null);
    const spec: FaultSpec = {
      type: selectedType,
      node_id: node.id,
      params: buildParams(),
    };
    try {
      const created = await api.createFault(spec);
      useDashboardStore.getState().applyFaultChanged(created);
      onFaultChanged(created);
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
      onFaultChanged(stopped);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to stop fault');
    } finally {
      setStoppingId(null);
    }
  };

  const isQuarantined = assessment?.state === 'quarantined';
  const hasActiveFault = activeFaults.length > 0;
  const confidencePct =
    assessment && typeof assessment.confidence === 'number' && !Number.isNaN(assessment.confidence)
      ? `${Math.round(assessment.confidence * 100)}%`
      : '--';

  return (
    <section
      data-testid="node-inspector-panel"
      aria-label={`Inspecting node ${node.name}`}
      className={`fixed z-30 bottom-3 left-3 right-3 sm:right-auto sm:top-20 sm:bottom-auto sm:left-5 sm:w-[360px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl liquid-glass bg-[#070b15]/88 p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,0.65)] ${
        isQuarantined ? 'ring-1 ring-red-500/70 shadow-[0_0_40px_rgba(255,77,79,0.28)]' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight text-white truncate">
              {node.name}
            </h2>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/10 text-white/80 border border-white/15">
              {node.kind === 'virtual' ? 'Simulated' : 'Real Browser'}
            </span>
          </div>
          <p className="mt-0.5 text-[10.5px] font-mono text-white/45 truncate" title={node.id}>
            ID: {node.id}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close node inspector"
          className="h-7 w-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Status Row: Online + Trust State + Active Fault Indicator */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono border ${
            node.online
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
              : 'bg-slate-500/15 text-slate-400 border-slate-500/35'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              node.online ? 'bg-emerald-400' : 'bg-slate-400'
            }`}
          />
          {node.online ? 'ONLINE' : 'OFFLINE'}
        </span>

        {assessment ? (
          <StateChip state={assessment.state} size="sm" />
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-white/10 text-white/60 border border-white/15">
            Unassessed
          </span>
        )}

        {hasActiveFault && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-200 border border-amber-400/50">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Fault Active ({activeFaults.length})
          </span>
        )}
      </div>

      {/* Quarantined Alert Banner (Strictly Driven by Backend Assessment) */}
      {isQuarantined && (
        <div className="mt-3 px-3 py-2 rounded-xl bg-red-950/75 border border-red-500/55 text-xs text-red-200 flex items-center justify-between gap-2">
          <div>
            <div className="font-mono font-semibold text-[11px] uppercase tracking-wider text-red-300">
              QUARANTINED BY CONSENSUS
            </div>
            <div className="text-[11px] text-red-200/80 mt-0.5">
              Excluded from verified observatory clock consensus.
            </div>
          </div>
          <span className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_12px_#ff4d4f] animate-pulse shrink-0" />
        </div>
      )}

      {/* Telemetry Grid */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-black/45 border border-white/10 p-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
            Est. Clock Error
          </div>
          <div
            className={`mt-1 text-sm font-mono font-semibold tabular-nums ${
              isQuarantined
                ? 'text-red-300'
                : assessment?.state === 'suspect'
                  ? 'text-amber-300'
                  : 'text-accent-cyan'
            }`}
          >
            {assessment ? formatSignedOffset(assessment.error_est_ms) : '--'}
          </div>
        </div>

        <div className="rounded-xl bg-black/45 border border-white/10 p-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
            Confidence / σ
          </div>
          <div className="mt-1 text-sm font-mono font-semibold text-white tabular-nums">
            {confidencePct}
            {assessment ? (
              <span className="text-[11px] font-normal text-white/50 ml-1">
                ±{assessment.sigma_ms.toFixed(2)}ms
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl bg-black/45 border border-white/10 p-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
            Last Heartbeat
          </div>
          <div className="mt-1 text-xs font-mono text-white/85">
            {formatRelativeTime(node.last_seen_at)}
          </div>
        </div>

        <div className="rounded-xl bg-black/45 border border-white/10 p-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
            Suspected Cause
          </div>
          <div className="mt-1 text-xs font-mono text-white/85 truncate">
            {assessment?.suspected_cause ?? 'none'}
          </div>
        </div>
      </div>

      {assessment && assessment.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {assessment.reasons.map((reason) => (
            <span
              key={reason}
              className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-white/70"
            >
              {reason}
            </span>
          ))}
        </div>
      )}

      {/* Fault Injection Section */}
      <div className="mt-4 pt-3 border-t border-white/10 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-white/85">
            Fault Injection
          </h3>
          <span className="text-[10px] font-mono text-white/45">
            Real Backend API
          </span>
        </div>

        {/* Fault Type Selector Pills */}
        <div className="grid grid-cols-2 gap-1.5">
          {FAULT_OPTIONS.map((opt) => {
            const allowed = isAllowed(opt.type, node);
            const active = selectedType === opt.type;
            return (
              <button
                key={opt.type}
                type="button"
                disabled={!allowed}
                onClick={() => setSelectedType(opt.type)}
                title={
                  !allowed
                    ? 'Virtual nodes only'
                    : `Inject ${opt.label} on ${node.name}`
                }
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium text-left border transition-all ${
                  !allowed
                    ? 'opacity-35 cursor-not-allowed border-white/5 bg-black/20 text-white/40'
                    : active
                      ? 'bg-red-500/20 border-red-400/60 text-white shadow-[0_0_12px_rgba(239,68,68,0.2)] cursor-pointer'
                      : 'bg-black/40 border-white/10 text-white/75 hover:border-white/30 hover:text-white cursor-pointer'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Dynamic Fault Parameters */}
        <div className="grid grid-cols-2 gap-2">
          {(selectedType === 'clock_step' || selectedType === 'camera_delay') && (
            <label className="block">
              <span className="text-[10px] font-mono text-white/60">Offset (ms)</span>
              <input
                type="number"
                step="1"
                value={offsetMs}
                onChange={(e) => setOffsetMs(Number(e.target.value))}
                className="mt-1 w-full rounded-lg bg-black/55 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent-cyan"
              />
            </label>
          )}

          {(selectedType === 'clock_ramp' || selectedType === 'gnss_spoof') && (
            <>
              <label className="block">
                <span className="text-[10px] font-mono text-white/60">Rate (ms/min)</span>
                <input
                  type="number"
                  step="0.5"
                  value={rateMsPerMin}
                  onChange={(e) => setRateMsPerMin(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg bg-black/55 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent-cyan"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-mono text-white/60">Accel (ms/min²)</span>
                <input
                  type="number"
                  step="0.1"
                  value={accelMsPerMin2}
                  onChange={(e) => setAccelMsPerMin2(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg bg-black/55 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent-cyan"
                />
              </label>
            </>
          )}

          {selectedType === 'noise_burst' && (
            <label className="block">
              <span className="text-[10px] font-mono text-white/60">Noise σ (ms)</span>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={noiseSigmaMs}
                onChange={(e) => setNoiseSigmaMs(Number(e.target.value))}
                className="mt-1 w-full rounded-lg bg-black/55 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent-cyan"
              />
            </label>
          )}

          <label className="block">
            <span className="text-[10px] font-mono text-white/60">Duration s (0 = ∞)</span>
            <input
              type="number"
              min="0"
              step="5"
              value={durationS}
              onChange={(e) => setDurationS(Math.max(0, Number(e.target.value)))}
              className="mt-1 w-full rounded-lg bg-black/55 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-accent-cyan"
            />
          </label>
        </div>

        {actionError && (
          <div className="p-2 rounded-lg bg-red-950/70 border border-red-500/40 text-[11px] text-red-200">
            {actionError}
          </div>
        )}

        <button
          type="button"
          data-testid="inspector-start-fault"
          disabled={starting || !node.online}
          onClick={() => void handleStartFault()}
          className="w-full py-2 px-4 rounded-full text-xs font-semibold tracking-wide bg-red-500/85 hover:bg-red-500 disabled:opacity-45 disabled:cursor-not-allowed text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.28)] cursor-pointer"
        >
          {starting ? 'Injecting Fault…' : `Inject ${FAULT_OPTIONS.find((o) => o.type === selectedType)?.label ?? 'Fault'}`}
        </button>

        {/* Active Faults on Selected Node */}
        {activeFaults.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300/90">
              Active on {node.name}
            </div>
            {activeFaults.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-400/35 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono font-medium text-amber-100 truncate">
                    {f.type}
                    {f.params.offset_ms !== undefined ? ` (${f.params.offset_ms >= 0 ? '+' : ''}${f.params.offset_ms}ms)` : ''}
                    {f.params.rate_ms_per_min !== undefined ? ` (${f.params.rate_ms_per_min}ms/m)` : ''}
                  </div>
                  <div className="text-[10px] font-mono text-white/55">
                    {f.detected_at_ms !== null
                      ? `Detected in ${f.detection_latency_s?.toFixed(1) ?? '--'}s`
                      : 'Monitoring…'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={stoppingId === f.id}
                  onClick={() => void handleStopFault(f.id)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 cursor-pointer shrink-0"
                >
                  {stoppingId === f.id ? 'Stopping…' : 'Stop'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MORE DETAILS → Section */}
      <div className="mt-4 pt-3 border-t border-white/10 space-y-2">
        <div className="flex items-center gap-2">
          <Link
            to={`/nodes/${node.id}`}
            data-testid="inspector-more-details"
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-white text-black text-xs font-semibold tracking-wider uppercase hover:bg-accent-cyan hover:text-black transition-colors"
          >
            <span>MORE DETAILS</span>
            <span aria-hidden="true">→</span>
          </Link>
          <button
            type="button"
            onClick={() => setShowMoreMenu((prev) => !prev)}
            className="px-3 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-medium text-white cursor-pointer"
            title="Jump to analytical pages"
          >
            Pages {showMoreMenu ? '▴' : '▾'}
          </button>
        </div>

        {showMoreMenu && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {DETAIL_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="px-2.5 py-1.5 rounded-lg bg-black/45 hover:bg-accent-cyan/15 border border-white/10 hover:border-accent-cyan/40 text-[11px] font-medium text-white/85 hover:text-accent-cyan transition-colors truncate"
              >
                {item.label} →
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
