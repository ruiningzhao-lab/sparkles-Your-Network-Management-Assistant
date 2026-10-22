import { samplePeople } from '@/lib/demo/network';
import type { FollowUp, Note, Person } from '@/lib/store/types';
import { cleanDescription } from './clean';
import type { AgendaData, AgendaEvent, AgendaSource, Guest, SourceContext, Suggested, Thread } from './types';

// Demo mode: a believable day generated around the user's own people, relative to now.
// Nothing here is stored. The same seed and people always give the same script.

const SEED = 20261022;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cast = { id?: string; n: string; ck?: string; city?: string; tz?: string; topic: string; company?: string; email?: string };

const first = (c: Cast) => c.n.split(' ')[0];
const topicOf = (p: Person) => (p.tags && p.tags[0]) || (p.doing ? p.doing.replace(/\.$/, '').toLowerCase() : '') || (p.company ? p.company : 'what you’re working on');

function castFrom(people: Person[], home: string | undefined, rand: () => number): { cast: Cast[]; real: boolean } {
  const named = people.filter((p) => p.n && p.n.trim());
  const real = named.length >= 5;
  const pool = (real ? named : samplePeople()).slice().sort((a, b) => a.id.localeCompare(b.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Placed people first, and someone local first of all, so the coffee is in your city.
  pool.sort((a, b) => Number(b.lat != null) - Number(a.lat != null));
  const local = pool.findIndex((p) => home && p.ck === home);
  if (local > 0) pool.unshift(...pool.splice(local, 1));
  const cast = pool.map((p) => ({ id: real ? p.id : undefined, n: p.n, ck: p.ck, city: p.city, tz: p.tz, topic: topicOf(p), company: p.company, email: p.email }));
  return { cast, real };
}

const at = (ms: number) => new Date(ms).toISOString();

/** Minutes a time zone is ahead of UTC at a moment. */
function tzAhead(tz: string | undefined, t: number) {
  if (!tz) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - Math.floor(t / MIN) * MIN) / MIN);
  } catch {
    return null;
  }
}
/** `hour` o'clock in `tz` on the viewer's calendar day that starts at `day`. */
function zoned(day: number, tzOffset: number, hour: number, tz?: string) {
  const ahead = tzAhead(tz, day + 12 * HOUR);
  if (ahead === null) return day + hour * HOUR;
  const d = new Date(day - tzOffset * MIN + 12 * HOUR);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour) - ahead * MIN;
}
/** A call time on `day` that is daytime for both you and them, if there is one. */
function callTime(day: number, tzOffset: number, tz?: string) {
  for (const h of [10, 9, 11, 8, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
    const t = day + h * HOUR;
    const ahead = tzAhead(tz, t);
    if (ahead === null) return t;
    const theirs = (((h * 60 - -tzOffset + ahead) / 60) % 24 + 24) % 24;
    if (theirs >= 8 && theirs <= 20) return t;
  }
  return day + 10 * HOUR;
}
const q15 = (ms: number, up = false) => (up ? Math.ceil : Math.floor)(ms / (15 * MIN)) * 15 * MIN;

export class DemoSource implements AgendaSource {
  kind = 'demo' as const;

  async fetch({ people, home, now, tzOffset }: SourceContext): Promise<AgendaData> {
    const rand = rng(SEED);
    const { cast, real } = castFrom(people, home?.ck, rand);
    const c = (i: number) => cast[i % cast.length];
    const t = now.getTime();
    // Midnight today in the viewer's time zone.
    const local = t - tzOffset * MIN;
    const dayStart = local - (local % DAY) + tzOffset * MIN;
    const ref = (x: Cast) => (x.id ? { people: [x.id] } : { people: [] as string[], guests: [{ name: x.n, email: x.email } as Guest] });
    const refs = (xs: Cast[]) => {
      const ids = xs.filter((x) => x.id).map((x) => x.id!);
      const guests = xs.filter((x) => !x.id).map((x) => ({ name: x.n, email: x.email }));
      return guests.length ? { people: ids, guests } : { people: ids };
    };

    const ended = q15(t - 70 * MIN);
    const next = q15(t + 25 * MIN, true);
    const later = next + 3 * HOUR;
    const remote = cast.findIndex((x, i) => i > 0 && x.tz && x.ck !== home?.ck);
    const r = remote > 0 ? cast[remote] : c(1);
    const order = [c(0), r, ...cast.filter((x) => x !== c(0) && x !== r)];
    const o = (i: number) => order[i % order.length];

    const messy = `<p>Agenda:</p><ul><li>Catch up on ${o(1).topic}</li><li>${first(o(1))}’s plans${o(1).company ? ' at ' + o(1).company : ''} for next quarter</li></ul>
<p>Shared notes: <a href="https://docs.google.com/document/d/sparkles-demo">running doc</a></p>
<p>────────────────────</p><p>Join Zoom Meeting<br>https://us02web.zoom.us/j/81234567890?pwd=SparklesDemo</p>
<p>Meeting ID: 812 3456 7890<br>Passcode: 424242</p><p>One tap mobile<br>+16699006833,,81234567890# US (San Jose)</p>
<p>Dial by your location<br>+1 646 558 8656 US (New York)</p>`;
    const desc = cleanDescription(messy);

    const events: AgendaEvent[] = [
      { id: 'demo-ev-past2', title: `Lunch with ${first(o(5))}`, start: at(dayStart - 12 * DAY + 12.5 * HOUR), end: at(dayStart - 12 * DAY + 13.5 * HOUR), ...ref(o(5)), demo: true },
      { id: 'demo-ev-past1', title: `${first(o(4))} / you`, start: at(dayStart - 6 * DAY + 16 * HOUR), end: at(dayStart - 6 * DAY + 16.5 * HOUR), ...ref(o(4)), demo: true },
      { id: 'demo-ev-ended', title: `Coffee with ${first(o(0))}`, start: at(ended), end: at(ended + 45 * MIN), location: o(0).city, ck: o(0).ck, city: o(0).city, ...ref(o(0)), demo: true },
      {
        id: 'demo-ev-next',
        title: `Call with ${first(o(1))}`,
        start: at(next),
        end: at(next + 30 * MIN),
        joinUrl: desc.joinUrl,
        description: desc.text,
        links: desc.links,
        ...ref(o(1)),
        demo: true,
      },
      { id: 'demo-ev-later', title: `${o(2).topic.replace(/^./, (s) => s.toUpperCase())} catch-up`, start: at(later), end: at(later + HOUR), description: cleanDescription(`Bring ideas about ${o(2).topic}.<br><br>--<br>Sent from my iPhone`).text, ...refs([o(2), o(3)]), demo: true },
      { id: 'demo-ev-d1', title: `Intro call: ${first(o(4))}`, start: at(callTime(dayStart + DAY, tzOffset, o(4).tz)), end: at(callTime(dayStart + DAY, tzOffset, o(4).tz) + 30 * MIN), ...ref(o(4)), demo: true },
      { id: 'demo-ev-d5', title: `Call with ${first(o(5))}`, start: at(callTime(dayStart + 5 * DAY, tzOffset, o(5).tz)), end: at(callTime(dayStart + 5 * DAY, tzOffset, o(5).tz) + 45 * MIN), ...ref(o(5)), demo: true },
    ];

    // A trip to the city (other than home) where you know the most people.
    if (real) {
      const counts = new Map<string, Person[]>();
      for (const p of people) if (p.ck && p.ck !== home?.ck) counts.set(p.ck, [...(counts.get(p.ck) || []), p]);
      const best = [...counts.values()].sort((a, b) => b.length - a.length || a[0].ck!.localeCompare(b[0].ck!))[0];
      if (best && best.length >= 3) {
        const city = best[0].city!;
        events.push({ id: 'demo-ev-trip', title: `Trip to ${city}`, start: at(dayStart + 2 * DAY), end: at(dayStart + 5 * DAY), allDay: true, location: city, ck: best[0].ck, city, people: [], demo: true });
        const mtg = zoned(dayStart + 3 * DAY, tzOffset, 10, best[0].tz);
        events.push({ id: 'demo-ev-trip-mtg', title: `Coffee with ${best[0].n.split(' ')[0]} in ${city}`, start: at(mtg), end: at(mtg + HOUR), location: city, ck: best[0].ck, city, people: [best[0].id], demo: true });
      }
    }

    const thread = (id: string, x: Cast, subject: string, ago: number, awaiting: 'me' | 'them'): Thread => ({
      id,
      subject,
      ...ref(x),
      lastAt: at(t - ago),
      ...(awaiting === 'me' ? { lastInboundAt: at(t - ago) } : { lastOutboundAt: at(t - ago) }),
      awaiting,
      demo: true,
    });
    const threads: Thread[] = [
      thread('demo-th-1', o(6), `Intro to ${first(o(9))}?`, 3 * DAY + 2 * HOUR, 'me'),
      thread('demo-th-2', o(7), `Quick question about ${o(7).topic}`, 30 * HOUR, 'me'),
      thread('demo-th-3', o(8), 'Photos from the weekend', 5 * DAY, 'me'),
      thread('demo-th-4', o(9), `Re: ${o(9).topic} next steps`, 6 * DAY + 3 * HOUR, 'them'),
      thread('demo-th-5', o(10), 'Following up on our chat', 9 * DAY, 'them'),
    ];

    const fu = (id: string, x: Cast, title: string, due: number, origin: FollowUp['origin'], eventId?: string): FollowUp | null =>
      x.id ? { id, personId: x.id, title, due: at(due), status: 'open', origin, eventId, created: at(t - 3 * DAY), demo: true } : null;
    const followUps = [
      fu('demo-fu-1', o(1), `Send ${first(o(1))} the deck you mentioned`, dayStart - 2 * DAY + 17 * HOUR, 'meeting', 'demo-ev-past1'),
      fu('demo-fu-2', o(11), `Send ${first(o(11))} that ${o(11).topic} recommendation`, dayStart + 17 * HOUR, 'manual'),
      fu('demo-fu-3', o(4), `Ask ${first(o(4))} how the launch went`, dayStart + 4 * DAY + 10 * HOUR, 'manual'),
    ].filter(Boolean) as FollowUp[];

    const note = (id: string, x: Cast, body: string, ago: number, eventId?: string): Note | null =>
      x.id ? { id, body, people: [x.id], eventId, source: 'sparkles', at: at(t - ago), demo: true } : null;
    const notes = [
      note('demo-no-1', o(4), `Talked about ${o(4).topic}. Wants an intro to someone who has done this before.`, 6 * DAY - 16 * HOUR, 'demo-ev-past1'),
      note('demo-no-2', o(1), `${first(o(1))} is thinking about what’s next${o(1).company ? ' after ' + o(1).company : ''}. Promised to send the deck.`, 9 * DAY),
      note('demo-no-3', o(5), `Great lunch. ${first(o(5))} recommended a book on ${o(5).topic}.`, 12 * DAY - 14 * HOUR, 'demo-ev-past2'),
    ].filter(Boolean) as Note[];

    const suggested: Suggested[] = [
      { email: 'priya.natarajan@example.com', name: 'Priya Natarajan', meetings: 2, threads: 1, lastAt: at(t - 4 * DAY), demo: true },
      { email: 'tomas@example.org', name: 'Tomás Ortega', meetings: 0, threads: 3, lastAt: at(t - 2 * DAY), demo: true },
    ];

    return { events, threads, notes, followUps, suggested };
  }
}

export const NoSource: AgendaSource = {
  kind: 'none',
  fetch: async () => ({ events: [], threads: [], notes: [], followUps: [], suggested: [] }),
};
