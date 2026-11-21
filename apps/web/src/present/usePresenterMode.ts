import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DemoScenarioName } from '@chronyx/contracts';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('[role="dialog"]')) return true;
  return false;
}

export interface UsePresenterShortcutsOptions {
  isPresent: boolean;
  onTogglePresent: () => void;
  onScenario: (name: DemoScenarioName) => void;
  onOpenQr?: () => void;
  onNextCue: () => void;
}

/**
 * Reads and toggles Presenter mode via the `?present=1` query parameter.
 */
export function usePresenterMode() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isPresent = searchParams.get('present') === '1';

  const setPresent = useCallback(
    (enabled: boolean) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (enabled) {
            next.set('present', '1');
          } else {
            next.delete('present');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const togglePresent = useCallback(() => {
    setPresent(!isPresent);
  }, [isPresent, setPresent]);

  return { isPresent, setPresent, togglePresent };
}

/**
 * Registers global Presenter keyboard shortcuts (Part G4.10):
 * - P: toggle Presenter mode
 * - 1: Jump, 2: Slow drag, 3: GNSS spoof, 0: Calm
 * - Q: open shared QR modal (when callback provided), N: next cue
 * Ignores keystrokes inside inputs, textareas, selects, contenteditable elements, and dialogs.
 */
export function usePresenterShortcuts({
  isPresent,
  onTogglePresent,
  onScenario,
  onOpenQr,
  onNextCue,
}: UsePresenterShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      const key = e.key.toLowerCase();

      if (key === 'p') {
        e.preventDefault();
        onTogglePresent();
        return;
      }

      if (!isPresent) return;

      switch (key) {
        case '1':
          e.preventDefault();
          onScenario('jump');
          break;
        case '2':
          e.preventDefault();
          onScenario('slow_drag');
          break;
        case '3':
          e.preventDefault();
          onScenario('gnss_spoof');
          break;
        case '0':
          e.preventDefault();
          onScenario('calm');
          break;
        case 'q':
          if (onOpenQr) {
            e.preventDefault();
            onOpenQr();
          }
          break;
        case 'n':
          e.preventDefault();
          onNextCue();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresent, onTogglePresent, onScenario, onOpenQr, onNextCue]);
}
