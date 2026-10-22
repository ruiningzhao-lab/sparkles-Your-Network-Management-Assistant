import { admin, bad, body, ok } from '@/lib/api';
import { siteUrl } from '@/lib/config';
import { newCode } from '@/lib/invites';
import { supabaseAdmin } from '@/lib/supabase/server';

export const GET = admin(async () => {
  const { data, error } = await supabaseAdmin().from('invites').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return ok({ invites: data });
});

/** Create an invite link. Optional: lock it to one email, allow several uses, expire it. */
export const POST = admin(async (viewer, req) => {
  const b = await body(req);
  const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('That email doesn’t look right.');
  const maxUses = Math.max(1, Math.min(500, Number(b.maxUses) || 1));
  const days = Math.max(0, Math.min(365, Number(b.days) || 0));
  const row = {
    code: newCode(),
    created_by: viewer.id,
    email,
    note: typeof b.note === 'string' ? b.note.trim().slice(0, 200) || null : null,
    max_uses: email ? 1 : maxUses,
    expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null,
  };
  const { data, error } = await supabaseAdmin().from('invites').insert(row).select('*').single();
  if (error) throw error;
  return ok({ invite: data, link: `${siteUrl(req.url)}/invite/${row.code}` });
});
