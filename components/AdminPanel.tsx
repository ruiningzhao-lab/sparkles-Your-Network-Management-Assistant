'use client';

import { useEffect, useState } from 'react';

type Invite = { code: string; email: string | null; note: string | null; max_uses: number; uses: number; revoked: boolean; expires_at: string | null; created_at: string };
type Member = { user_id: string; email: string; is_admin: boolean; invite_code: string | null; created_at: string };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export default function AdminPanel() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(14);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function refresh() {
    const [a, b] = await Promise.all([fetch('/api/admin/invites').then((r) => r.json()), fetch('/api/admin/members').then((r) => r.json())]);
    setInvites(a.invites || []);
    setMembers(b.members || []);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, note, maxUses: uses, days }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(out.error || 'Couldn’t create the invite.');
    setLink(out.link);
    setEmail('');
    setNote('');
    refresh();
  }
  async function revoke(code: string) {
    await fetch('/api/admin/invites/' + code, { method: 'DELETE' });
    refresh();
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }
  const status = (i: Invite) =>
    i.revoked ? 'Revoked' : i.uses >= i.max_uses ? 'Used' : i.expires_at && new Date(i.expires_at) < new Date() ? 'Expired' : 'Active';

  return (
    <>
      <p className="sub">Create a link and send it however you like. People who open it sign in with their email and get their own private map.</p>
      <form className="form" onSubmit={create}>
        <div className="two">
          <label>
            Email <small>optional: only this person can use the link</small>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" />
          </label>
          <label>
            Note <small>for you</small>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pilot group, March meetup…" maxLength={200} />
          </label>
        </div>
        <div className="two">
          <label>
            How many people can use it
            <input type="number" min={1} max={500} value={uses} disabled={!!email} onChange={(e) => setUses(Number(e.target.value))} />
          </label>
          <label>
            Expires after (days, 0 = never)
            <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
        </div>
        <div className="btns" style={{ marginTop: 0 }}>
          <button className="btn go" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create invite link'}
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </form>
      {link && (
        <div className="newlink">
          <code>{link}</code>
          <button className="btn sm" onClick={() => copy(link)}>
            Copy
          </button>
        </div>
      )}

      <div className="h4" style={{ marginTop: 24 }}>
        Invites<span className="cnt">{invites.length}</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Link</th>
              <th>For</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr>
                <td colSpan={6}>No invites yet.</td>
              </tr>
            )}
            {invites.map((i) => (
              <tr key={i.code}>
                <td>
                  <code>{`${origin}/invite/${i.code}`}</code>
                </td>
                <td>{i.email || i.note || 'Anyone with the link'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {i.uses} / {i.max_uses}
                </td>
                <td>{fmt(i.expires_at)}</td>
                <td>{status(i)}</td>
                <td>
                  {status(i) === 'Active' && (
                    <>
                      <button className="btn sm" onClick={() => copy(`${origin}/invite/${i.code}`)}>
                        Copy
                      </button>{' '}
                      <button className="btn sm ghost" onClick={() => revoke(i.code)}>
                        Revoke
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="h4" style={{ marginTop: 24 }}>
        Members<span className="cnt">{members.length}</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Joined</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email}</td>
                <td>{fmt(m.created_at)}</td>
                <td>{m.is_admin ? 'Admin' : 'Member'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
