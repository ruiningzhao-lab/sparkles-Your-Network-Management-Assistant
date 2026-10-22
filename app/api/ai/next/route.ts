import { bad, body, member, ok } from '@/lib/api';
import { suggestNext } from '@/lib/ai';
import { cleanCircles } from '@/lib/store/validate';

/** Suggest one next step with a person, and remember it on their record. */
export const POST = member(async ({ store }, req) => {
  const b = await body(req);
  const { profile, people, maps } = await store.load();
  const p = people.find((x) => x.id === b.personId);
  if (!p) return bad('That person no longer exists.', 404);
  const text = (await suggestNext(p, profile?.home || null, maps.slice(0, 6).map((m) => m.prompt), cleanCircles(profile?.circles))).slice(0, 600);
  await store.upsertPeople([{ ...p, next: text }]);
  return ok({ text });
});
