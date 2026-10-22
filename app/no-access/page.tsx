import { APP_NAME, Star } from '@/components/Logo';

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="page">
      <div className="auth float">
        <div className="logo">
          <Star /> {APP_NAME}
        </div>
        <h1>You need an invite</h1>
        <p>
          {reason === 'invite'
            ? 'That invite has expired, was already used, or was made for a different email.'
            : `${APP_NAME} is invite-only for now.`}{' '}
          Ask someone who uses it to send you an invite link.
        </p>
        <form action="/auth/signout" method="post">
          <button className="btn" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
