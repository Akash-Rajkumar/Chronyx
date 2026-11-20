import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, IncidentRow, IncidentInsert } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class IncidentsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(incident: IncidentInsert): Promise<IncidentRow> {
    const { data, error } = await this.client
      .from('incidents')
      .insert(incident)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create incident: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async findById(id: UUID): Promise<IncidentRow | null> {
    const { data, error } = await this.client
      .from('incidents')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find incident ${id}: ${error.message}`);
    }
    return data;
  }

  async listByStatus(status: 'open' | 'closed' | 'all' = 'all', limit = 50): Promise<IncidentRow[]> {
    let query = this.client
      .from('incidents')
      .select()
      .order('opened_at_ms', { ascending: false })
      .limit(limit);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list incidents: ${error.message}`);
    }
    return data || [];
  }

  async update(id: UUID, update: Partial<IncidentInsert>): Promise<IncidentRow> {
    const { data, error } = await this.client
      .from('incidents')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update incident ${id}: ${error?.message || 'No data'}`);
    }
    return data;
  }
}
