import { requireAdmin, requireMember, type Viewer } from '@/lib/auth';
import { storeFor } from '@/lib/store';
import type { Store } from '@/lib/store/types';

type Ctx = { viewer: Viewer; store: Store };

/** Wrap an API handler: signed-in member required, JSON errors, no stack traces leaked. */
export function member<A extends unknown[]>(fn: (ctx: Ctx, req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A) => {
    const viewer = await requireMember();
    if (viewer instanceof Response) return viewer;
    try {
      return await fn({ viewer, store: await storeFor(viewer) }, req, ...rest);
    } catch (e) {
      console.error(e);
      return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}

export function admin<A extends unknown[]>(fn: (viewer: Viewer, req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A) => {
    const viewer = await requireAdmin();
    if (viewer instanceof Response) return viewer;
    try {
      return await fn(viewer, req, ...rest);
    } catch (e) {
      console.error(e);
      return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}

export async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export const bad = (error: string, status = 400) => Response.json({ error }, { status });
export const ok = (data: unknown = { ok: true }) => Response.json(data);
