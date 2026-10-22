import type { Viewer } from '@/lib/auth';
import type { AgendaPrefs, Store } from '@/lib/store/types';
import { DemoSource, NoSource } from './demo';
import type { AgendaPayload, AgendaSource } from './types';

export const DEFAULT_EVERY = 45;
const REPLY_HOURS = 24;
const WAIT_DAYS = 5;

/** Demo data is automatic in local mode (until you exit it) and opt-in with Supabase. */
export function demoOn(viewer: Viewer, prefs: AgendaPrefs | undefined) {
  if (prefs?.demo !== undefined) return prefs.demo;
  return viewer.mode === 'local' || process.env.AGENDA_DEMO === '1';
}

// Real connectors (Google, Microsoft, notes) plug in here from P1 on.
function sourceFor(viewer: Viewer, prefs: AgendaPrefs | undefined): AgendaSource {
  return demoOn(viewer, prefs) ? new DemoSource() : NoSource;
}

export async function loadAgenda(store: Store, viewer: Viewer, now: Date, tzOffset: number): Promise<AgendaPayload> {
  const [{ profile, people }, notes, followUps] = await Promise.all([store.load(), store.listNotes(), store.listFollowUps()]);
  const prefs = profile?.agenda;
  const src = sourceFor(viewer, prefs);
  const data = await src.fetch({ people, home: profile?.home || null, now, tzOffset });
  const acts = src.kind === 'demo' ? prefs?.acts || {} : {};
  const live = (id: string) => {
    const a = acts[id];
    return !a || (a.s === 'snoozed' && a.until && new Date(a.until) <= now);
  };
  const ids = new Set(people.map((p) => p.id));
  return {
    events: data.events.map((e) => (acts[e.id]?.s === 'captured' ? { ...e, captured: true } : e)) as AgendaPayload['events'],
    threads: data.threads.filter((x) => live(x.id)),
    suggested: data.suggested.filter((x) => live('demo-sg-' + x.email) && !people.some((p) => p.email && p.email.toLowerCase() === x.email)),
    followUps: [
      ...followUps,
      ...data.followUps
        .filter((f) => ids.has(f.personId))
        .map((f) => {
          const a = acts[f.id];
          return a?.s === 'done' ? { ...f, status: 'done' as const } : a?.s === 'snoozed' ? { ...f, status: 'snoozed' as const, until: a.until } : f;
        }),
    ],
    notes: [...notes, ...data.notes.filter((n) => n.people.some((id) => ids.has(id)))].sort((a, b) => b.at.localeCompare(a.at)),
    updatedAt: now.toISOString(),
    demo: src.kind === 'demo',
    canDemo: true,
    connected: false,
    defaultEvery: DEFAULT_EVERY,
    replyHours: prefs?.replyHours || REPLY_HOURS,
    waitDays: prefs?.waitDays || WAIT_DAYS,
  };
}
