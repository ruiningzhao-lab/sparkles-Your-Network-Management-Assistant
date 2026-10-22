import { admin, ok } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/server';

export const DELETE = admin(async (_v, _req, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const { error } = await supabaseAdmin().from('invites').update({ revoked: true }).eq('code', code);
  if (error) throw error;
  return ok();
});
