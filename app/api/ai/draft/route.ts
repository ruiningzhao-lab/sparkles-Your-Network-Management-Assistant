import { bad, body, member, ok } from '@/lib/api';
import { draftInvite } from '@/lib/ai';
import { cleanCircles } from '@/lib/store/validate';

export const POST = member(async ({ store, viewer }, req) => {
  const b = await body(req);
  const map = typeof b.mapId === 'string' ? await store.getMap(b.mapId) : null;
  const plan = map?.plans.find((p) => p.id === b.planId);
  if (!plan) return bad('That plan no longer exists.', 404);
  const { people, profile } = await store.load();
  const withPeople = plan.with.map((id) => people.find((p) => p.id === id)).filter(Boolean) as any[];
  return ok({ text: await draftInvite(plan, withPeople, viewer.name, cleanCircles(profile?.circles)) });
});
