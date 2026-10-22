import { bad, body, member, ok } from '@/lib/api';
import { cleanFollowUp } from '@/lib/store/validate';

export const dynamic = 'force-dynamic';

export const GET = member(async ({ store }) => ok({ followUps: await store.listFollowUps() }));

/** Create or update a follow-up (including done and snooze). */
export const POST = member(async ({ store }, req) => {
  const b = await body(req);
  const people = await store.listPeople();
  const f = cleanFollowUp(b.followUp, new Set(people.map((p) => p.id)));
  if (!f) return bad('A follow-up needs a title and a person on your map.');
  await store.saveFollowUp(f);
  return ok({ followUp: f });
});

export const DELETE = member(async ({ store }, req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!id) return bad('Which follow-up?');
  await store.deleteFollowUp(id);
  return ok();
});
