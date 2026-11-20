import { Routes, Route, NavLink } from 'react-router-dom';
import { CONTRACT_VERSION } from '@chronyx/contracts';
import { OverviewPage } from './pages/overview/OverviewPage.js';
import { NodeDetailPage } from './pages/node/NodeDetailPage.js';
import { ComparePage } from './pages/compare/ComparePage.js';
import { RedTeamPage } from './pages/redteam/RedTeamPage.js';
import { SciencePage } from './pages/science/SciencePage.js';
import { ScoreboardPage } from './pages/scoreboard/ScoreboardPage.js';
import { IncidentsPage } from './pages/incidents/IncidentsPage.js';
import { JoinPage } from './pages/join/JoinPage.js';
import { PassportPage } from './pages/passport/PassportPage.js';

export default function App() {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-card text-accent-cyan border border-border shadow-sm'
        : 'text-muted hover:text-foreground hover:bg-card/50'
    }`;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar (Part G3) */}
      <aside className="w-64 border-r border-border bg-card/40 flex flex-col justify-between p-4 shrink-0">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="h-8 w-8 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center font-bold text-accent-cyan">
              C
            </div>
            <div>
              <h1 className="font-semibold text-base tracking-tight text-foreground">Chronyx</h1>
              <p className="text-xs text-muted">Timing Verification</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Overview
            </NavLink>
            <NavLink to="/compare" className={navLinkClass}>
              Before vs After
            </NavLink>
            <NavLink to="/redteam" className={navLinkClass}>
              Red-Team Console
            </NavLink>
            <NavLink to="/science" className={navLinkClass}>
              Science Impact
            </NavLink>
            <NavLink to="/scoreboard" className={navLinkClass}>
              Scoreboard
            </NavLink>
            <NavLink to="/incidents" className={navLinkClass}>
              Incidents
            </NavLink>
            <NavLink to="/passport" className={navLinkClass}>
              Timing Passport
            </NavLink>
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-border/60">
          <NavLink
            to="/join"
            data-testid="join-button"
            className="w-full py-2 px-3 rounded-lg bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/40 text-accent-cyan text-sm font-medium flex items-center justify-center transition-colors"
          >
            Join as a Node
          </NavLink>

          <div className="text-xs text-muted/70 flex flex-col gap-1 px-1">
            <div className="flex items-center justify-between">
              <span>Contract</span>
              <span className="font-mono text-[11px] text-muted">v{CONTRACT_VERSION}</span>
            </div>
            <div className="flex items-center justify-between">
              <span data-testid="connection-banner">Socket</span>
              <span className="text-trust-trusted flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-trust-trusted"></span>
                Connected
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Anchors</span>
              <span className="text-muted flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted"></span>
                OK
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 overflow-auto bg-background p-6">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/nodes/:id" element={<NodeDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/redteam" element={<RedTeamPage />} />
          <Route path="/science" element={<SciencePage />} />
          <Route path="/scoreboard" element={<ScoreboardPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/incidents/:id" element={<IncidentsPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/passport" element={<PassportPage />} />
          <Route path="/passport/:id" element={<PassportPage />} />
        </Routes>
      </main>
    </div>
  );
}
