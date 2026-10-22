import { NextResponse } from 'next/server';
import { isAdminEmail, siteUrl } from '@/lib/config';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

/** Finish sign-in, then make sure the person is a member (invite or admin email). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = siteUrl(req.url);
  const code = url.searchParams.get('code');
  const invite = url.searchParams.get('invite') || '';
  const supabase = await supabaseServer();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${base}/login?error=link`);
  }
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.redirect(`${base}/login`);

  const admin = supabaseAdmin();
  const { data: existing } = await admin.from('members').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!existing) {
    const email = user.email || '';
    if (isAdminEmail(email)) {
      await admin.from('members').insert({ user_id: user.id, email, is_admin: true });
    } else if (invite) {
      const { data: okRedeem } = await admin.rpc('redeem_invite', { p_code: invite, p_user: user.id, p_email: email });
      if (!okRedeem) return NextResponse.redirect(`${base}/no-access?reason=invite`);
    } else {
      return NextResponse.redirect(`${base}/no-access`);
    }
  }
  return NextResponse.redirect(`${base}/`);
}
