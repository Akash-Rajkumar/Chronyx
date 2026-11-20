import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, AnchorRow, AnchorInsert } from '../schema.js';

export class AnchorsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(anchor: AnchorInsert): Promise<AnchorRow> {
    const { data, error } = await this.client
      .from('anchors')
      .insert(anchor)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create anchor sample: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async listLatest(limit = 20): Promise<AnchorRow[]> {
    const { data, error } = await this.client
      .from('anchors')
      .select()
      .order('sampled_at_ms', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list anchor samples: ${error.message}`);
    }
    return data || [];
  }
}
