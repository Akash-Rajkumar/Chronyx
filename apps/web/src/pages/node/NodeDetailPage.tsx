import { useParams } from 'react-router-dom';

/**
 * Node Detail Page (Part G4.2)
 * Owned by Person 3 (P3-T4)
 */
export function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Node Detail</h2>
        <p className="text-sm text-muted font-mono">Node ID: {id}</p>
      </div>
      <div className="bg-card border border-border p-6 rounded-xl text-center text-muted text-sm">
        Telemetry stream and residual analysis placeholder (P3-T4)
      </div>
    </div>
  );
}
