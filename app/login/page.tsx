import { redirect } from 'next/navigation';
import EmailForm from '@/components/EmailForm';
import { APP_NAME, Star } from '@/components/Logo';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await getViewer();
  if (v?.member) redirect('/');
  const { error } = await searchParams;
  return (
    <main className="page">
      <div className="auth float">
        <div className="logo">
          <Star /> {APP_NAME}
        </div>
        <h1>Sign in</h1>
        <p>We’ll email you a link. New here? You need an invite link from someone who uses {APP_NAME}.</p>
        {error === 'link' && <p className="err">That sign-in link expired or was already used. Send a new one.</p>}
        <EmailForm cta="Email me a link" />
      </div>
    </main>
  );
}
