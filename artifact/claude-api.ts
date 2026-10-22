// @ts-nocheck
// claude.ai build: the same app, with data kept privately per person in the artifact's
// database and AI calls made with each viewer's own Claude access. No server needed.
import { aiEnabled, configureAI, draftInvite, geocode, makeMap, suggestNext } from '@/lib/ai-core';
import { findCity } from '@/lib/geo';
import { cleanCircles, cleanPerson, cleanPlace, cleanState } from '@/lib/store/validate';

const fail = (msg) => { const e = new Error(msg); e.userMessage = msg; e.status = 400; return e; };

export async function createClaudeApi() {
  const c = window.claude;
  const [db, user, sample] = c?.use ? await Promise.all(['db', 'user', 'sample'].map((n) => c.use(n).catch(() => null))) : [null, null, null];
  let uid = null, name = '';
  if (user) { try { uid = await user.id(); name = (await user.me())?.name || ''; } catch {} }
  const viewer = { mode: 'claude', name, email: '', admin: false };
  if (!db || !uid) {
    const signedOut = { load: async () => { throw fail('Open this page while signed in to Claude. Your people and maps are saved privately to your account.'); } };
    return { api: signedOut, viewer };
  }
  if (sample) {
    configureAI(async (prompt, { tier, signal }) => (await sample(prompt, { modelTier: tier === 'main' ? 'default' : 'quick', signal, cache: false })).text);
  }

  const base = `data/users/${uid}/profile`;
  let chunks = [], profile = null, maps = {};
  const queues = {};
  const serial = (key, fn) => { const p = (queues[key] || Promise.resolve()).then(fn, fn); queues[key] = p.catch(() => {}); return p; };
  const writeChunk = (ch) => serial('c:' + ch.id, () => db.doc(`${base}/chunks/${ch.id}`).set({ items: ch.items }));
  const people = () => chunks.flatMap((ch) => ch.items);
  const chunkOf = (id) => chunks.find((ch) => ch.items.some((x) => x.id === id));
  const circles = () => cleanCircles(profile?.circles);
  const saveMap = (m) => { const { id, ...rest } = m; return serial('m:' + id, () => db.doc(`${base}/maps/${id}`).set(JSON.parse(JSON.stringify(rest)))); };
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (e?.userMessage || e?.name === 'AbortError') throw e; console.warn(e); throw fail(e?.code === 'quota_exceeded' ? 'Storage is full. Remove some people or maps.' : 'Couldn’t save. Check your connection and try again.'); } };

  async function upsert(list) {
    const touched = new Set();
    for (const p of list) {
      let ch = chunkOf(p.id);
      if (ch) ch.items = ch.items.map((x) => (x.id === p.id ? p : x));
      else { ch = chunks.find((x) => x.items.length < 180); if (!ch) { ch = { id: 'c' + Math.random().toString(36).slice(2, 10), items: [] }; chunks.push(ch); } ch.items.push(p); }
      touched.add(ch);
    }
    for (const ch of touched) await writeChunk(ch);
  }

  const api = {
    load: wrap(async () => {
      const prof = await db.doc(base).get();
      profile = prof.exists ? prof.data() : null;
      const cs = await db.collection(base + '/chunks').get();
      chunks = cs.docs.map((d) => ({ id: d.id, items: (d.data() || {}).items || [] }));
      const ms = await db.collection(base + '/maps').get();
      maps = Object.fromEntries(ms.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
      return { profile, people: people(), maps: Object.values(maps), circles: circles(), ai: aiEnabled() };
    }),
    saveProfile: wrap(async (b) => {
      const home = b.home === undefined ? profile?.home || null : cleanPlace(b.home);
      if (!home) throw fail('Choose a home city.');
      const cl = b.circles === undefined ? circles() : cleanCircles(b.circles);
      profile = { ...(profile || {}), home, circles: cl };
      await serial('profile', () => db.doc(base).set(profile));
      return { home, circles: cl };
    }),
    savePeople: wrap(async (raw) => {
      const list = raw.map(cleanPerson).filter(Boolean);
      if (!list.length) throw fail('Each person needs a name.');
      await upsert(list);
      return { saved: list.length };
    }),
    deletePerson: wrap(async (id) => { const ch = chunkOf(id); if (ch) { ch.items = ch.items.filter((x) => x.id !== id); await writeChunk(ch); } return {}; }),
    deleteAllPeople: wrap(async () => { for (const ch of chunks) await serial('c:' + ch.id, () => db.doc(`${base}/chunks/${ch.id}`).delete()); chunks = []; return {}; }),
    createMap: wrap(async (prompt, reuseId, signal) => {
      prompt = String(prompt || '').trim().slice(0, 500);
      if (!profile?.home) throw fail('Set your home city first.');
      const prev = reuseId ? maps[reuseId] || null : null;
      const id = prev?.id || 'm' + Math.random().toString(36).slice(2, 12);
      const { map, fallback } = await makeMap({ id, prompt, people: people(), home: profile.home, circles: circles(), prev, signal });
      maps[map.id] = map; await saveMap(map);
      return { map, fallback };
    }),
    saveMapState: wrap(async (id, state) => { const m = maps[id]; if (m) { m.state = cleanState(state); await saveMap(m); } return {}; }),
    deleteMap: wrap(async (id) => { delete maps[id]; await serial('m:' + id, () => db.doc(`${base}/maps/${id}`).delete()); return {}; }),
    draft: wrap(async (mapId, planId) => {
      const plan = maps[mapId]?.plans?.find((p) => p.id === planId); if (!plan) throw fail('That plan no longer exists.');
      const w = plan.with.map((id) => people().find((p) => p.id === id)).filter(Boolean);
      return { text: await draftInvite(plan, w, name, circles()) };
    }),
    next: wrap(async (personId) => {
      const p = people().find((x) => x.id === personId); if (!p) throw fail('That person no longer exists.');
      const text = (await suggestNext(p, profile?.home || null, Object.values(maps).slice(0, 6).map((m) => m.prompt), circles())).slice(0, 600);
      await upsert([{ ...p, next: text }]);
      return { text };
    }),
    geocode: wrap(async (q) => ({ place: findCity(q) || (await geocode(String(q).slice(0, 120))) })),
  };
  return { api, viewer };
}
