/**
 * Live Overview Page (Part G4.1)
 * Owned by Person 3 (P3-T3)
 */
export function OverviewPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Observatory Overview</h2>
          <p className="text-sm text-muted">Realtime timing verification across observatory nodes</p>
        </div>
        <div data-testid="network-health" className="flex items-center gap-3 bg-card border border-border px-4 py-2 rounded-xl">
          <span className="text-xs text-muted">Network Health</span>
          <span className="font-mono text-lg font-bold text-accent-cyan">--</span>
        </div>
      </div>

      <div data-testid="alert-strip" className="bg-card/50 border border-border/60 p-3 rounded-lg text-xs text-muted">
        No recent transitions. All nodes operational.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div data-testid="node-card" className="bg-card border border-border p-4 rounded-xl space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm">Cluster Standby</span>
            <span data-testid="state-chip" className="text-xs px-2 py-0.5 rounded bg-muted/20 text-muted">
              Standby
            </span>
          </div>
          <div data-testid="confidence-ring" className="text-xs text-muted">
            Awaiting live telemetry or mock feed...
          </div>
        </div>
      </div>
    </div>
  );
}
