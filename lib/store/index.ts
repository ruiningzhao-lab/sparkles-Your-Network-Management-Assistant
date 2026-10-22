import type { Viewer } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { LocalStore } from './local';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

export async function storeFor(v: Viewer): Promise<Store> {
  if (v.mode === 'local') return new LocalStore(v.id);
  return new SupabaseStore(await supabaseServer(), v.id);
}
