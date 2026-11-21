import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, TransitionRow, TransitionInsert } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class TransitionsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(transition: TransitionInsert): Promise<TransitionRow> {
    const { data, error } = await this.client
      .from('transitions')
      .insert(transition)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create transition: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async listByNode(nodeId: UUID, limit = 100): Promise<TransitionRow[]> {
    const { data, error } = await this.client
      .from('transitions')
      .select()
      .eq('node_id', nodeId)
      .order('at_ms', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list transitions for node ${nodeId}: ${error.message}`);
    }
    return data || [];
  }
}

