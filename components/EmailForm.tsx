'use client';

import { useState } from 'react';

/** Email box that asks the server to send a sign-in link. */
export default function EmailForm({ invite, lockedEmail, cta }: { invite?: string; lockedEmail?: string | null; cta: string }) {
  const [email, setEmail] = useState(lockedEmail || '');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setError('');
    const res = await fetch('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, invite }) });
    const out = await res.json().catch(() => ({}));
    if (res.ok) setState('sent');
    else {
      setState('idle');
      setError(out.error || 'Something went wrong. Try again.');
    }
  }

  if (state === 'sent')
    return (
      <div className="okmsg">
        Check <b>{email}</b> for a sign-in link. You can close this tab; the link opens Sparkles.
      </div>
    );
  return (
    <form className="form" onSubmit={submit} style={{ marginTop: 0 }}>
      <label>
        Email
        <input id="email" type="email" required value={email} readOnly={!!lockedEmail} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <button className="btn go" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : cta}
      </button>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
