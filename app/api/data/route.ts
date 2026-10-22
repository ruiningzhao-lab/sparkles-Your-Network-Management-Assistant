import { member, ok } from '@/lib/api';
import { aiEnabled } from '@/lib/ai';
import { cleanCircles } from '@/lib/store/validate';

export const dynamic = 'force-dynamic';

/** Everything the map needs for the signed-in user. */
export const GET = member(async ({ store }) => {
  const d = await store.load();
  return ok({ ...d, circles: cleanCircles(d.profile?.circles), ai: aiEnabled() });
});
