import { member, ok } from '@/lib/api';

export const DELETE = member(async ({ store }) => {
  await store.deleteAllPeople();
  return ok();
});
