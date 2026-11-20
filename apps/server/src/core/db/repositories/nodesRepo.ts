import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, NodeRow, NodeInsert } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class NodesRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(node: NodeInsert): Promise<NodeRow> {
    const { data, error } = await this.client
      .from('nodes')
      .insert(node)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create node: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async findById(id: UUID): Promise<NodeRow | null> {
    const { data, error } = await this.client
      .from('nodes')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find node ${id}: ${error.message}`);
    }
    return data;
  }

  async findByPublicKey(publicKey: string): Promise<NodeRow | null> {
    const { data, error } = await this.client
      .from('nodes')
      .select()
      .eq('public_key', publicKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find node by public key: ${error.message}`);
    }
    return data;
  }

  async listAll(): Promise<NodeRow[]> {
    const { data, error } = await this.client
      .from('nodes')
      .select()
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list nodes: ${error.message}`);
    }
    return data || [];
  }

  async updateLastSeen(id: UUID, lastSeenAt: string): Promise<void> {
    const { error } = await this.client
      .from('nodes')
      .update({ last_seen_at: lastSeenAt })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update last_seen for node ${id}: ${error.message}`);
    }
  }

  async deleteById(id: UUID): Promise<void> {
    const { error } = await this.client
      .from('nodes')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete node ${id}: ${error.message}`);
    }
  }
}

