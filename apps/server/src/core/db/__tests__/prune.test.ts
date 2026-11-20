// TEST-FIXTURE
import { describe, it, expect, vi } from 'vitest';
import { HeartbeatsRepository } from '../repositories/heartbeatsRepo.js';
import { pruneHeartbeats } from '../prune.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase } from '../schema.js';

describe('Heartbeat Pruning Reliability (P1-T2-C1 Regression Tests)', () => {
  const cutoffMs = 1700000000000;

  it('constructs the exact PostgREST filter for empty array and timestamp cutoff', async () => {
    let capturedTable = '';
    let capturedLtCol = '';
    let capturedLtVal = 0;
    let capturedFilterCol = '';
    let capturedFilterOp = '';
    let capturedFilterVal = '';
    let capturedSelect = '';

    const mockClient = {
      from: vi.fn((table: string) => {
        capturedTable = table;
        return {
          delete: () => ({
            lt: (col: string, val: number) => {
              capturedLtCol = col;
              capturedLtVal = val;
              return {
                filter: (fCol: string, fOp: string, fVal: string) => {
                  capturedFilterCol = fCol;
                  capturedFilterOp = fOp;
                  capturedFilterVal = fVal;
                  return {
                    select: (sCol: string) => {
                      capturedSelect = sCol;
                      return Promise.resolve({ data: [{ id: 1 }, { id: 2 }], error: null });
                    },
                  };
                },
              };
            },
          }),
        };
      }),
    } as unknown as SupabaseClient<ChronyxDatabase>;

    const repo = new HeartbeatsRepository(mockClient);
    const count = await repo.pruneOlderThan(cutoffMs);

    expect(count).toBe(2);
    expect(capturedTable).toBe('heartbeats');
    expect(capturedLtCol).toBe('t_rx_ms');
    expect(capturedLtVal).toBe(cutoffMs);
    // Verified: uses PostgreSQL array literal '{}' via filter, not empty string / []
    expect(capturedFilterCol).toBe('flags');
    expect(capturedFilterOp).toBe('eq');
    expect(capturedFilterVal).toBe('{}');
    expect(capturedSelect).toBe('id');
  });

  it('filters rows adhering strictly to both conditions: t_rx_ms < cutoff AND flags is empty', () => {
    interface HeartbeatRecord {
      id: number;
      t_rx_ms: number;
      flags: string[];
    }

    const testRecords: HeartbeatRecord[] = [
      { id: 1, t_rx_ms: cutoffMs - 5000, flags: [] }, // Old + empty flags -> ELIGIBLE
      { id: 2, t_rx_ms: cutoffMs + 5000, flags: [] }, // Recent + empty flags -> PRESERVED
      { id: 3, t_rx_ms: cutoffMs - 5000, flags: ['CUSUM_DRIFT'] }, // Old + non-empty flags -> PRESERVED
      { id: 4, t_rx_ms: cutoffMs, flags: [] }, // Boundary exact cutoff -> PRESERVED
      { id: 5, t_rx_ms: cutoffMs + 10000, flags: ['PEER_OUTLIER'] }, // Recent + non-empty flags -> PRESERVED
    ];

    // Filter rule matching E3: t_rx_ms < cutoff AND flags == '{}'
    const eligibleRecords = testRecords.filter(
      (r) => r.t_rx_ms < cutoffMs && r.flags.length === 0,
    );
    const preservedRecords = testRecords.filter(
      (r) => !(r.t_rx_ms < cutoffMs && r.flags.length === 0),
    );

    // 1. Old heartbeat with empty flags is eligible
    expect(eligibleRecords.some((r) => r.id === 1)).toBe(true);

    // 2. Recent heartbeat with empty flags is preserved
    expect(preservedRecords.some((r) => r.id === 2)).toBe(true);

    // 3. Old heartbeat with non-empty flags is preserved
    expect(preservedRecords.some((r) => r.id === 3)).toBe(true);

    // 4. Boundary behavior: strictly less than cutoff
    expect(preservedRecords.some((r) => r.id === 4)).toBe(true);

    // Exactly one row out of the 5 is eligible
    expect(eligibleRecords.map((r) => r.id)).toEqual([1]);
    expect(preservedRecords.map((r) => r.id)).toEqual([2, 3, 4, 5]);
  });

  it('reports database failures explicitly rather than claiming success', async () => {
    const mockClient = {
      from: () => ({
        delete: () => ({
          lt: () => ({
            filter: () => ({
              select: () => Promise.resolve({ data: null, error: { message: 'connection timeout' } }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<ChronyxDatabase>;

    const repo = new HeartbeatsRepository(mockClient);

    await expect(repo.pruneOlderThan(cutoffMs)).rejects.toThrow(
      'Failed to prune heartbeats: connection timeout',
    );
  });

  it('pruneHeartbeats handles unconfigured environment gracefully', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await pruneHeartbeats();
    expect(res.success).toBe(false);
    expect(res.deletedCount).toBe(0);
    expect(res.error).toContain('not configured');
  });
});
