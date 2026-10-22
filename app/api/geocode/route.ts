import { bad, body, member, ok } from '@/lib/api';
import { geocode } from '@/lib/ai';
import { findCity } from '@/lib/geo';

export const POST = member(async (_ctx, req) => {
  const b = await body(req);
  const q = typeof b.q === 'string' ? b.q.trim().slice(0, 120) : '';
  if (!q) return bad('Type a city.');
  return ok({ place: findCity(q) || (await geocode(q)) });
});
