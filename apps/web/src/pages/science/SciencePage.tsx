/**
 * Science Impact Page (Part G4.5)
 * Owned by Person 4 (P4-T4)
 */
export function SciencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Science Impact Replay</h2>
        <p className="text-sm text-muted">Asteroid stellar occultation chord fitting and size distortion</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div data-testid="science-panel-truth" className="bg-card border border-border p-4 rounded-xl text-xs text-muted">
          Ground Truth Ellipse
        </div>
        <div data-testid="science-panel-trusted" className="bg-card border border-border p-4 rounded-xl text-xs text-muted">
          Fault Trusted (Naive)
        </div>
        <div data-testid="science-panel-quarantined" className="bg-card border border-border p-4 rounded-xl text-xs text-muted">
          Fault Quarantined (Chronyx)
        </div>
      </div>
    </div>
  );
}
