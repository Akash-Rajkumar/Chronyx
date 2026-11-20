// TEST-FIXTURE
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../server.js';
import { CONTRACT_VERSION } from '@chronyx/contracts';

describe('apps/server S0 health check', () => {
  it('GET /api/v1/health returns ok, contract_version, db and anchors_ok', async () => {
    const { app } = createServer();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contract_version).toBe(CONTRACT_VERSION);
    expect(typeof res.body.server_time_ms).toBe('number');
    expect(['up', 'down']).toContain(res.body.db);
    expect(typeof res.body.anchors_ok).toBe('boolean');
  });
});

