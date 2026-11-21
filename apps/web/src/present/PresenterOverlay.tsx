import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DemoScenarioName } from '@chronyx/contracts';
import { api } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { DEMO_CUES } from './cues.js';
import { usePresenterMode, usePresenterShortcuts } from './usePresenterMode.js';

export interface PresenterOverlayProps {
  /** Shared QR modal callback supplied by AppShell (Person 3). */
  onOpenQrModal?: () => void;
}

const SCENARIO_SHORTCUTS: ReadonlyArray<{
  keyLabel: string;
  name: DemoScenarioName;
  label: string;
}> = [
    { keyLabel: '0', name: 'calm', label: 'Calm' },
    { keyLabel: '1', name: 'jump', label: 'Jump' },
    { keyLabel: '2', name: 'slow_drag', label: 'Slow drag' },
    { keyLabel: '3', name: 'gnss_spoof', label: 'GNSS spoof' },
  ];

function formatStopwatch(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Presenter Mode Overlay (Part G4.10 & Part H1)
 * Owned by Person 4 (P4-T5).
 * Activates via `?present=1` or keyboard shortcut `P`.
 */
export function PresenterOverlay({ onOpenQrModal }: PresenterOverlayProps) {
  const navigate = useNavigate();
  const { isPresent, togglePresent } = usePresenterMode();

  const [cueIndex, setCueIndex] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);

  const [pendingScenario, setPendingScenario] = useState<DemoScenarioName | null>(null);
  const [lastScenario, setLastScenario] = useState<DemoScenarioName | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPresent || !timerRunning) return;
    const id = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [isPresent, timerRunning]);

  const handleTriggerScenario = useCallback(async (name: DemoScenarioName) => {
    setPendingScenario(name);
    setScenarioError(null);
    try {
      await api.triggerScenario(name);
      setLastScenario(name);
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : `Scenario ${name} failed`);
    } finally {
      setPendingScenario(null);
    }
  }, []);

  const handleNextCue = useCallback(() => {
    setCueIndex((prev) => (prev + 1) % DEMO_CUES.length);
  }, []);

  usePresenterShortcuts({
    isPresent,
    onTogglePresent: togglePresent,
    onScenario: (name) => void handleTriggerScenario(name),
    onOpenQr: onOpenQrModal,
    onNextCue: handleNextCue,
  });

  if (!isPresent) {
    return null;
  }

  const currentCue = DEMO_CUES[cueIndex] ?? DEMO_CUES[0]!;
  const qrUnavailableReason =
    'QR modal unavailable: awaiting shared QR modal callback from AppShell (Person 3)';

  return (
    <>
      {/* Top Liquid-Glass Presenter Scenario Bar — high contrast for distance viewing */}
      <div
        role="region"
        aria-label="Presenter scenario bar"
        className="sticky top-0 z-30 backdrop-blur-2xl bg-[#070E20]/75 border-b border-cyan-300/30 px-5 py-3 shadow-[inset_0_1px_0_rgba(165,243,252,0.22),0_12px_32px_rgba(2,6,23,0.65)] flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-400/15 border border-cyan-300/45 text-cyan-200 font-mono text-xs font-semibold tracking-wider shadow-[0_0_18px_rgba(61,214,245,0.25)]">
            <span className="h-2 w-2 rounded-full bg-cyan-300" aria-hidden="true" />
            PRESENTER
          </span>
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/15 backdrop-blur-md">
            {SCENARIO_SHORTCUTS.map((sc) => (
              <Button
                key={sc.name}
                variant={lastScenario === sc.name ? 'primary' : 'secondary'}
                size="sm"
                loading={pendingScenario === sc.name}
                disabled={pendingScenario !== null}
                onClick={() => void handleTriggerScenario(sc.name)}
                className="transition-transform hover:-translate-y-[1px]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>{sc.label}</span>
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/35 border border-white/15">
                    {sc.keyLabel}
                  </kbd>
                </span>
              </Button>
            ))}
          </div>
          {scenarioError && (
            <span className="text-xs text-rose-200 font-mono px-3 py-1 rounded-lg bg-rose-500/20 border border-rose-400/40">
              {scenarioError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!onOpenQrModal}
            title={!onOpenQrModal ? qrUnavailableReason : 'Open Join as a Node QR modal [Q]'}
            onClick={onOpenQrModal}
            className="transition-transform hover:-translate-y-[1px]"
          >
            {onOpenQrModal ? 'QR Join [Q]' : 'QR Unavailable'}
          </Button>
          <Button variant="ghost" size="sm" onClick={togglePresent}>
            Exit [P]
          </Button>
        </div>
      </div>

      {/* High-Contrast Liquid-Glass Floating Cue Card */}
      <aside
        aria-label="Presenter demo cue card"
        className="fixed bottom-5 right-5 z-40 w-96 max-w-[calc(100vw-2rem)] backdrop-blur-2xl bg-gradient-to-br from-[#0B1730]/82 via-[#091226]/78 to-[#12102B]/80 border border-cyan-300/35 rounded-2xl p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_24px_56px_rgba(2,6,23,0.75)] space-y-3.5"
      >
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-cyan-200 font-semibold tracking-wider">
              {`CUE ${cueIndex + 1}/${DEMO_CUES.length}`}
            </span>
            <span className="font-mono text-xs text-slate-200 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/15">
              {currentCue.windowLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-base text-white font-bold tracking-tight min-w-[3.4rem] text-right">
              {formatStopwatch(elapsedSec)}
            </span>
            <button
              type="button"
              onClick={() => setTimerRunning((r) => !r)}
              className="px-2 py-1 rounded-lg bg-white/[0.07] border border-white/15 text-[11px] text-white hover:bg-cyan-400/20 hover:border-cyan-300/45 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
            >
              {timerRunning ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTimerRunning(false);
                setElapsedSec(0);
              }}
              className="px-2 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] text-slate-300 hover:text-white hover:border-white/25 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-base font-bold tracking-tight text-white">{currentCue.title}</h4>
          <p className="text-sm text-slate-100/90 leading-relaxed">{currentCue.script}</p>
          {currentCue.actionHint && (
            <div className="mt-2 px-3 py-2 rounded-xl bg-cyan-400/12 border border-cyan-300/35 text-xs font-mono text-cyan-200">
              {currentCue.actionHint}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <button
            type="button"
            onClick={() => navigate(`${currentCue.route}?present=1`)}
            className="text-xs font-semibold text-cyan-300 hover:text-cyan-200 hover:underline focus:outline-none focus:ring-2 focus:ring-cyan-300/60 rounded px-1 py-0.5"
          >
            {`Go to ${currentCue.routeLabel} →`}
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleNextCue}
            className="transition-transform hover:-translate-y-[1px]"
          >
            Next [N]
          </Button>
        </div>
      </aside>
    </>
  );
}
