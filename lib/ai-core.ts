import { makePlace } from '@/lib/geo';
import type { Circle, Discover, MapDoc, Person, Place, Plan } from '@/lib/store/types';

// Everything Sparkles asks the AI, with no dependency on where it runs.
// The server plugs in the Anthropic SDK (lib/ai.ts); the claude.ai build plugs in
// the artifact's Claude access. Each function has a plain fallback if the AI fails.

export type Ask = (prompt: string, opts: { tier: 'main' | 'quick'; maxTokens: number; signal?: AbortSignal }) => Promise<string>;
let askImpl: Ask | null = null;
export function configureAI(fn: Ask | null) {
  askImpl = fn;
}
export const aiEnabled = () => Boolean(askImpl);

export const ICONS = ['☕', '▶', '★', '◐', '♫', '☎', '✉', '↗', '→', '◆', '◎', '↻', '✈', '♪', '⇄', '◉'];

async function ask(prompt: string, opts: { tier: 'main' | 'quick'; maxTokens: number; signal?: AbortSignal }) {
  if (!askImpl) throw new Error('ai_disabled');
  return (await askImpl(prompt, opts)).trim();
}

function parseJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('invalid_json');
  return JSON.parse(text.slice(start, end + 1));
}

export function todayIn(tz?: string) {
  try {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz || undefined });
  } catch {
    return new Date().toDateString();
  }
}

function ago(iso?: string) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 864e5;
  if (isNaN(d)) return '';
  if (d < 14) return Math.max(0, Math.round(d)) + ' days';
  if (d < 60) return Math.round(d / 7) + ' weeks';
  if (d < 365) return Math.round(d / 30) + ' months';
  return Math.round(d / 365) + ' years';
}

export function personLine(p: Person, circles: Circle[] = []) {
  return [
    p.id,
    p.n,
    circles.find((c) => c.id === p.m)?.label || 'no circle',
    p.city ? `${p.city}${p.country ? ', ' + p.country : ''}` : 'city unknown',
    [p.role, p.company].filter(Boolean).join(' at '),
    p.tags?.length ? 'interests: ' + p.tags.join(', ') : '',
    p.doing ? 'up to: ' + p.doing : '',
    p.note ? 'notes: ' + p.note.slice(0, 240) : '',
    p.last ? 'last talked ' + ago(p.last) + ' ago' : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

/** The people most worth sending to Claude for this request (keyword overlap, notes, interests). */
export function pickPeople(people: Person[], prompt: string, max = 160) {
  const words = prompt.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length > 2);
  const score = (p: Person) => {
    const hay = [p.n, p.role, p.company, p.city, (p.tags || []).join(' '), p.note, p.doing].join(' ').toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s += 3;
    if (p.note) s += 1;
    if (p.tags?.length) s += 1;
    if (p.doing) s += 1;
    return s;
  };
  return people
    .map((p) => [score(p), p] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, max)
    .map((x) => x[1]);
}

const s = (x: unknown, max = 300) => String(x ?? '').slice(0, max);
const firstName = (p: Person) => p.n.split(' ')[0];
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
/** "I want to get better at jazz piano" -> "jazz piano". Used when no AI is available. */
function topicOf(prompt: string) {
  const t = prompt
    .trim()
    .replace(/[?.!]+$/, '')
    .replace(/^(i\s+want\s+to\s+(get\s+better\s+at|learn(\s+about)?|start|try|do)|who\s+could\s+help\s+me\s+(with)?|who\s+can\s+help\s+(me\s+)?(with)?|help\s+me\s+(with)?|i'?m\s+(into|interested\s+in)|anyone\s+into)\s+/i, '');
  return t.length > 40 ? t.slice(0, 40).replace(/\s+\S*$/, '') : t || 'this';
}

/** Turn a request into a map: people with reasons, plans, and real places. */
export async function makeMap(args: { id: string; prompt: string; people: Person[]; home: Place; circles: Circle[]; prev?: MapDoc | null; signal?: AbortSignal }): Promise<{ map: MapDoc; fallback: boolean }> {
  const { id, prompt, people, home, circles, prev } = args;
  const cand = pickPeople(people, prompt);
  const ids = new Set(people.map((p) => p.id));
  let res: any = null;
  try {
    const text = await ask(
      `You are Sparkles, an assistant that helps someone use their own network to do what they want. They typed a goal, interest or plan. Using ONLY the people listed below, find who is relevant and suggest small, concrete plans.

Today is ${todayIn(home.tz)}. The user lives in ${home.city}${home.country ? ', ' + home.country : ''}.
What they typed: ${JSON.stringify(prompt)}

Their people (id | name | circle | city | role | interests | what they're up to | notes | last talked):
${cand.map((p) => personLine(p, circles)).join('\n') || '(no people yet)'}

Rules:
- Use only ids from the list. Never invent people, and never claim to know anything about a person beyond what the list says. If nobody fits, return empty people and plans that do not need anyone.
- Plans are small things the user can propose: a message, an invite, a call, a visit, going somewhere together. Use relative timing ("this weekend", "next week") unless the user gave dates.
- "discover" is for well-known real places, venues, organizations, artists or communities that fit the request, with their real coordinates. Never invent specific events, dates, prices or ticket details.
- Write plainly and warmly. Keep each "why" to one or two sentences.

Return JSON only, in this shape:
{"title": short title for this map, "chip": one or two word label for the kind of request (your choice, for example a topic or activity),${circles.length ? ' "circle": the best-matching circle id from ' + circles.map((c) => JSON.stringify(c.id) + ' (' + c.label + ')').join(', ') + ', or "" if none fits,' : ''}
 "sub": one or two sentences summarizing what you found,
 "people": [{"id": id, "why": short reason}] (at most 8, best first),
 "plans": [{"kind": 1-3 word label, "icon": one of ${ICONS.join(' ')}, "when": timing, "title": short action title, "with": [ids], "why": reason, "where": place or medium}] (2 to 4),
 "discover": [{"name": name, "kind": 1-2 word type, "city": city, "cc": ISO country code, "lat": number, "lng": number, "note": one short line}] (0 to 6)}`,
      { tier: 'main', maxTokens: 3000, signal: args.signal },
    );
    res = parseJson(text);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    res = null;
  }
  const base = { id, prompt, at: prev?.at || Date.now(), state: prev?.state || {} };

  if (!res || typeof res !== 'object') {
    const words = prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const hits = cand
      .filter((p) => words.some((w) => [p.role, p.company, (p.tags || []).join(' '), p.note, p.doing, p.city].join(' ').toLowerCase().includes(w)))
      .slice(0, 8);
    const topic = topicOf(prompt);
    const plans: Plan[] = hits.slice(0, 3).map((p, i) => {
      const local = !!p.ck && p.ck === home.ck;
      return {
        id: `${id}_${i}`,
        kind: local ? 'Meet up' : 'Video call',
        ic: local ? '☕' : '☎',
        when: 'this week',
        title: `${local ? 'Coffee' : 'Call'} with ${firstName(p)} about ${topic}`,
        with: [p.id],
        why: p.doing ? `${firstName(p)} is ${lower(p.doing)}.` : `${firstName(p)} mentions ${topic} in your notes.`,
        where: local ? `A café in ${home.city}` : `Video call${p.city ? ` (${p.city} time)` : ''}`,
        topic,
      };
    });
    return {
      fallback: true,
      map: {
        ...base,
        title: prompt.slice(0, 60),
        chip: 'Search',
        m: '',
        sub: hits.length
          ? `${hits.length} ${hits.length === 1 ? 'person mentions' : 'people mention'} words from your request.`
          : 'No one in your network mentions this yet. Add interests and notes to people so Sparkles can find them.',
        plans,
        sec: hits.length ? [{ h: 'From your network', ids: hits.map((p) => p.id) }] : [],
        disc: [],
      },
    };
  }

  const ppl = (Array.isArray(res.people) ? res.people : []).filter((x: any) => x && ids.has(x.id)).slice(0, 8);
  const plans: Plan[] = (Array.isArray(res.plans) ? res.plans : [])
    .slice(0, 4)
    .map((p: any, i: number) => ({
      id: `${id}_${i}`,
      kind: s(p.kind, 30),
      ic: ICONS.includes(p.icon) ? p.icon : '◎',
      when: s(p.when, 40),
      title: s(p.title, 120),
      with: (Array.isArray(p.with) ? p.with : []).filter((x: string) => ids.has(x)).slice(0, 4),
      why: s(p.why),
      where: s(p.where, 120),
    }))
    .filter((p: Plan) => p.title);
  const disc: Discover[] = (Array.isArray(res.discover) ? res.discover : [])
    .slice(0, 6)
    .filter((d: any) => d && d.name && Number.isFinite(+d.lat) && Number.isFinite(+d.lng) && Math.abs(+d.lat) <= 90 && Math.abs(+d.lng) <= 180)
    .map((d: any, i: number) => ({
      ...makePlace(s(d.city, 60), s(d.cc, 2).toUpperCase(), +d.lat, +d.lng),
      ck: 'disc:' + s(d.city, 60),
      id: `${id}_d${i}`,
      t: 'disc' as const,
      g: '★',
      n: s(d.name, 80),
      k: s(d.kind, 30) || 'Place',
      doing: s(d.note, 160),
    }));
  const why: Record<string, string> = {};
  ppl.forEach((x: any) => (why[x.id] = s(x.why, 160)));
  const sec = [];
  if (ppl.length) sec.push({ h: 'From your network', ids: ppl.map((x: any) => x.id as string), why });
  if (disc.length) sec.push({ h: 'Places and ideas', ids: disc.map((d) => d.id) });
  return {
    fallback: false,
    map: {
      ...base,
      title: s(res.title, 80) || prompt.slice(0, 60),
      chip: s(res.chip, 20) || 'Map',
      m: circles.some((c) => c.id === res.circle) ? res.circle : '',
      sub: s(res.sub),
      plans,
      sec,
      disc,
    },
  };
}

/** A short message proposing a plan. */
export async function draftInvite(plan: Plan, withPeople: Person[], senderName: string, circles: Circle[] = []) {
  try {
    return await ask(
      `Write a short, warm message${senderName ? ' from ' + senderName : ''}${withPeople.length ? ' to ' + withPeople.map((x) => x.n).join(' and ') : ''} proposing this plan. 2 to 4 sentences, casual and specific, no subject line, no placeholders like [Name], no sign-off. Use first names. Return only the message.
Plan: ${plan.title}. When: ${plan.when}. Where: ${plan.where}. Why it fits: ${plan.why}
${withPeople.map((x) => 'About ' + x.n + ': ' + personLine(x, circles)).join('\n')}`,
      { tier: 'quick', maxTokens: 400 },
    );
  } catch {
    const first = withPeople.map((x) => x.n.split(' ')[0]).join(' and ');
    const meet = /video|call/i.test(plan.kind + plan.where) ? 'a quick video call' : /coffee|meet/i.test(plan.kind + plan.title) ? 'a coffee' : 'catching up';
    const about = plan.topic ? `I’ve been getting into ${plan.topic} and you came to mind. ` : '';
    return `Hi${first ? ' ' + first : ''}! ${about}Would you be up for ${meet} ${(plan.when || 'soon').toLowerCase()}? I’d love to hear what you’ve been up to.`;
  }
}

/** One small next step with a person. */
export async function suggestNext(p: Person, home: Place | null, goals: string[], circles: Circle[] = []) {
  try {
    return await ask(
      `Suggest ONE small, specific next step the user could take with this person, in one or two sentences. Base it only on the details below; do not invent facts about them. Today is ${todayIn(home?.tz)}.${home ? ' The user lives in ' + home.city + '.' : ''}${goals.length ? ' Things the user is working on: ' + goals.join('; ') + '.' : ''}
Person: ${personLine(p, circles)}
Return only the suggestion.`,
      { tier: 'quick', maxTokens: 200 },
    );
  } catch {
    return p.last ? `It has been ${ago(p.last)} since you last talked. Send ${p.n.split(' ')[0]} a quick note about something you both care about.` : `Send ${p.n.split(' ')[0]} a short hello and ask what they are working on.`;
  }
}

/** Geocode a place the offline list doesn't know. */
export async function geocode(q: string): Promise<Place | null> {
  try {
    const r = parseJson(
      await ask(
        `Return the location of this place as JSON only: {"city": string, "cc": ISO 3166-1 alpha-2 country code, "lat": number, "lng": number}. If it is not a real place you are confident about, return {"city": null}.\nPlace: ${JSON.stringify(q.slice(0, 120))}`,
        { tier: 'quick', maxTokens: 120 },
      ),
    );
    if (!r || !r.city || !Number.isFinite(+r.lat) || !Number.isFinite(+r.lng)) return null;
    return makePlace(s(r.city, 80), s(r.cc, 2).toUpperCase(), +r.lat, +r.lng);
  } catch {
    return null;
  }
}
