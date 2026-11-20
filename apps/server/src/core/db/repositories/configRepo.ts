import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase, Json } from '../schema.js';

export class ConfigRepository {
  constructor(private readonly client: SupabaseClient<ChronyxDatabase>) {}

  async get<T extends Record<string, unknown>>(key: string): Promise<T | null> {
    const { data, error } = await this.client
      .from('config')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get config key ${key}: ${error.message}`);
    }
    return (data?.value as T) ?? null;
  }

  async set<T extends Record<string, unknown>>(key: string, value: T): Promise<void> {
    const { error } = await this.client
      .from('config')
      .upsert({ key, value: value as unknown as Json });

    if (error) {
      throw new Error(`Failed to set config key ${key}: ${error.message}`);
    }
  }
}
