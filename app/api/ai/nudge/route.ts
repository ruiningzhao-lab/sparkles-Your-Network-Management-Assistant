import { bad, body, member, ok } from '@/lib/api';
import { draftNudge } from '@/lib/ai';
import { cleanCircles } from '@/lib/store/validate';

/** Draft a reply, a nudge or a follow-up message. Sparkles never sends it. */
export const POST = member(async ({ store, viewer }, req) => {
  const b = await body(req);
  const kind = ['reply', 'nudge', 'followup'].includes(b.kind) ? b.kind : 'nudge';
  const { people, profile } = await store.load();
  const p = people.find((x) => x.id === b.personId);
  if (!p) return bad('That person no longer exists.', 404);
  const about = typeof b.about === 'string' ? b.about.slice(0, 300) : '';
  return ok({ text: await draftNudge(kind, p, about, viewer.name, cleanCircles(profile?.circles)) });
});
