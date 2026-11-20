import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, HeartbeatRow, HeartbeatInsert } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class HeartbeatsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(heartbeat: HeartbeatInsert): Promise<HeartbeatRow> {
    const { data, error } = await this.client
      .from('heartbeats')
      .insert(heartbeat)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create heartbeat: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async findByNodeAndSeq(nodeId: UUID, seq: number): Promise<HeartbeatRow | null> {
    const { data, error } = await this.client
      .from('heartbeats')
      .select()
      .eq('node_id', nodeId)
      .eq('seq', seq)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find heartbeat for node ${nodeId} seq ${seq}: ${error.message}`);
    }
    return data;
  }

  async listLatestByNode(nodeId: UUID, limit = 100): Promise<HeartbeatRow[]> {
    const { data, error } = await this.client
      .from('heartbeats')
      .select()
      .eq('node_id', nodeId)
      .order('seq', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list heartbeats for node ${nodeId}: ${error.message}`);
    }
    return data || [];
  }

  async pruneOlderThan(cutoffMs: number): Promise<number> {
    // E3: Deletes heartbeats older than 3 hours that have empty flags
    const { data, error } = await this.client
      .from('heartbeats')
      .delete()
      .lt('t_rx_ms', cutoffMs)
      .eq('flags', [])
      .select('id');

    if (error) {
      throw new Error(`Failed to prune heartbeats: ${error.message}`);
    }
    return data ? data.length : 0;
  }

  async deleteById(id: number): Promise<void> {
    const { error } = await this.client
      .from('heartbeats')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete heartbeat ${id}: ${error.message}`);
    }
  }
}
