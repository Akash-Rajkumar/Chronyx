import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, ObservationRow, ObservationInsert } from '../schema.js';
import type { UUID, ObservationStatus } from '@chronyx/contracts';

export class ObservationsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(observation: ObservationInsert): Promise<ObservationRow> {
    const { data, error } = await this.client
      .from('observations')
      .insert(observation)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create observation: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async findById(id: UUID): Promise<ObservationRow | null> {
    const { data, error } = await this.client
      .from('observations')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find observation ${id}: ${error.message}`);
    }
    return data;
  }

  async list(filter?: { nodeId?: UUID; status?: ObservationStatus; limit?: number }): Promise<ObservationRow[]> {
    let query = this.client
      .from('observations')
      .select()
      .order('observed_at_ms', { ascending: false })
      .limit(filter?.limit ?? 100);

    if (filter?.nodeId) {
      query = query.eq('node_id', filter.nodeId);
    }
    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list observations: ${error.message}`);
    }
    return data || [];
  }

  async updateStatus(id: UUID, status: ObservationStatus, confidence?: number): Promise<ObservationRow> {
    const update: Partial<ObservationInsert> = { status };
    if (confidence !== undefined) {
      update.confidence = confidence;
    }

    const { data, error } = await this.client
      .from('observations')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update observation ${id}: ${error?.message || 'No data'}`);
    }
    return data;
  }

  async clearAll(): Promise<void> {
    const { error } = await this.client
      .from('observations')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      throw new Error(`Failed to clear observations: ${error.message}`);
    }
  }
}

