import { redirect } from 'next/navigation';
import AdminPanel from '@/components/AdminPanel';
import { APP_NAME, Star } from '@/components/Logo';
import { getViewer } from '@/lib/auth';
import { supabaseEnabled } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function Admin() {
  const v = await getViewer();
  if (!v) redirect('/login');
  if (!v.member) redirect('/no-access');
  if (!v.admin) redirect('/');
  return (
    <main className="page">
      <div className="admin float">
        <div className="top2">
          <div className="auth" style={{ padding: 0, width: 'auto' }}>
            <div className="logo" style={{ marginBottom: 6 }}>
              <Star /> {APP_NAME}
            </div>
          </div>
          <a className="btn" href="/">
            ← Back to the map
          </a>
        </div>
        <h1>Invite people</h1>
        {supabaseEnabled() ? (
          <AdminPanel />
        ) : (
          <p className="sub">Invites need Supabase. Add the Supabase keys to .env.local and restart, then come back here.</p>
        )}
      </div>
    </main>
  );
}
