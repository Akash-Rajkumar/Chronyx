/**
 * Join as a Node Page (Part G4.8)
 * Owned by Person 3 (P3-T2)
 */
export function JoinPage() {
  return (
    <div className="max-w-md mx-auto space-y-6 pt-10">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Join Observatory Network</h2>
        <p className="text-sm text-muted">Connect your browser clock as a timing node</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-xl space-y-4">
        <div data-testid="demo-attack-banner" className="hidden bg-amber-500/20 text-amber-300 p-3 rounded-lg text-xs">
          Demo attack in progress (simulated, software-only).
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted block">Node Handle</label>
          <input
            type="text"
            defaultValue="Judge-Node"
            className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm text-foreground focus:outline-none focus:border-accent-cyan"
          />
        </div>

        <button
          data-testid="join-status"
          className="w-full py-2.5 bg-accent-cyan hover:bg-accent-cyan/90 text-background font-semibold rounded-lg text-sm transition-colors"
        >
          Connect Node
        </button>
      </div>
    </div>
  );
}
