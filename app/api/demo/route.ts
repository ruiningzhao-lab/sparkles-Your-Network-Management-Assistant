import { member, ok } from '@/lib/api';
import { isSample, sampleHome, samplePeople } from '@/lib/demo/network';
import { cleanCircles } from '@/lib/store/validate';

export const dynamic = 'force-dynamic';

/** Add the sample network (and a home city if none is set yet). */
export const POST = member(async ({ store }) => {
  const { profile, people } = await store.load();
  const have = new Set(people.map((p) => p.id));
  const add = samplePeople().filter((p) => !have.has(p.id));
  if (add.length) await store.upsertPeople(add);
  let home = profile?.home || null;
  if (!home) {
    home = sampleHome();
    await store.saveProfile({ home, circles: cleanCircles(profile?.circles) });
  }
  return ok({ added: add.length, home });
});

/** Remove every sample person. People you added yourself stay. */
export const DELETE = member(async ({ store }) => {
  const people = await store.listPeople();
  const sample = people.filter(isSample);
  for (const p of sample) await store.deletePerson(p.id);
  return ok({ removed: sample.length });
});
