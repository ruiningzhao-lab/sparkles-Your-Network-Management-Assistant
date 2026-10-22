import type { Circle, MapDoc, Person, Place } from './types';

export const DEFAULT_CIRCLES: Circle[] = [
  { id: 'work', label: 'Work', color: 0 },
  { id: 'friends', label: 'Friends', color: 1 },
  { id: 'family', label: 'Family', color: 2 },
];
const slug = (v: unknown) => (typeof v === 'string' && /^[a-z0-9_-]{1,24}$/.test(v) ? v : '');
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strList = (v: unknown, max: number, each: number) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => (x as string).trim().slice(0, each)) : [];
const isoDate = (v: unknown) => {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};
const url = (v: unknown) => {
  const s = str(v, 500);
  return /^https?:\/\//i.test(s) ? s : '';
};

export function cleanPlace(raw: any): Place | null {
  const lat = num(raw?.lat), lng = num(raw?.lng);
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const city = str(raw.city, 80);
  const cc = str(raw.cc, 2).toUpperCase();
  return { city, cc, country: str(raw.country, 80), lat, lng, tz: str(raw.tz, 60), ck: str(raw.ck, 120) || `${city}|${cc}` };
}

/** Accept a person from the browser, keeping only known fields with sane limits. */
export function cleanPerson(raw: any): Person | null {
  const id = str(raw?.id, 40);
  const n = str(raw?.n, 120);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !n) return null;
  const p: Person = {
    id,
    n,
    m: slug(raw.m),
    role: str(raw.role, 160),
    company: str(raw.company, 160),
    tags: strList(raw.tags, 20, 40),
    doing: str(raw.doing, 300),
    note: str(raw.note, 4000),
    last: isoDate(raw.last),
    url: url(raw.url),
    email: str(raw.email, 200),
    src: strList(raw.src, 6, 40),
    next: str(raw.next, 600),
    connected: isoDate(raw.connected),
    added: num(raw.added),
  };
  const place = cleanPlace(raw);
  if (place) Object.assign(p, place);
  return p;
}

export function cleanState(raw: any): MapDoc['state'] {
  const out: MapDoc['state'] = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw).slice(0, 20)) {
      const planned = num((v as any)?.planned);
      if (/^[A-Za-z0-9_-]{1,60}$/.test(k) && planned) out[k] = { planned };
    }
  }
  return out;
}

export function cleanCircles(raw: unknown): Circle[] {
  if (!Array.isArray(raw)) return DEFAULT_CIRCLES;
  const seen = new Set<string>();
  const out: Circle[] = [];
  for (const c of raw.slice(0, 12)) {
    const id = slug((c as any)?.id);
    const label = str((c as any)?.label, 24);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const color = Number((c as any)?.color);
    out.push({ id, label, color: Number.isInteger(color) && color >= 0 && color < 8 ? color : out.length % 8 });
  }
  return out;
}
