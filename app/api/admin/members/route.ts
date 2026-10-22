import { admin, ok } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/server';

export const GET = admin(async () => {
  const { data, error } = await supabaseAdmin().from('members').select('user_id,email,name,is_admin,invite_code,created_at').order('created_at', { ascending: false });
  if (error) throw error;
  return ok({ members: data });
});
