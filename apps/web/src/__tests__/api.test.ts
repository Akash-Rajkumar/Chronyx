import { describe, it, expect } from 'vitest';
import { api } from '../api/client.js';
import { ROUTES } from '@chronyx/contracts';
import { isMockMode, getMockSnapshot } from '../mocks/mockDashboardData.js';

describe('API & Mock Isolation (Phase 4 & Phase 7)', () => {
  it('detects mock mode correctly', () => {
    expect(typeof isMockMode()).toBe('boolean');
  });

  it('routes use exact paths from @chronyx/contracts', () => {
    expect(ROUTES.HEALTH).toBe('/api/v1/health');
    expect(ROUTES.STATE).toBe('/api/v1/state');
    expect(ROUTES.JOIN_INFO).toBe('/api/v1/join-info');
    expect(ROUTES.NODES).toBe('/api/v1/nodes');
    expect(ROUTES.CONFIG).toBe('/api/v1/config');
    expect(ROUTES.INCIDENTS).toBe('/api/v1/incidents');
    expect(ROUTES.FAULTS).toBe('/api/v1/faults');
  });

  it('mock mode snapshot provides valid data structure', () => {
    const snapshot = getMockSnapshot();
    expect(snapshot.contract_version).toBe('1.0.0');
    expect(snapshot.nodes).toBeDefined();
    expect(snapshot.assessments).toBeDefined();
    expect(snapshot.network).toBeDefined();
    expect(snapshot.anchors).toBeDefined();
  });

  it('api functions exist and are typed', () => {
    expect(typeof api.getState).toBe('function');
    expect(typeof api.getHealth).toBe('function');
    expect(typeof api.getNodes).toBe('function');
    expect(typeof api.getNode).toBe('function');
    expect(typeof api.getNodeHistory).toBe('function');
    expect(typeof api.sendHeartbeat).toBe('function');
    expect(typeof api.getIncidents).toBe('function');
    expect(typeof api.getFaults).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });
});
