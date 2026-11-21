import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, BenchmarkRunRow, BenchmarkRunInsert, Json } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class BenchmarkRunsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(run: BenchmarkRunInsert): Promise<BenchmarkRunRow> {
    const { data, error } = await this.client
      .from('benchmark_runs')
      .insert(run)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create benchmark run: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async findById(id: UUID): Promise<BenchmarkRunRow | null> {
    const { data, error } = await this.client
      .from('benchmark_runs')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find benchmark run ${id}: ${error.message}`);
    }
    return data;
  }

  async list(limit = 20): Promise<BenchmarkRunRow[]> {
    const { data, error } = await this.client
      .from('benchmark_runs')
      .select()
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list benchmark runs: ${error.message}`);
    }
    return data || [];
  }

  async updateProgress(
    id: UUID,
    progress: Record<string, unknown>,
    status?: BenchmarkRunRow['status'],
    results?: Record<string, unknown> | null,
  ): Promise<BenchmarkRunRow> {
    const update: Partial<BenchmarkRunInsert> = { progress: progress as unknown as Json };
    if (status) update.status = status;
    if (results !== undefined) update.results = results as unknown as Json | null;

    const { data, error } = await this.client
      .from('benchmark_runs')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update benchmark run ${id}: ${error?.message || 'No data'}`);
    }
    return data;
  }
}
