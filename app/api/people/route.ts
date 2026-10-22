import { bad, body, member, ok } from '@/lib/api';
import { cleanPerson } from '@/lib/store/validate';
import type { Person } from '@/lib/store/types';

const MAX_PEOPLE = 10000;

export const GET = member(async ({ store }) => ok({ people: await store.listPeople() }));

/** Create or update people (one, or a batch from a CSV import). */
export const POST = member(async ({ store }, req) => {
  const b = await body(req);
  const raw = Array.isArray(b.people) ? b.people : [];
  if (!raw.length) return bad('No people to save.');
  if (raw.length > 2000) return bad('Import at most 2,000 people at a time.');
  const list = raw.map(cleanPerson).filter(Boolean) as Person[];
  if (!list.length) return bad('Each person needs a name.');
  const existing = await store.listPeople();
  const known = new Set(existing.map((p) => p.id));
  const added = list.filter((p) => !known.has(p.id)).length;
  if (existing.length + added > MAX_PEOPLE) return bad(`Sparkles holds up to ${MAX_PEOPLE.toLocaleString()} people.`);
  await store.upsertPeople(list);
  return ok({ saved: list.length });
});
