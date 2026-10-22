import { body, bad, ok } from '@/lib/api';
import { isAdminEmail, siteUrl, supabaseEnabled } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';
import { getInvite, inviteUsable } from '@/lib/invites';

/**
 * Send a sign-in link. New accounts are only created for a valid invite
 * or an admin email; everyone else must already be a member.
 */
export async function POST(req: Request) {
  if (!supabaseEnabled()) return bad('Sign-in is off in local mode.');
  const b = await body(req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('Enter a valid email address.');
  const code = typeof b.invite === 'string' ? b.invite : '';
  let canCreate = isAdminEmail(email);
  if (code) {
    const inv = await getInvite(code);
    if (!inviteUsable(inv, email)) return bad('This invite has expired, was used up, or is for a different email.');
    canCreate = true;
  }
  const supabase = await supabaseServer();
  const redirect = `${siteUrl(req.url)}/auth/callback${code ? `?invite=${encodeURIComponent(code)}` : ''}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: canCreate, emailRedirectTo: redirect } });
  if (error) {
    if (!canCreate) return bad('This email doesn’t have access yet. Ask the person who runs this Sparkles for an invite.', 403);
    return bad('Couldn’t send the email. Wait a minute and try again.', 429);
  }
  return ok();
}
