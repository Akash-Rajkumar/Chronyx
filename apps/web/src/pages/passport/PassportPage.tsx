import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Passport } from '@chronyx/contracts';
import { api, ApiError } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useConnectionStatus,
  useDashboardStore,
  useNode,
} from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { ConfidenceRing } from '../../ui/ConfidenceRing.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { StateChip } from '../../ui/StateChip.js';

export type PassportLoadState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; passport: Passport }
  | { kind: 'not_found'; message: string }
  | { kind: 'error'; message: string };

function formatTimestampUtc(ms: number): string {
  if (!Number.isFinite(ms)) return '--';
  return new Date(ms).toISOString();
}

function formatSignedMs(val: number): string {
  if (!Number.isFinite(val)) return '--';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)} ms`;
}

export function isNotFoundError(err: unknown): boolean {
  if (err instanceof ApiError && err.code === 'NOT_FOUND') return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('404') || msg.includes('not found');
  }
  return false;
}

/**
 * Loads a Timing Passport exclusively via the shared api.getPassport(id) client.
 */
export async function loadPassportById(observationId: string): Promise<PassportLoadState> {
  try {
    const passport = await api.getPassport(observationId);
    return { kind: 'ready', passport };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load timing passport';
    if (isNotFoundError(err)) {
      return { kind: 'not_found', message };
    }
    return { kind: 'error', message };
  }
}

export interface PassportPageProps {
  /** Optional initial state override used for deterministic SSR/unit tests. */
  initialState?: PassportLoadState;
}

/**
 * Timing Passport Page (Part G4.9)
 * Owned by Person 4 (P4-T6)
 */
export function PassportPage({ initialState }: PassportPageProps) {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const connectionStatusHook = useConnectionStatus();
  const isClient = typeof window !== 'undefined';
  const snapshotState = isClient ? null : useDashboardStore.getState();
  const connectionStatus = isClient ? connectionStatusHook : snapshotState!.connectionStatus;

  const [state, setState] = useState<PassportLoadState>(() => {
    if (initialState) return initialState;
    if (!id) return { kind: 'empty' };
    return { kind: 'loading' };
  });

  const fetchPassport = useCallback(async () => {
    if (!id) {
      setState({ kind: 'empty' });
      return;
    }
    setState({ kind: 'loading' });
    const next = await loadPassportById(id);
    setState(next);
  }, [id]);

  useEffect(() => {
    if (initialState) return;
    void fetchPassport();
  }, [fetchPassport, initialState]);

  const passportNodeId = state.kind === 'ready' ? state.passport.node_id : undefined;
  const nodeHook = useNode(passportNodeId);
  const matchedNode = isClient
    ? nodeHook
    : passportNodeId
      ? snapshotState!.nodes.find((n) => n.id === passportNodeId)
      : undefined;

  const isReconnecting = connectionStatus === 'disconnected' || connectionStatus === 'error';
  const isMock = connectionStatus === 'mock';

  return (
    <div
      className={`space-y-5 transition-opacity duration-[180ms] ease-out ${
        isReconnecting ? 'opacity-70' : 'opacity-100'
      }`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted mb-1">
            <Link to="/redteam" className="text-accent-cyan hover:underline font-medium">
              ← Red-Team Console
            </Link>
            {id && (
              <>
                <span>·</span>
                <span className="font-mono">{id}</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Timing Passport
            </h2>
            {isMock ? (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-amber-500/12 border border-amber-400/30 text-amber-200">
                SIMULATED (MOCK)
              </span>
            ) : isReconnecting ? (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-amber-500/12 border border-amber-400/30 text-trust-suspect">
                RECONNECTING
              </span>
            ) : (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-emerald-500/12 border border-emerald-400/30 text-trust-trusted">
                LIVE CLUSTER
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Observation timing passport and signed evidence metadata returned by the hub
          </p>
        </div>

        {id && (
          <Button
            variant="ghost"
            size="sm"
            loading={state.kind === 'loading'}
            onClick={() => void fetchPassport()}
          >
            Refresh
          </Button>
        )}
      </div>

      {state.kind === 'loading' && (
        <div data-testid="passport-loading" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5">
              <Skeleton height={240} />
            </div>
            <div className="lg:col-span-7">
              <Skeleton height={240} />
            </div>
          </div>
          <Skeleton height={160} />
        </div>
      )}

      {state.kind === 'empty' && (
        <div data-testid="passport-empty">
          <EmptyState
            title="No observation selected"
            description="Open a passport from an accepted or released observation in the Red-Team Console to inspect its timing evidence."
            action={
              <Link
                to="/redteam"
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35 hover:bg-accent-cyan/22"
              >
                Open Red-Team Console
              </Link>
            }
          />
        </div>
      )}

      {state.kind === 'not_found' && (
        <div data-testid="passport-not-found">
          <EmptyState
            title="Timing passport not found"
            description={state.message}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" size="sm" onClick={() => void fetchPassport()}>
                  Retry
                </Button>
                <Link
                  to="/redteam"
                  className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg bg-card text-foreground border border-border hover:border-accent-cyan/50"
                >
                  Back to Red-Team
                </Link>
              </div>
            }
          />
        </div>
      )}

      {state.kind === 'error' && (
        <div data-testid="passport-error">
          <EmptyState
            title="Unable to load timing passport"
            description={state.message}
            action={
              <Button variant="primary" size="sm" onClick={() => void fetchPassport()}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {state.kind === 'ready' && (
        <div data-testid="passport-detail" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Identity, Trust State & Confidence */}
            <section className="lg:col-span-5 bg-card border border-border rounded-xl p-5 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[11px] font-mono text-accent-cyan block">
                    Observation Identity
                  </span>
                  <h3 className="text-base font-semibold text-foreground mt-0.5">
                    Timing Certificate
                  </h3>
                </div>
                <StateChip state={state.passport.state_at_observation} size="md" />
              </div>

              <div className="flex items-center justify-between gap-4 py-4 border-y border-border">
                <ConfidenceRing
                  confidence={state.passport.confidence}
                  size={64}
                  label="Confidence"
                />

                <div className="text-right space-y-2 font-mono tabular-nums">
                  <div>
                    <span className="text-[11px] text-muted block font-sans">
                      Estimated Clock Error
                    </span>
                    <span className="text-lg font-semibold text-foreground">
                      {formatSignedMs(state.passport.error_est_ms)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted block font-sans">
                      Uncertainty (1σ)
                    </span>
                    <span className="text-xs text-muted">
                      {`±${state.passport.sigma_ms.toFixed(2)} ms`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-background/60 border border-border rounded-lg divide-y divide-border text-xs">
                <div className="px-3 py-2.5 space-y-0.5">
                  <span className="text-[10px] text-muted block">Observation ID</span>
                  <span className="font-mono text-foreground break-all">
                    {state.passport.observation_id}
                  </span>
                </div>
                <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-muted">State at observation</span>
                  <span className="font-mono text-foreground">
                    {state.passport.state_at_observation}
                  </span>
                </div>
                <div className="px-3 py-2.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted">Node</span>
                    <Link
                      to={`/nodes/${state.passport.node_id}`}
                      className="text-[11px] text-accent-cyan hover:underline font-medium"
                    >
                      Inspect node →
                    </Link>
                  </div>
                  <div className="font-mono text-foreground break-all">
                    {matchedNode
                      ? `${matchedNode.name} (${state.passport.node_id})`
                      : state.passport.node_id}
                  </div>
                </div>
              </div>
            </section>

            {/* Timestamps */}
            <section className="lg:col-span-7 bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="pb-3 border-b border-border">
                <span className="text-[11px] font-mono text-accent-cyan block">
                  Time Correction
                </span>
                <h3 className="text-base font-semibold text-foreground mt-0.5">Timestamps</h3>
                <p className="text-xs text-muted">
                  Observed, error-corrected, and passport issuance timestamps returned by the API
                </p>
              </div>

              <div className="bg-background/60 border border-border rounded-lg divide-y divide-border text-xs font-mono tabular-nums">
                <div className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-muted font-sans">Observed at (UTC)</span>
                  <div className="sm:text-right">
                    <div className="text-foreground font-medium">
                      {formatTimestampUtc(state.passport.observed_at_ms)}
                    </div>
                    <div className="text-[10px] text-muted">
                      {state.passport.observed_at_ms} ms
                    </div>
                  </div>
                </div>

                <div className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-muted font-sans">Corrected time (UTC)</span>
                  <div className="sm:text-right">
                    <div className="text-accent-cyan font-semibold">
                      {formatTimestampUtc(state.passport.corrected_time_ms)}
                    </div>
                    <div className="text-[10px] text-muted">
                      {state.passport.corrected_time_ms} ms
                    </div>
                  </div>
                </div>

                <div className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-muted font-sans">Passport issued at (UTC)</span>
                  <div className="sm:text-right">
                    <div className="text-foreground font-medium">
                      {formatTimestampUtc(state.passport.issued_at_ms)}
                    </div>
                    <div className="text-[10px] text-muted">
                      {state.passport.issued_at_ms} ms
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Signed Evidence Metadata */}
          <section className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-border">
              <div>
                <span className="text-[11px] font-mono text-accent-cyan block">
                  Available Evidence
                </span>
                <h3 className="text-base font-semibold text-foreground mt-0.5">
                  Hashes &amp; Signature Fields
                </h3>
                <p className="text-xs text-muted">
                  Raw hash, public key, and signature values returned in the passport payload (not
                  verified client-side in this view)
                </p>
              </div>
            </div>

            <div className="bg-background/60 border border-border rounded-lg divide-y divide-border text-xs">
              <div className="px-3.5 py-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted block">
                  Evidence Hash
                </span>
                <code className="font-mono text-foreground break-all block">
                  {state.passport.evidence_hash}
                </code>
              </div>

              <div className="px-3.5 py-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted block">
                  Chain Head Hash
                </span>
                <code className="font-mono text-foreground break-all block">
                  {state.passport.chain_head_hash}
                </code>
              </div>

              <div className="px-3.5 py-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted block">
                  Server Public Key
                </span>
                <code className="font-mono text-foreground break-all block">
                  {state.passport.server_public_key}
                </code>
              </div>

              <div className="px-3.5 py-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted block">
                  Signature (Ed25519)
                </span>
                <code className="font-mono text-foreground break-all block">
                  {state.passport.sig}
                </code>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
