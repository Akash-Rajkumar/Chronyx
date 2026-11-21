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
      {/* Top Mission Control Presenter Scenario Bar — high contrast for distance viewing */}
      <div
        role="region"
        aria-label="Presenter scenario bar"
        className="sticky top-0 z-30 backdrop-blur-xl bg-[#060C1A]/90 border-b border-accent-cyan/25 px-5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_rgba(2,6,18,0.65)] flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-accent-cyan/12 border border-accent-cyan/35 text-accent-cyan font-mono text-[11px] font-semibold tracking-[0.12em]">
            <span className="mc-live-dot h-2 w-2 rounded-full bg-accent-cyan" aria-hidden="true" />
            PRESENTER
          </span>
          <div className="mc-well flex flex-wrap items-center gap-1.5 p-1 rounded-[10px]">
            {SCENARIO_SHORTCUTS.map((sc) => (
              <Button
                key={sc.name}
                variant={lastScenario === sc.name ? 'primary' : 'secondary'}
                size="sm"
                loading={pendingScenario === sc.name}
                disabled={pendingScenario !== null}
                onClick={() => void handleTriggerScenario(sc.name)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>{sc.label}</span>
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40 border border-white/15">
                    {sc.keyLabel}
                  </kbd>
                </span>
              </Button>
            ))}
          </div>
          {scenarioError && (
            <span className="text-xs text-red-100 font-mono px-3 py-1 rounded-[8px] bg-trust-untrusted/15 border border-trust-untrusted/35">
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
          >
            {onOpenQrModal ? 'QR Join [Q]' : 'QR Unavailable'}
          </Button>
          <Button variant="ghost" size="sm" onClick={togglePresent}>
            Exit [P]
          </Button>
        </div>
      </div>

      {/* High-Contrast Mission Control Floating Cue Card */}
      <aside
        aria-label="Presenter demo cue card"
        className="mc-panel-primary mc-ticks fixed bottom-5 right-5 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-[14px] p-5 shadow-[0_24px_56px_rgba(2,6,18,0.78)] space-y-3.5"
      >
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-accent-cyan font-semibold tracking-wider">
              {`CUE ${cueIndex + 1}/${DEMO_CUES.length}`}
            </span>
            <span className="mc-well font-mono text-[11px] text-foreground/85 px-2 py-0.5 rounded">
              {currentCue.windowLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-base text-foreground font-semibold tracking-tight min-w-[3.4rem] text-right">
              {formatStopwatch(elapsedSec)}
            </span>
            <button
              type="button"
              onClick={() => setTimerRunning((r) => !r)}
              className="mc-well px-2 py-1 rounded-[6px] text-[11px] text-foreground hover:border-accent-cyan/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
            >
              {timerRunning ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTimerRunning(false);
                setElapsedSec(0);
              }}
              className="px-2 py-1 rounded-[6px] bg-white/[0.03] border border-white/[0.08] text-[11px] text-muted hover:text-foreground hover:border-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-base font-semibold tracking-tight text-foreground">{currentCue.title}</h4>
          <p className="text-sm text-foreground/85 leading-relaxed">{currentCue.script}</p>
          {currentCue.actionHint && (
            <div className="mc-well mt-2 px-3 py-2 rounded-[8px] border-l-2 border-l-accent-cyan text-xs font-mono text-accent-cyan">
              {currentCue.actionHint}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={() => navigate(`${currentCue.route}?present=1`)}
            className="text-xs font-semibold text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded px-1 py-0.5"
          >
            {`Go to ${currentCue.routeLabel} →`}
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleNextCue}
          >
            Next [N]
          </Button>
        </div>
      </aside>
    </>
  );
}
