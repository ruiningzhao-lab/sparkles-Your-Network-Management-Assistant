import tzlookup from 'tz-lookup';
import GAZ from './gazetteer.json';
import type { Place } from '@/lib/store/types';

// Offline city lookup: ~3,700 cities with population over 120k (all-the-cities, GeoNames data),
// ordered by population, plus country names. Used on both the server and in the browser.
const G = GAZ as unknown as { c: [string, string, number, number][]; n: Record<string, string> };
export const CITIES = G.c;
export const COUNTRY_NAMES = G.n;

const index = new Map<string, number[]>();
CITIES.forEach((c, i) => {
  const k = c[0].toLowerCase();
  if (!index.has(k)) index.set(k, []);
  index.get(k)!.push(i);
});

export function makePlace(city: string, cc: string, lat: number, lng: number): Place {
  let tz = '';
  try {
    tz = tzlookup(lat, lng);
  } catch {}
  return { city, cc: cc || '', country: COUNTRY_NAMES[cc] || cc || '', lat: +lat, lng: +lng, tz, ck: `${city}|${cc || ''}` };
}

/** "Seattle" or "Seattle, United States" or "Paris, FR". Returns null if unknown or ambiguous. */
export function findCity(q: string): Place | null {
  if (!q) return null;
  const parts = q.split(',').map((s) => s.trim()).filter(Boolean);
  const name = (parts[0] || '').toLowerCase();
  const rest = parts.slice(1).join(' ').toLowerCase();
  const hits = index.get(name);
  if (!hits) return null;
  let pick = hits[0];
  if (rest) {
    const m = hits.find((i) => {
      const cc = CITIES[i][1];
      const cn = (COUNTRY_NAMES[cc] || '').toLowerCase();
      return cc.toLowerCase() === rest || cn === rest || cn.startsWith(rest);
    });
    if (m === undefined) return null;
    pick = m;
  }
  const c = CITIES[pick];
  return makePlace(c[0], c[1], c[2], c[3]);
}
