import { redirect } from 'next/navigation';
import EmailForm from '@/components/EmailForm';
import { APP_NAME, Star } from '@/components/Logo';
import { getViewer } from '@/lib/auth';
import { supabaseEnabled } from '@/lib/config';
import { getInvite, inviteUsable } from '@/lib/invites';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  if (!supabaseEnabled()) redirect('/');
  const { code } = await params;
  const v = await getViewer();
  if (v?.member) redirect('/');
  const inv = await getInvite(code);
  const usable = inviteUsable(inv);
  return (
    <main className="page">
      <div className="auth float">
        <div className="logo">
          <Star /> {APP_NAME}
        </div>
        {usable ? (
          <>
            <h1>You’re invited</h1>
            <p>{APP_NAME} puts your network on a map. Tell it what you want to do, and it finds the right people and suggests a small next step. Your people and notes stay private to you.</p>
            <EmailForm invite={code} lockedEmail={inv?.email} cta="Accept invite" />
          </>
        ) : (
          <>
            <h1>This invite can’t be used</h1>
            <p>It may have expired or already been used. Ask the person who sent it for a new link.</p>
            <a className="btn" href="/login">
              I already have an account
            </a>
          </>
        )}
      </div>
    </main>
  );
}
