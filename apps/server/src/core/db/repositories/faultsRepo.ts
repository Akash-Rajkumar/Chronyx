import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, FaultRow, FaultInsert } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class FaultsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(fault: FaultInsert): Promise<FaultRow> {
    const { data, error } = await this.client
      .from('faults')
      .insert(fault)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create fault: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async findById(id: UUID): Promise<FaultRow | null> {
    const { data, error } = await this.client
      .from('faults')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find fault ${id}: ${error.message}`);
    }
    return data;
  }

  async listActive(): Promise<FaultRow[]> {
    const { data, error } = await this.client
      .from('faults')
      .select()
      .eq('status', 'active')
      .order('started_at_ms', { ascending: false });

    if (error) {
      throw new Error(`Failed to list active faults: ${error.message}`);
    }
    return data || [];
  }

  async listAll(): Promise<FaultRow[]> {
    const { data, error } = await this.client
      .from('faults')
      .select()
      .order('started_at_ms', { ascending: false });

    if (error) {
      throw new Error(`Failed to list faults: ${error.message}`);
    }
    return data || [];
  }

  async update(id: UUID, update: Partial<FaultInsert>): Promise<FaultRow> {
    const { data, error } = await this.client
      .from('faults')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update fault ${id}: ${error?.message || 'No data'}`);
    }
    return data;
  }
}
