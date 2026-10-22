import { bad, body, member, ok } from '@/lib/api';
import { loadAgenda } from '@/lib/agenda/source';
import type { DemoAct } from '@/lib/store/types';

export const dynamic = 'force-dynamic';

/** Today's agenda: meetings, threads, follow-ups, notes and suggestions. `off` is the browser's getTimezoneOffset(). */
export const GET = member(async ({ store, viewer }, req) => {
  const off = Number(new URL(req.url).searchParams.get('off'));
  return ok(await loadAgenda(store, viewer, new Date(), Number.isFinite(off) && Math.abs(off) <= 840 ? off : 0));
});

const ACTS: DemoAct['s'][] = ['done', 'snoozed', 'dismissed', 'captured'];

/**
 * { action: 'demo', on: boolean }  turn demo data on, or exit it (clears demo actions)
 * { action: 'act', id, s, until? } record done/snooze/dismiss on a generated demo item, or undo it with s: 'open'
 */
export const POST = member(async ({ store }, req) => {
  const b = await body(req);
  const { profile } = await store.load();
  const prefs = { ...(profile?.agenda || {}) };
  if (b.action === 'demo') {
    await store.saveAgendaPrefs({ ...prefs, demo: Boolean(b.on), acts: {} });
    return ok({ demo: Boolean(b.on) });
  }
  if (b.action === 'act') {
    const id = typeof b.id === 'string' ? b.id.slice(0, 120) : '';
    if (!id.startsWith('demo-')) return bad('Only demo items are tracked here.');
    const acts = { ...(prefs.acts || {}) };
    if (b.s === 'open') delete acts[id];
    else if (ACTS.includes(b.s)) {
      const until = typeof b.until === 'string' && !isNaN(Date.parse(b.until)) ? new Date(b.until).toISOString() : undefined;
      acts[id] = until ? { s: b.s, until } : { s: b.s };
    } else return bad('Unknown action.');
    if (Object.keys(acts).length > 500) return bad('Too many demo actions. Exit demo to reset.');
    await store.saveAgendaPrefs({ ...prefs, acts });
    return ok();
  }
  return bad('Unknown action.');
});
