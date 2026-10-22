import type { FollowUp, Note, Person } from '@/lib/store/types';
import type { AgendaEvent, AgendaPayload, Suggested, Thread } from './types';

// Turns agenda data into the Today modules. Pure, so it runs in the browser (instant
// updates after done/snooze) and in tests against fixtures.

const HOUR = 3_600_000, DAY = 24 * HOUR;
const AFTER_WINDOW = 4 * HOUR;

export type LastTouch = { at: string; kind: 'talked' | 'meeting' | 'email' | 'note' };
export type LensKind = 'meet' | 'reply' | 'due';
export type Brief = { event: AgendaEvent; personId?: string; lastNote?: Note; lastThread?: Thread; open: FollowUp[] };
export type Trip = { event: AgendaEvent; ck: string; city: string; people: string[] };
export type TodayModules = {
  meetings: AgendaEvent[];
  next: AgendaEvent | null;
  brief: Brief | null;
  after: AgendaEvent | null;
  needsReply: Thread[];
  waiting: Thread[];
  due: FollowUp[];
  coming: { day: number; events: AgendaEvent[] }[];
  trips: Trip[];
  reconnect: { id: string; days: number; kind: LastTouch['kind'] }[];
  suggested: Suggested[];
  notes: Note[];
  lens: Record<string, LensKind>;
  last: Record<string, LastTouch>;
};

const ms = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const hasOthers = (e: AgendaEvent) => e.people.length > 0 || (e.guests || []).length > 0;

/** An open follow-up that should show today: overdue, due today, or back from snooze. */
export function isDue(f: FollowUp, now: number) {
  if (f.status === 'done') return false;
  if (f.status === 'snoozed') return !!f.until && ms(f.until) <= now;
  return !f.due || ms(f.due) < startOfDay(now) + DAY;
}

export function lastTouches(a: AgendaPayload, people: Person[], now: number) {
  const last: Record<string, LastTouch> = {};
  const touch = (id: string, iso: string | undefined, kind: LastTouch['kind']) => {
    const t = ms(iso);
    if (!Number.isFinite(t) || t > now) return;
    if (!last[id] || ms(last[id].at) < t) last[id] = { at: new Date(t).toISOString(), kind };
  };
  for (const p of people) touch(p.id, p.last, 'talked');
  for (const e of a.events) if (!e.allDay) for (const id of e.people) touch(id, e.end, 'meeting');
  for (const t of a.threads) for (const id of t.people) touch(id, t.lastAt, 'email');
  for (const n of a.notes) for (const id of n.people) touch(id, n.at, 'note');
  return last;
}

export function buildToday(a: AgendaPayload, people: Person[], now = Date.now()): TodayModules {
  const ids = new Set(people.map((p) => p.id));
  const known = <T extends { people: string[] }>(x: T) => ({ ...x, people: x.people.filter((id) => ids.has(id)) });
  const events = a.events.map(known);
  const threads = a.threads.map(known).filter((t) => t.people.length || (t.guests || []).length);
  const sod = startOfDay(now), eod = sod + DAY;

  const meetings = events.filter((e) => !e.allDay && hasOthers(e) && ms(e.start) >= sod && ms(e.start) < eod).sort((x, y) => ms(x.start) - ms(y.start));
  const next = meetings.find((e) => ms(e.end) > now) || null;
  const captured = new Set(a.notes.map((n) => n.eventId).filter(Boolean));
  const after = [...meetings].reverse().find((e) => ms(e.end) <= now && now - ms(e.end) < AFTER_WINDOW && !e.captured && !captured.has(e.id) && e.people.length) || null;

  const open = a.followUps.filter((f) => f.status !== 'done' && ids.has(f.personId));
  let brief: Brief | null = null;
  if (next) {
    const pid = next.people[0];
    brief = {
      event: next,
      personId: pid,
      lastNote: pid ? a.notes.find((n) => n.people.includes(pid)) : undefined,
      lastThread: pid ? [...threads].filter((t) => t.people.includes(pid)).sort((x, y) => ms(y.lastAt) - ms(x.lastAt))[0] : undefined,
      open: pid ? open.filter((f) => f.personId === pid) : [],
    };
  }

  const needsReply = threads.filter((t) => t.awaiting === 'me' && now - ms(t.lastInboundAt || t.lastAt) > a.replyHours * HOUR).sort((x, y) => ms(x.lastAt) - ms(y.lastAt));
  const waiting = threads.filter((t) => t.awaiting === 'them' && now - ms(t.lastOutboundAt || t.lastAt) > a.waitDays * DAY).sort((x, y) => ms(x.lastAt) - ms(y.lastAt));
  const due = open.filter((f) => isDue(f, now)).sort((x, y) => (ms(x.due) || 0) - (ms(y.due) || 0));

  const week = events.filter((e) => ms(e.start) >= eod && ms(e.start) < sod + 8 * DAY).sort((x, y) => ms(x.start) - ms(y.start));
  const days = new Map<number, AgendaEvent[]>();
  for (const e of week.filter((e) => !e.allDay && hasOthers(e))) {
    const d = startOfDay(ms(e.start));
    days.set(d, [...(days.get(d) || []), e]);
  }
  const coming = [...days.entries()].map(([day, evs]) => ({ day, events: evs }));
  const trips: Trip[] = events
    .filter((e) => e.ck && e.city && ms(e.end) > now && ms(e.start) < sod + 8 * DAY && (e.allDay || /\btrip\b|flight|✈/i.test(e.title)))
    .map((e) => ({ event: e, ck: e.ck!, city: e.city!, people: people.filter((p) => p.ck === e.ck).map((p) => p.id) }))
    .filter((t) => t.people.length);

  const last = lastTouches({ ...a, events, threads }, people, now);
  const soon = new Set([...meetings, ...week].flatMap((e) => e.people));
  const reconnect = people
    .filter((p) => p.every !== 0 && last[p.id] && !soon.has(p.id))
    .map((p) => ({ id: p.id, days: Math.floor((now - ms(last[p.id].at)) / DAY), kind: last[p.id].kind, every: p.every || a.defaultEvery }))
    .filter((r) => r.days >= r.every)
    .sort((x, y) => y.days / y.every - x.days / x.every)
    .map(({ every, ...r }) => r);

  const lens: Record<string, LensKind> = {};
  for (const f of due) lens[f.personId] = 'due';
  for (const t of needsReply) for (const id of t.people) lens[id] = 'reply';
  for (const e of meetings) for (const id of e.people) lens[id] = 'meet';

  return {
    meetings,
    next,
    brief,
    after,
    needsReply,
    waiting,
    due,
    coming,
    trips,
    reconnect,
    suggested: a.suggested,
    notes: a.notes.filter((n) => n.people.some((id) => ids.has(id))).slice(0, 4),
    lens,
    last,
  };
}
