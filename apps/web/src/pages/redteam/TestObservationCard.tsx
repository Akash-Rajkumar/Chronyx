import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ObservationCreateSchema } from '@chronyx/contracts';
import type {
  Assessment,
  NodeInfo,
  Observation,
  ObservationCreate,
  ObservationStatus,
} from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { StateChip } from '../../ui/StateChip.js';

export type ObservationKind = ObservationCreate['kind'];

export interface BuildObservationInput {
  nodeId: string;
  kind: ObservationKind;
  observedAtMs: number;
  note?: string;
}

const OBSERVATION_KIND_OPTIONS: ReadonlyArray<{ value: ObservationKind; label: string }> = [
  { value: 'occultation_timing', label: 'Occultation timing (occultation_timing)' },
  { value: 'generic', label: 'Generic observation (generic)' },
];

const STATUS_BADGE_STYLES: Record<ObservationStatus, string> = {
  accepted: 'bg-trust-trusted/12 text-trust-trusted border-trust-trusted/30',
  released: 'bg-trust-trusted/12 text-trust-trusted border-trust-trusted/30',
  held: 'bg-trust-suspect/12 text-trust-suspect border-trust-suspect/30',
  rejected: 'bg-trust-quarantined/12 text-trust-quarantined border-trust-quarantined/30',
};

/**
 * Constructs and validates an ObservationCreate payload against the frozen contract schema.
 */
export function buildObservationCreatePayload(input: BuildObservationInput): ObservationCreate {
  const trimmedNote = input.note?.trim() ?? '';
  const payload: Record<string, unknown> =
    trimmedNote.length > 0
      ? { source: 'redteam_console', note: trimmedNote }
      : { source: 'redteam_console' };

  return ObservationCreateSchema.parse({
    node_id: input.nodeId,
    kind: input.kind,
    observed_at_ms: input.observedAtMs,
    payload,
  });
}

/**
 * Submits a validated test observation exclusively through the shared api.createObservation() client.
 */
export async function submitTestObservation(input: BuildObservationInput): Promise<Observation> {
  const validated = buildObservationCreatePayload(input);
  return api.createObservation(validated);
}

export interface ObservationResultCardProps {
  observation: Observation;
}

export function ObservationResultCard({ observation }: ObservationResultCardProps) {
  const isPassportReady = observation.status === 'accepted' || observation.status === 'released';
  const confidencePct = Math.round(observation.confidence * 100);

  return (
    <div
      data-testid="redteam-observation-result"
      className="bg-background/60 border border-border rounded-lg p-3.5 space-y-2.5 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold uppercase border ${STATUS_BADGE_STYLES[observation.status]}`}
          >
            {observation.status}
          </span>
          <span className="font-mono text-[11px] text-muted">
            id: {observation.id.slice(0, 8)}
          </span>
        </div>
        <span className="font-mono text-[11px] text-foreground tabular-nums">
          confidence: {confidencePct}%
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
        <span>kind: {observation.kind}</span>
        <span>state at ingest: {observation.state_at_ingest}</span>
      </div>

      {isPassportReady && (
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-foreground">
            Observation {observation.status}. Timing passport is available.
          </span>
          <Link
            to={`/passport/${observation.id}`}
            data-testid="redteam-passport-link"
            className="inline-flex items-center font-semibold text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded"
          >
            View Timing Passport →
          </Link>
        </div>
      )}

      {observation.status === 'held' && (
        <p className="text-amber-100 leading-relaxed">
          {`Held based on node trust state at ingest (${observation.state_at_ingest}). The observation is quarantined from science pipelines until verification clears or rejects it.`}
        </p>
      )}

      {observation.status === 'rejected' && (
        <p className="text-rose-100 leading-relaxed">Observation was rejected.</p>
      )}
    </div>
  );
}

export interface TestObservationCardProps {
  selectedNode: NodeInfo | undefined;
  assessment: Assessment | undefined;
}

export function TestObservationCard({ selectedNode, assessment }: TestObservationCardProps) {
  const [kind, setKind] = useState<ObservationKind>('occultation_timing');
  const [observedAtInput, setObservedAtInput] = useState<string>(() => String(Date.now()));
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastObservation, setLastObservation] = useState<Observation | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;

    const parsedTimestamp = Number(observedAtInput.trim());
    if (!observedAtInput.trim() || !Number.isFinite(parsedTimestamp)) {
      setSubmitError('Observed at (ms) is required and must be a finite Unix timestamp in milliseconds.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const created = await submitTestObservation({
        nodeId: selectedNode.id,
        kind,
        observedAtMs: parsedTimestamp,
        note,
      });
      setLastObservation(created);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit test observation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      data-testid="redteam-observation-card"
      className="bg-card border border-border border-t-2 border-t-accent-cyan/75 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
        <div>
          <span className="text-[11px] font-mono text-accent-cyan block">
            Trust-Gate Probe
          </span>
          <h3 className="text-base font-semibold text-foreground mt-0.5">
            Submit Test Observation
          </h3>
          <p className="text-xs text-muted">
            Verify whether the selected node&apos;s observation is accepted, held, released, or rejected
          </p>
        </div>
        {assessment && <StateChip state={assessment.state} size="sm" />}
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 text-xs">
        <div className="bg-background/60 border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-muted">Target node *</span>
          <span className="font-mono text-foreground font-medium truncate">
            {selectedNode ? `${selectedNode.name} (${selectedNode.kind})` : '--'}
          </span>
        </div>

        <label className="block space-y-1">
          <span className="text-muted">Observation kind *</span>
          <select
            aria-label="Observation kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value as ObservationKind)}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:border-accent-cyan"
          >
            {OBSERVATION_KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="redteam-observed-at-ms" className="text-muted">
              Observed at (Unix ms) *
            </label>
            <button
              type="button"
              onClick={() => setObservedAtInput(String(Date.now()))}
              className="text-[11px] font-mono text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded px-1"
            >
              Use now
            </button>
          </div>
          <input
            id="redteam-observed-at-ms"
            type="number"
            required
            step="1"
            value={observedAtInput}
            onChange={(e) => setObservedAtInput(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground font-mono text-xs tabular-nums focus:outline-none focus:border-accent-cyan"
          />
        </div>

        <label className="block space-y-1">
          <span className="text-muted">Payload note (optional)</span>
          <input
            type="text"
            placeholder="e.g. Chord ingress timing check"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:border-accent-cyan"
          />
        </label>

        {submitError && (
          <div className="bg-trust-quarantined/10 border border-trust-quarantined/35 border-l-2 border-l-trust-quarantined rounded-lg p-3 text-xs text-rose-100">
            {submitError}
          </div>
        )}

        <div className="pt-1 flex justify-end">
          <Button
            type="submit"
            data-testid="redteam-submit-observation"
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={!selectedNode || submitting}
          >
            Submit Observation
          </Button>
        </div>
      </form>

      {lastObservation && <ObservationResultCard observation={lastObservation} />}
    </section>
  );
}
