import { isAdminEmail, LOCAL_USER_NAME, supabaseEnabled } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export type Viewer = {
  mode: 'local' | 'supabase';
  id: string;
  email: string;
  name: string;
  admin: boolean;
  member: boolean;
};

/** Who is making this request. null = not signed in (Supabase mode only). */
export async function getViewer(): Promise<Viewer | null> {
  if (!supabaseEnabled()) {
    return { mode: 'local', id: 'local', email: '', name: LOCAL_USER_NAME, admin: true, member: true };
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const { data: m } = await supabase.from('members').select('name,is_admin').eq('user_id', user.id).maybeSingle();
  const email = user.email || '';
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  return {
    mode: 'supabase',
    id: user.id,
    email,
    name: (m?.name as string) || (meta.full_name as string) || '',
    admin: Boolean(m?.is_admin) || isAdminEmail(email),
    member: Boolean(m),
  };
}

/** For API routes: a signed-in member, or a Response to return. */
export async function requireMember(): Promise<Viewer | Response> {
  const v = await getViewer();
  if (!v) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!v.member) return Response.json({ error: 'You need an invite to use Sparkles.' }, { status: 403 });
  return v;
}

export async function requireAdmin(): Promise<Viewer | Response> {
  const v = await requireMember();
  if (v instanceof Response) return v;
  if (!v.admin) return Response.json({ error: 'Only admins can do this.' }, { status: 403 });
  return v;
}
