import { Link } from 'react-router-dom';

/**
 * Join as a Node Page (Part G4.8)
 * Owned by Person 3 (P3-T2)
 */
export function JoinPage() {
  return (
    <div className="chronyx-canvas min-h-screen w-full flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-accent-cyan/90">
            <span>Chronyx</span>
            <span className="text-white/25">·</span>
            <span className="text-muted">Browser Node Agent</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Join Observatory Network
          </h2>
          <p className="text-sm text-muted">Connect your browser clock as a timing node</p>
        </div>

        <div className="chronyx-glass-elevated chronyx-corner-ticks p-6 rounded-[14px] space-y-5">
          <div
            data-testid="demo-attack-banner"
            className="hidden bg-amber-500/12 border border-amber-400/30 border-l-2 border-l-trust-suspect text-amber-200 p-3 rounded-[10px] text-xs"
          >
            Demo attack in progress (simulated, software-only).
          </div>

          <div className="space-y-2">
            <label htmlFor="node-handle" className="text-xs font-medium text-muted block">
              Node Handle
            </label>
            <input
              id="node-handle"
              type="text"
              defaultValue="Judge-Node"
              className="chronyx-input w-full px-3.5 py-2.5 rounded-[10px] text-sm"
            />
          </div>

          <button
            data-testid="join-status"
            type="button"
            className="w-full py-2.5 px-4 bg-accent-cyan hover:bg-[#5BE0F7] text-[#050B16] font-semibold rounded-[10px] text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2px_10px_rgba(61,214,245,0.16)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_6px_18px_rgba(61,214,245,0.24)] active:translate-y-[0.5px] active:shadow-none transition-[background-color,transform,box-shadow] duration-[180ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
          >
            Connect Node
          </button>

          <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between text-xs text-muted">
            <span>Software-only browser clock agent</span>
            <Link
              to="/"
              className="text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded"
            >
              Back to Overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
