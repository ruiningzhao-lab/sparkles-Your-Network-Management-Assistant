import { member, ok } from '@/lib/api';

export const DELETE = member(async ({ store }, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await store.deletePerson(id);
  return ok();
});
