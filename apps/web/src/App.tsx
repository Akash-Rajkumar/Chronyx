import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from './shell/index.js';
import { OverviewPage } from './pages/overview/OverviewPage.js';
import { NodeDetailPage } from './pages/node/NodeDetailPage.js';
import { ComparePage } from './pages/compare/ComparePage.js';
import { RedTeamPage } from './pages/redteam/RedTeamPage.js';
import { SciencePage } from './pages/science/SciencePage.js';
import { ScoreboardPage } from './pages/scoreboard/ScoreboardPage.js';
import { IncidentsPage } from './pages/incidents/IncidentsPage.js';
import { JoinPage } from './pages/join/JoinPage.js';
import { PassportPage } from './pages/passport/PassportPage.js';

function DashboardLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/join" element={<JoinPage />} />
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/nodes/:id" element={<NodeDetailPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/redteam" element={<RedTeamPage />} />
        <Route path="/science" element={<SciencePage />} />
        <Route path="/scoreboard" element={<ScoreboardPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentsPage />} />
        <Route path="/passport" element={<PassportPage />} />
        <Route path="/passport/:id" element={<PassportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
