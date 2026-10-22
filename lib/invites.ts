import { supabaseAdmin } from '@/lib/supabase/server';

export type Invite = {
  code: string;
  email: string | null;
  note: string | null;
  max_uses: number;
  uses: number;
  revoked: boolean;
  expires_at: string | null;
  created_at: string;
};

export function inviteUsable(inv: Invite | null, email?: string) {
  if (!inv || inv.revoked) return false;
  if (inv.uses >= inv.max_uses) return false;
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return false;
  if (inv.email && email && inv.email.toLowerCase() !== email.toLowerCase()) return false;
  return true;
}

export async function getInvite(code: string): Promise<Invite | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return null;
  const { data } = await supabaseAdmin().from('invites').select('*').eq('code', code).maybeSingle();
  return (data as Invite) || null;
}

export function newCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
