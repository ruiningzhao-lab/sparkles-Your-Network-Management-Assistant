import { bad, body, member, ok } from '@/lib/api';
import { cleanCircles, cleanPlace } from '@/lib/store/validate';

/** Save home city and/or circles. */
export const PUT = member(async ({ store }, req) => {
  const b = await body(req);
  const { profile } = await store.load();
  const home = b.home === undefined ? profile?.home || null : cleanPlace(b.home);
  if (!home) return bad('Choose a home city.');
  const circles = b.circles === undefined ? cleanCircles(profile?.circles) : cleanCircles(b.circles);
  await store.saveProfile({ home, circles });
  return ok({ home, circles });
});
