import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase } from './schema.js';
import { NodesRepository } from './repositories/nodesRepo.js';
import { HeartbeatsRepository } from './repositories/heartbeatsRepo.js';
import { AssessmentsRepository } from './repositories/assessmentsRepo.js';
import { TransitionsRepository } from './repositories/transitionsRepo.js';
import { IncidentsRepository } from './repositories/incidentsRepo.js';
import { FaultsRepository } from './repositories/faultsRepo.js';
import { ObservationsRepository } from './repositories/observationsRepo.js';
import { BenchmarkRunsRepository } from './repositories/benchmarkRunsRepo.js';
import { AnchorsRepository } from './repositories/anchorsRepo.js';
import { ConfigRepository } from './repositories/configRepo.js';
import { getDbClient, isDbConfigured } from './client.js';

export * from './schema.js';
export * from './client.js';
export * from './prune.js';
export * from './repositories/nodesRepo.js';
export * from './repositories/heartbeatsRepo.js';
export * from './repositories/assessmentsRepo.js';
export * from './repositories/transitionsRepo.js';
export * from './repositories/incidentsRepo.js';
export * from './repositories/faultsRepo.js';
export * from './repositories/observationsRepo.js';
export * from './repositories/benchmarkRunsRepo.js';
export * from './repositories/anchorsRepo.js';
export * from './repositories/configRepo.js';

export interface DatabaseRepositories {
  nodes: NodesRepository;
  heartbeats: HeartbeatsRepository;
  assessments: AssessmentsRepository;
  transitions: TransitionsRepository;
  incidents: IncidentsRepository;
  faults: FaultsRepository;
  observations: ObservationsRepository;
  benchmarkRuns: BenchmarkRunsRepository;
  anchors: AnchorsRepository;
  config: ConfigRepository;
}

export function createRepositories(client: SupabaseClient<ChronyxDatabase>): DatabaseRepositories {
  return {
    nodes: new NodesRepository(client),
    heartbeats: new HeartbeatsRepository(client),
    assessments: new AssessmentsRepository(client),
    transitions: new TransitionsRepository(client),
    incidents: new IncidentsRepository(client),
    faults: new FaultsRepository(client),
    observations: new ObservationsRepository(client),
    benchmarkRuns: new BenchmarkRunsRepository(client),
    anchors: new AnchorsRepository(client),
    config: new ConfigRepository(client),
  };
}

export function getRepositories(): DatabaseRepositories | null {
  const client = getDbClient();
  if (!client) {
    return null;
  }
  return createRepositories(client);
}

export { isDbConfigured };
