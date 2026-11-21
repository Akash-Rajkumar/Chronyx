// TEST-FIXTURE
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from '../api/client.js';
import { isMockMode } from '../api/socket.js';
import { ROUTES, mockSnapshot, CONTRACT_VERSION } from '@chronyx/contracts';
import type { ObservationCreate } from '@chronyx/contracts';

describe('API & Mock Isolation (C1, C3, C4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('C1 — Mock Mode Policy', () => {
    it('activates ONLY when VITE_USE_MOCKS is exactly "1"', () => {
      const orig = import.meta.env['VITE_USE_MOCKS'];

      try {
        import.meta.env['VITE_USE_MOCKS'] = '1';
        expect(isMockMode()).toBe(true);

        // Must reject "true", boolean true, "0", empty, and undefined
        import.meta.env['VITE_USE_MOCKS'] = 'true';
        expect(isMockMode()).toBe(false);

        import.meta.env['VITE_USE_MOCKS'] = '0';
        expect(isMockMode()).toBe(false);

        import.meta.env['VITE_USE_MOCKS'] = '';
        expect(isMockMode()).toBe(false);

        delete import.meta.env['VITE_USE_MOCKS'];
        expect(isMockMode()).toBe(false);
      } finally {
        import.meta.env['VITE_USE_MOCKS'] = orig;
      }
    });

    it('mock mode snapshot provides valid fixture structure', () => {
      const snapshot = JSON.parse(JSON.stringify(mockSnapshot));
      expect(snapshot.contract_version).toBe(CONTRACT_VERSION);
      expect(snapshot.nodes).toBeDefined();
      expect(snapshot.assessments).toBeDefined();
    });
  });

  describe('C3 — Strict Zod Validation', () => {
    it('returns parsed data on valid schema response', async () => {
      const mockState = JSON.parse(JSON.stringify(mockSnapshot));
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockState,
      } as Response);

      const data = await api.getState();
      expect(data.contract_version).toBe(CONTRACT_VERSION);
      expect(data.nodes).toHaveLength(mockState.nodes.length);
    });

    it('rejects with ApiError when response violates schema', async () => {
      // Missing required fields like server_time_ms, nodes, assessments
      const invalidJson = { contract_version: '1.0.0' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidJson,
      } as Response);

      await expect(api.getState()).rejects.toThrow(ApiError);
    });

    it('retains safe diagnostic paths without leaking payload values', async () => {
      const invalidJson = { contract_version: '1.0.0', sensitive_secret: 'SHOULD_NOT_LEAK' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidJson,
      } as Response);

      try {
        await api.getState();
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('BAD_REQUEST');
        expect(apiErr.message).toContain('Response validation failed for /api/v1/state');
        expect(apiErr.message).not.toContain('SHOULD_NOT_LEAK');
        expect(Array.isArray(apiErr.details)).toBe(true);
      }
    });

    it('preserves HTTP error handling', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { message: 'Entity not found', code: 'NOT_FOUND' } }),
      } as Response);

      await expect(api.getIncident('missing-id')).rejects.toThrow('Entity not found');
    });
  });

  describe('C4 — Optional Payload Fields', () => {
    it('forwards target_node_id in triggerScenario when supplied', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

      await api.triggerScenario('jump', '00000000-0000-0000-0000-000000000001');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0]!;
      expect(call[0]).toContain(ROUTES.DEMO_SCENARIO);
      const body = JSON.parse(call[1]?.body as string);
      expect(body).toEqual({
        name: 'jump',
        target_node_id: '00000000-0000-0000-0000-000000000001',
      });
    });

    it('omits target_node_id in triggerScenario when undefined', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

      await api.triggerScenario('calm');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0]!;
      const body = JSON.parse(call[1]?.body as string);
      expect(body).toEqual({ name: 'calm' });
      expect('target_node_id' in body).toBe(false);
    });

    it('forwards hard: true in resetDemo', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

      await api.resetDemo(true);

      const call = fetchSpy.mock.calls[0]!;
      const body = JSON.parse(call[1]?.body as string);
      expect(body).toEqual({ hard: true });
    });

    it('forwards hard: false explicitly in resetDemo', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

      await api.resetDemo(false);

      const call = fetchSpy.mock.calls[0]!;
      const body = JSON.parse(call[1]?.body as string);
      expect(body).toEqual({ hard: false });
    });

    it('omits hard in resetDemo when undefined', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

      await api.resetDemo();

      const call = fetchSpy.mock.calls[0]!;
      const body = JSON.parse(call[1]?.body as string);
      expect(body).toEqual({});
    });
  });

  describe('createObservation', () => {
    const validPayload: ObservationCreate = {
      node_id: '00000000-0000-0000-0000-000000000001',
      kind: 'occultation_timing',
      observed_at_ms: 1700000000000,
      payload: { station: 'S1', duration_ms: 120.5 },
    };

    const validObservation = {
      id: '11111111-1111-1111-1111-111111111111',
      node_id: '00000000-0000-0000-0000-000000000001',
      kind: 'occultation_timing',
      observed_at_ms: 1700000000000,
      payload: { station: 'S1', duration_ms: 120.5 },
      status: 'accepted',
      confidence: 0.95,
      state_at_ingest: 'trusted',
      created_at: new Date().toISOString(),
    };

    it('sends POST to ROUTES.OBSERVATIONS with exact request payload', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => validObservation,
      } as Response);

      await api.createObservation(validPayload);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toContain(ROUTES.OBSERVATIONS);
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
      expect(JSON.parse(init?.body as string)).toEqual(validPayload);
    });

    it('returns a valid parsed Observation on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => validObservation,
      } as Response);

      const result = await api.createObservation(validPayload);
      expect(result.id).toBe(validObservation.id);
      expect(result.node_id).toBe(validPayload.node_id);
      expect(result.status).toBe('accepted');
      expect(result.confidence).toBe(0.95);
    });

    it('rejects an invalid response with ApiError', async () => {
      const invalidResponse = { id: 'not-a-uuid' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidResponse,
      } as Response);

      await expect(api.createObservation(validPayload)).rejects.toThrow(ApiError);
    });

    it('preserves existing HTTP error behavior', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: { message: 'Invalid node ID or observation payload', code: 'BAD_REQUEST' },
        }),
      } as Response);

      await expect(api.createObservation(validPayload)).rejects.toThrow('Invalid node ID or observation payload');
    });
  });
});
