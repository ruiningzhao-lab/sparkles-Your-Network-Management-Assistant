import { bad, body, member, ok } from '@/lib/api';
import { makeMap } from '@/lib/ai';
import { cleanCircles } from '@/lib/store/validate';

export const maxDuration = 120;

/** Ask Claude to map a request against the user's network, and save the result. */
export const POST = member(async ({ store }, req) => {
  const b = await body(req);
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim().slice(0, 500) : '';
  if (!prompt) return bad('Type what you want to do.');
  const { profile, people } = await store.load();
  if (!profile?.home) return bad('Set your home city first.');
  const reuse = typeof b.reuseId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(b.reuseId) ? b.reuseId : null;
  const prev = reuse ? await store.getMap(reuse) : null;
  const id = prev?.id || 'm' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const circles = cleanCircles(profile.circles);
  const { map, fallback } = await makeMap({ id, prompt, people, home: profile.home, circles, prev, signal: req.signal });
  await store.saveMap(map);
  return ok({ map, fallback });
});
