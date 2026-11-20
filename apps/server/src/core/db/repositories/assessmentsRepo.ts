import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, AssessmentRow, AssessmentInsert } from '../schema.js';
import type { UUID } from '@chronyx/contracts';

export class AssessmentsRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async create(assessment: AssessmentInsert): Promise<AssessmentRow> {
    const { data, error } = await this.client
      .from('assessments')
      .insert(assessment)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create assessment: ${error?.message || 'No data returned'}`);
    }
    return data;
  }

  async listByNode(nodeId: UUID, limit = 300): Promise<AssessmentRow[]> {
    const { data, error } = await this.client
      .from('assessments')
      .select()
      .eq('node_id', nodeId)
      .order('t_ms', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list assessments for node ${nodeId}: ${error.message}`);
    }
    return data || [];
  }
}
