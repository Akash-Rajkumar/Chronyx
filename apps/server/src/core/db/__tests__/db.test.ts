// TEST-FIXTURE
import { describe, it, expect } from 'vitest';
import {
  createRepositories,
  isDbConfigured,
  NodesRepository,
  HeartbeatsRepository,
  AssessmentsRepository,
  TransitionsRepository,
  IncidentsRepository,
  FaultsRepository,
  ObservationsRepository,
  BenchmarkRunsRepository,
  AnchorsRepository,
  ConfigRepository,
} from '../index.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase } from '../schema.js';

describe('apps/server/src/core/db repository layer unit tests', () => {
  it('isDbConfigured returns false when environment variables are missing or default', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isDbConfigured()).toBe(false);
  });

  it('createRepositories instantiates all 10 typed repositories', () => {
    // Mock SupabaseClient instance structure for pure repository instantiation check
    const mockClient = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {}, error: null }) }) }),
      }),
    } as unknown as SupabaseClient<ChronyxDatabase>;

    const repos = createRepositories(mockClient);

    expect(repos.nodes).toBeInstanceOf(NodesRepository);
    expect(repos.heartbeats).toBeInstanceOf(HeartbeatsRepository);
    expect(repos.assessments).toBeInstanceOf(AssessmentsRepository);
    expect(repos.transitions).toBeInstanceOf(TransitionsRepository);
    expect(repos.incidents).toBeInstanceOf(IncidentsRepository);
    expect(repos.faults).toBeInstanceOf(FaultsRepository);
    expect(repos.observations).toBeInstanceOf(ObservationsRepository);
    expect(repos.benchmarkRuns).toBeInstanceOf(BenchmarkRunsRepository);
    expect(repos.anchors).toBeInstanceOf(AnchorsRepository);
    expect(repos.config).toBeInstanceOf(ConfigRepository);
  });
});

