import { useEffect } from 'react';
import { useJoinStore } from '../../state/useJoinStore.js';
import { Card } from '../../ui/Card.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';

export function JoinPage() {
  const isClient = typeof window !== 'undefined';
  const storeState = isClient ? null : useJoinStore.getState();
  const storeHook = useJoinStore();
  const current = isClient ? storeHook : storeState!;

  const {
    status,
    identity,
    nodeInfo,
    nodeName,
    seq,
    prevHash,
    lastPingRttMs,
    recentExchanges,
    activeFaults,
    wakeLockActive,
    errorMessage,
    setNodeName,
    initIdentity,
    connect,
    disconnect,
    clearError,
  } = current;

  useEffect(() => {
    if (typeof window !== 'undefined' && !identity && status === 'idle') {
      void initIdentity();
    }
  }, [identity, status, initIdentity]);

  const isJoined = status === 'joined';
  const isBusy = status === 'registering' || status === 'connecting';
  const hasFault = activeFaults.length > 0;

  const handleAction = async () => {
    if (isJoined) {
      await disconnect();
    } else {
      if (status === 'error') {
        clearError();
      }
      await connect();
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'joined':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Verified & Connected
          </span>
        );
      case 'registering':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-spin" />
            Registering Identity...
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Connecting to Gateway...
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
            Connection Error
          </span>
        );
      case 'idle':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/10 text-muted border border-border">
            <span className="h-1.5 w-1.5 rounded-full bg-muted" />
            Standby / Offline
          </span>
        );
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pt-4 pb-12 px-4">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Join Observatory Network
        </h2>
        <p className="text-sm text-muted">
          Connect your browser clock as a real timing node. Signs heartbeats via Ed25519 and participates in two-way peer time-pings.
        </p>
      </div>

      {/* Demo attack banner */}
      <div
        data-testid="demo-attack-banner"
        className={`${
          hasFault ? 'block' : 'hidden'
        } bg-amber-500/20 border border-amber-500/40 text-amber-300 p-3 rounded-xl text-xs flex items-center justify-between`}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
          <span>
            Demo attack in progress (simulated, software-only):{' '}
            <strong>{activeFaults.map((f) => f.type).join(', ')}</strong>
          </span>
        </div>
        <span className="font-mono text-[11px] opacity-80">Fault Active</span>
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 p-3 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Error:</span>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={clearError}
            className="text-xs underline hover:text-foreground ml-3 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Node Registration & Control Card */}
      <Card
        title="Browser Node Identity"
        subtitle="Cryptographically generated in-memory session keys"
        action={getStatusBadge()}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted block font-medium">Node Handle / Name</label>
            <input
              type="text"
              value={nodeName}
              disabled={isJoined || isBusy}
              onChange={(e) => setNodeName(e.target.value)}
              placeholder="e.g. Judge-Node-1"
              className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm text-foreground focus:outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          {/* Node Identity Details */}
          {(identity || nodeInfo) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-xs font-mono">
              <div className="bg-background/60 p-2.5 rounded-lg border border-border/50">
                <span className="text-muted block text-[11px]">Assigned Node ID:</span>
                <span className="text-foreground truncate block">
                  {nodeInfo?.id || identity?.nodeId || 'Awaiting registration...'}
                </span>
              </div>
              <div className="bg-background/60 p-2.5 rounded-lg border border-border/50">
                <span className="text-muted block text-[11px]">Ed25519 Public Key:</span>
                <span className="text-accent-cyan truncate block">
                  {identity?.publicKeyBase64 ? `${identity.publicKeyBase64.slice(0, 16)}...` : 'Generating...'}
                </span>
              </div>
            </div>
          )}

          {/* Security & Memory Lifecycle Notice */}
          <div className="bg-background/40 border border-border/40 rounded-lg p-2.5 text-[11px] text-muted space-y-1">
            <span className="font-medium text-foreground block">Key Security &amp; Session Isolation:</span>
            <p>
              Private key material is held exclusively in memory and is never written to localStorage. A browser tab reload generates fresh session key material and registers a clean node identity.
            </p>
          </div>

          {/* Wake Lock & Platform indicators */}
          <div className="flex items-center justify-between text-xs text-muted pt-1">
            <span className="flex items-center gap-1.5">
              <span>Screen Wake Lock:</span>
              <strong className={wakeLockActive ? 'text-emerald-400 font-normal' : 'text-muted font-normal'}>
                {wakeLockActive ? 'Active (Screen on)' : 'Inactive / Fallback'}
              </strong>
            </span>
            <span className="font-mono text-[11px]">Platform: Web / Browser</span>
          </div>

          {/* Action Button */}
          <Button
            data-testid="join-status"
            variant={isJoined ? 'danger' : 'primary'}
            loading={isBusy}
            onClick={handleAction}
            className="w-full py-2.5 font-semibold text-sm"
          >
            {status === 'joined'
              ? 'Disconnect Node'
              : status === 'registering'
              ? 'Registering Node...'
              : status === 'connecting'
              ? 'Connecting to Gateway...'
              : status === 'error'
              ? 'Retry Connection'
              : 'Connect Node'}
          </Button>
        </div>
      </Card>

      {/* Realtime Telemetry Card */}
      <Card
        title="Realtime Telemetry & Heartbeat Chain"
        subtitle="1 Hz cryptographic heartbeats submitted over WebSocket"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
          <div className="bg-background/50 border border-border/60 p-3 rounded-lg">
            <span className="text-muted text-xs block">Heartbeat Sequence</span>
            <span className="text-lg font-bold font-mono text-foreground mt-0.5 block">{seq}</span>
          </div>
          <div className="bg-background/50 border border-border/60 p-3 rounded-lg">
            <span className="text-muted text-xs block">Last Ping RTT</span>
            <span className="text-lg font-bold font-mono text-accent-cyan mt-0.5 block">
              {lastPingRttMs !== null ? `${lastPingRttMs.toFixed(1)} ms` : '—'}
            </span>
          </div>
          <div className="bg-background/50 border border-border/60 p-3 rounded-lg col-span-2 sm:col-span-1">
            <span className="text-muted text-xs block">Chain Head Hash</span>
            <span
              className="text-xs font-mono text-muted/90 mt-1.5 block truncate"
              title={prevHash}
            >
              {prevHash ? `${prevHash.slice(0, 10)}...${prevHash.slice(-8)}` : '—'}
            </span>
          </div>
        </div>
      </Card>

      {/* Time-Ping Exchanges Table */}
      <Card
        title="Time-Ping Exchanges"
        subtitle="Retains latest 8 two-way time exchanges (t1..t4) for cluster clock synchronization"
      >
        {recentExchanges.length === 0 ? (
          <EmptyState
            title="No Exchanges Recorded"
            description="Connect this node to start performing bidirectional time-pings with the hub."
            className="py-6"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border text-muted uppercase text-[10px]">
                  <th className="py-2 px-2">#</th>
                  <th className="py-2 px-2 font-mono">t1 (Send)</th>
                  <th className="py-2 px-2 font-mono">t2 (Hub Rx)</th>
                  <th className="py-2 px-2 font-mono">t3 (Hub Tx)</th>
                  <th className="py-2 px-2 font-mono">t4 (Local Rx)</th>
                  <th className="py-2 px-2 text-right">Round Trip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {recentExchanges.map((ex, idx) => {
                  const rtt = Math.max(0, (ex.t4 - ex.t1) - (ex.t3 - ex.t2));
                  return (
                    <tr key={idx} className="hover:bg-card/40">
                      <td className="py-2 px-2 text-muted">{idx + 1}</td>
                      <td className="py-2 px-2">{ex.t1.toFixed(1)}</td>
                      <td className="py-2 px-2">{ex.t2.toFixed(1)}</td>
                      <td className="py-2 px-2">{ex.t3.toFixed(1)}</td>
                      <td className="py-2 px-2">{ex.t4.toFixed(1)}</td>
                      <td className="py-2 px-2 text-right text-accent-cyan">
                        {rtt.toFixed(2)} ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
export default JoinPage;
