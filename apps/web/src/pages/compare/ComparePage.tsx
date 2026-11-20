/**
 * Before vs After Page (The Hero Page - Part G4.3)
 * Owned by Person 4 (P4-T2)
 */
export function ComparePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Before vs After Comparison</h2>
          <p className="text-sm text-muted">Naive clock follower vs Chronyx verification layer</p>
        </div>
        <div data-testid="scenario-bar" className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-card border border-border hover:bg-card/80">
            Calm
          </button>
          <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-card border border-border hover:bg-card/80">
            Jump
          </button>
          <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-card border border-border hover:bg-card/80">
            Slow Drag
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div data-testid="compare-left" className="bg-card border border-border p-4 rounded-xl space-y-2">
          <h3 className="text-sm font-semibold text-muted">Naive Follower (Model)</h3>
          <p className="text-xs text-muted">Unverified baseline clock</p>
        </div>
        <div data-testid="compare-right" className="bg-card border border-border p-4 rounded-xl space-y-2">
          <h3 className="text-sm font-semibold text-accent-cyan">Chronyx Verified</h3>
          <p className="text-xs text-muted">Fault detection and quarantine</p>
        </div>
      </div>

      <div data-testid="compare-chart" className="bg-card/40 border border-border p-6 rounded-xl text-center text-muted text-xs">
        Shared timing error comparison chart placeholder (P4-T2)
      </div>

      <div data-testid="metrics-strip" className="bg-card border border-border p-4 rounded-xl flex items-center justify-between text-xs text-muted">
        <span>Time to Detect: --</span>
        <span>Error at Detection: --</span>
        <span>Baseline Alarms: 0</span>
      </div>
    </div>
  );
}
