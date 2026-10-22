import { body, member, ok } from '@/lib/api';
import { cleanState } from '@/lib/store/validate';

type P = { params: Promise<{ id: string }> };

/** Save which plans are marked as planned. */
export const PATCH = member(async ({ store }, req, ctx: P) => {
  const { id } = await ctx.params;
  const b = await body(req);
  await store.setMapState(id, cleanState(b.state));
  return ok();
});

export const DELETE = member(async ({ store }, _req, ctx: P) => {
  const { id } = await ctx.params;
  await store.deleteMap(id);
  return ok();
});
