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
      {/* Top Presenter Scenario Bar */}
      <div
        role="region"
        aria-label="Presenter scenario bar"
        className="sticky top-0 z-30 bg-card border-b border-border px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan font-mono text-xs font-semibold">
            PRESENTER
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SCENARIO_SHORTCUTS.map((sc) => (
              <Button
                key={sc.name}
                variant={lastScenario === sc.name ? 'primary' : 'secondary'}
                size="sm"
                loading={pendingScenario === sc.name}
                disabled={pendingScenario !== null}
                onClick={() => void handleTriggerScenario(sc.name)}
              >
                {`${sc.label} [${sc.keyLabel}]`}
              </Button>
            ))}
          </div>
          {scenarioError && (
            <span className="text-xs text-trust-quarantined font-mono">{scenarioError}</span>
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

      {/* Compact Cue Card with Timer */}
      <aside
        aria-label="Presenter demo cue card"
        className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl p-4 shadow-xl space-y-3"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-accent-cyan font-semibold">
            {`Cue ${cueIndex + 1}/${DEMO_CUES.length} · ${currentCue.windowLabel}`}
          </span>
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-foreground font-semibold">{formatStopwatch(elapsedSec)}</span>
            <button
              type="button"
              onClick={() => setTimerRunning((r) => !r)}
              className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] text-muted hover:text-foreground"
            >
              {timerRunning ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTimerRunning(false);
                setElapsedSec(0);
              }}
              className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] text-muted hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-foreground">{currentCue.title}</h4>
          <p className="text-xs text-muted leading-relaxed">{currentCue.script}</p>
          {currentCue.actionHint && (
            <div className="text-[11px] font-mono text-accent-cyan pt-0.5">
              {currentCue.actionHint}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <button
            type="button"
            onClick={() => navigate(`${currentCue.route}?present=1`)}
            className="text-xs text-accent-cyan hover:underline"
          >
            {`Go to ${currentCue.routeLabel}`}
          </button>
          <Button variant="secondary" size="sm" onClick={handleNextCue}>
            Next [N]
          </Button>
        </div>
      </aside>
    </>
  );
}
