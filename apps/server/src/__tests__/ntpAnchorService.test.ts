// TEST-FIXTURE
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ROUTES } from '@chronyx/contracts';
import { AnchorService } from '../core/anchorService.js';
import { createCoreRoutes } from '../core/routes.js';
import { buildSnapshot } from '../core/snapshot.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';

describe('Production NTP Anchor Service & Routes (Part E2b)', () => {
  let anchorService: AnchorService;

  beforeEach(() => {
    anchorService = new AnchorService({
      hosts: ['samay1.nic.in', 'samay2.nic.in', 'time.nplindia.org'],
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    anchorService.stop();
  });

  it('1. initializes with unpolled status (ok: false, offset_ms: null)', () => {
    const anchors = anchorService.getAnchors();
    expect(anchors.length).toBe(3);
    for (const a of anchors) {
      expect(a.ok).toBe(false);
      expect(a.offset_ms).toBeNull();
      expect(a.rtt_ms).toBeNull();
      expect(typeof a.sampled_at_ms).toBe('number');
    }
    expect(anchorService.isOk()).toBe(false);
    expect(anchorService.getStatus()).toEqual({
      ok: false,
      offset_ms: null,
      sigma_ms: null,
    });
  });

  it('2. queryHost handles unreachable host gracefully with timeout', async () => {
    const unreachableService = new AnchorService({
      hosts: ['192.0.2.1'], // RFC 5737 TEST-NET-1 (blackhole / unreachable)
      timeoutMs: 50,
    });
    const info = await unreachableService.queryHost('192.0.2.1');
    expect(info.ok).toBe(false);
    expect(info.offset_ms).toBeNull();
    expect(info.rtt_ms).toBeNull();
  });

  it('3. queryHost parses and validates live external NTP servers', async () => {
    // Live query against the configured primary anchor
    const info = await anchorService.queryHost('samay1.nic.in');
    // If the network allows UDP 123, verify real parsed values
    if (info.ok) {
      expect(typeof info.offset_ms).toBe('number');
      expect(typeof info.rtt_ms).toBe('number');
      expect(info.rtt_ms).toBeGreaterThanOrEqual(0);
      expect(info.sampled_at_ms).toBeGreaterThan(0);
    } else {
      expect(info.offset_ms).toBeNull();
    }
  });

  it('4. calculates consensus status and dispersion when anchors respond', async () => {
    // Mock queryHost to simulate 3 independent validated NTP responses
    vi.spyOn(anchorService, 'queryHost').mockImplementation(async (host: string) => {
      const offsets: Record<string, number> = {
        'samay1.nic.in': 1.2,
        'samay2.nic.in': 1.0,
        'time.nplindia.org': 1.5,
      };
      return {
        host,
        offset_ms: offsets[host] ?? 1.0,
        rtt_ms: 45.0,
        ok: true,
        sampled_at_ms: Date.now(),
      };
    });

    const results = await anchorService.poll();
    expect(results.length).toBe(3);
    expect(anchorService.isOk()).toBe(true);

    const status = anchorService.getStatus();
    expect(status.ok).toBe(true);
    // Dispersion between 1.0 and 1.5 is 0.5 ms
    expect(status.sigma_ms).toBe(0.5);
    // Offset relative to median (1.2) is 1.0 - 1.2 = -0.2 ms
    expect(status.offset_ms).toBe(-0.2);
  });

  it('5. propagates anchor availability to GET /api/v1/health and GET /api/v1/anchors', async () => {
    // Simulate synchronized anchor service
    vi.spyOn(anchorService, 'isOk').mockReturnValue(true);
    vi.spyOn(anchorService, 'getAnchors').mockReturnValue([
      {
        host: 'samay1.nic.in',
        offset_ms: 1.2,
        rtt_ms: 42.0,
        ok: true,
        sampled_at_ms: Date.now(),
      },
    ]);

    const nodeRegistry = new NodeRegistry();
    const heartbeatService = new HeartbeatService(nodeRegistry);
    const app = express();
    app.use(createCoreRoutes(nodeRegistry, heartbeatService, undefined, undefined, null, anchorService));

    const healthRes = await request(app).get(ROUTES.HEALTH).expect(200);
    expect(healthRes.body.anchors_ok).toBe(true);

    const anchorsRes = await request(app).get(ROUTES.ANCHORS).expect(200);
    expect(anchorsRes.body.length).toBe(1);
    expect(anchorsRes.body[0].host).toBe('samay1.nic.in');
    expect(anchorsRes.body[0].ok).toBe(true);
    expect(anchorsRes.body[0].offset_ms).toBe(1.2);
  });

  it('6. buildSnapshot incorporates live anchor status into network.anchor_ok', async () => {
    vi.spyOn(anchorService, 'isOk').mockReturnValue(true);
    vi.spyOn(anchorService, 'getAnchors').mockReturnValue([
      {
        host: 'samay1.nic.in',
        offset_ms: 0.5,
        rtt_ms: 35.0,
        ok: true,
        sampled_at_ms: Date.now(),
      },
    ]);

    const nodeRegistry = new NodeRegistry();
    const snapshot = await buildSnapshot(nodeRegistry, undefined, undefined, null, anchorService);

    expect(snapshot.network.anchor_ok).toBe(true);
    expect(snapshot.anchors.length).toBe(1);
    expect(snapshot.anchors[0]?.ok).toBe(true);
  });
});
