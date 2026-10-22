// @ts-nocheck
// The map app. Plain DOM + d3 for speed: it renders into the shell markup in Atlas.tsx
// and talks to the server only through the small API object below.
import * as d3 from 'd3';
import { feature, mesh } from 'topojson-client';
import TOPO from 'world-atlas/countries-50m.json';
import { CITIES, COUNTRY_NAMES, findCity, makePlace } from '@/lib/geo';
import { icon, NAV } from './icons';

type Viewer = { mode: 'local' | 'supabase' | 'claude'; name: string; email: string; admin: boolean };

/* ================= API ================= */
async function call(path, method = 'GET', data?, signal?) {
  const res = await fetch(path, { method, headers: data ? { 'content-type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined, signal });
  let out = {};
  try { out = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(out.error || 'Request failed'); e.status = res.status; throw e; }
  return out;
}
export const FETCH_API = {
  load: () => call('/api/data'),
  saveProfile: (p) => call('/api/profile', 'PUT', p),
  savePeople: (people) => call('/api/people', 'POST', { people }),
  deletePerson: (id) => call('/api/people/' + encodeURIComponent(id), 'DELETE'),
  deleteAllPeople: () => call('/api/people/all', 'DELETE'),
  createMap: (prompt, reuseId, signal) => call('/api/maps', 'POST', { prompt, reuseId }, signal),
  saveMapState: (id, state) => call('/api/maps/' + encodeURIComponent(id), 'PATCH', { state }),
  deleteMap: (id) => call('/api/maps/' + encodeURIComponent(id), 'DELETE'),
  draft: (mapId, planId) => call('/api/ai/draft', 'POST', { mapId, planId }),
  next: (personId) => call('/api/ai/next', 'POST', { personId }),
  geocode: (q) => call('/api/geocode', 'POST', { q }),
  loadSample: () => call('/api/demo', 'POST'),
  clearSample: () => call('/api/demo', 'DELETE'),
};
let API = FETCH_API;

/* ================= helpers ================= */
const ICONS = ['☕', '▶', '★', '◐', '♫', '☎', '✉', '↗', '→', '◆', '◎', '↻', '✈', '♪', '⇄', '◉'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ini = (n) => String(n || '?').replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = () => innerWidth <= 900;
const uid8 = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
const fn = (p) => String(p.n).split(' ')[0];
const placed = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
function localTime(tz) { if (!tz) return ''; try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', weekday: 'short' }).format(new Date()); } catch { return ''; } }
function ago(iso) { if (!iso) return ''; const d = (Date.now() - new Date(iso).getTime()) / 864e5; if (isNaN(d)) return ''; if (d < 1) return 'today'; if (d < 14) return Math.round(d) + ' d'; if (d < 60) return Math.round(d / 7) + ' wk'; if (d < 365) return Math.round(d / 30) + ' mo'; return Math.round(d / 365) + ' yr'; }
const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
function greetWord() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
const $ = (id) => document.getElementById(id);

/* ================= state ================= */
let VIEWER: Viewer;
const D = { loaded: false, error: false, profile: null, circles: [], people: [], maps: {}, ai: false };
const state = { tab: 'today', mode: 'all', layers: { disc: true }, lens: null, view: 'today', sel: null, hl: [], lensAt: 0, selAt: 0, t: d3.zoomIdentity, back: null, pf: 'all', pq: '', plimit: 60, edit: null, drafts: {}, confirm: null, importCircle: '' };
let MODES = { all: { l: 'All' } };
function setCircles(list) {
  D.circles = list || [];
  MODES = { all: { l: 'All' } };
  D.circles.forEach((c) => (MODES[c.id] = { l: c.label, c: `--c${c.color}` }));
  if (state.mode !== 'all' && !MODES[state.mode]) state.mode = 'all';
}
const circleOf = (p) => (p.m && MODES[p.m] && p.m !== 'all' ? MODES[p.m] : null);
const col = (p) => (p.t === 'disc' ? 'var(--m-disc)' : `var(${circleOf(p)?.c || '--c-none'})`);
let IDX = {};
function reindex() { IDX = {}; D.people.forEach((p) => (IDX[p.id] = p)); Object.values(D.maps).forEach((m) => (m.disc || []).forEach((d) => (IDX[d.id] = d))); }
const byId = (id) => IDX[id];
const home = () => D.profile?.home || null;
const secOf = (x) => (Array.isArray(x) ? x : [x.h, x.ids, x.why, x.note]);

/* ================= map ================= */
let svg, gBase, pGrat, pLand, pBord, gStr, gMk, gYou, zoom, land, borders;
let W = 0, H = 0, proj = d3.geoNaturalEarth1();
const SPLIT = 3.2;
// The part of the screen not covered by the rail, prompt and panel, so pins never hide under them.
function view() {
  const top = document.querySelector('.top')?.getBoundingClientRect().bottom || 120;
  if (mobile()) return { x0: 0, x1: W, y0: top + 12, y1: H * 0.52 - 12 };
  const rail = document.querySelector('.rail')?.getBoundingClientRect().right || 0;
  const pl = $('panel')?.getBoundingClientRect().left || W;
  return { x0: rail + 8, x1: pl - 8, y0: top + 12, y1: H - 72 };
}
function initMap() {
  svg = d3.select('#map');
  svg.selectAll('*').remove();
  gBase = svg.append('g');
  land = feature(TOPO, TOPO.objects.countries);
  borders = mesh(TOPO, TOPO.objects.countries, (a, b) => a !== b);
  pGrat = gBase.append('path').attr('class', 'grat');
  pLand = gBase.append('path').attr('class', 'land');
  pBord = gBase.append('path').attr('class', 'borders');
  gStr = svg.append('g'); gMk = svg.append('g'); gYou = svg.append('g');
  zoom = d3.zoom().scaleExtent([0.8, 60]).on('zoom', (e) => { state.t = e.transform; draw(); hideTip(); });
  svg.call(zoom).on('dblclick.zoom', null);
}
function layout() {
  const w = innerWidth, h = innerHeight; if (Math.abs(w - W) < 2 && Math.abs(h - H) < 2) return;
  W = w; H = h; const v = view();
  proj = d3.geoNaturalEarth1().fitExtent([[v.x0 + 16, v.y0], [v.x1 - 16, v.y1]], { type: 'MultiPoint', coordinates: [[-170, 72], [180, 72], [-170, -46], [180, -46], [0, 72], [0, -46]] });
  const path = d3.geoPath(proj);
  pLand.attr('d', path(land)); pBord.attr('d', path(borders)); pGrat.attr('d', path(d3.geoGraticule10()));
  zoom.translateExtent([[-W * 0.3, -H * 0.3], [W * 1.3, H * 1.3]]).extent([[0, 0], [W, H]]);
  draw();
}
function curMap() { return state.lens && !state.lens.startsWith('place:') ? D.maps[state.lens] : null; }
function lensSet() {
  if (!state.lens) return null;
  if (state.lens.startsWith('place:')) { const ck = state.lens.slice(6); return new Set(D.people.filter((p) => p.ck === ck).map((p) => p.id)); }
  const m = curMap(); if (!m) return null;
  return new Set([...(m.sec || []).map(secOf).flatMap((x) => x[1] || []), ...(m.plans || []).flatMap((p) => p.with || []), ...(m.disc || []).map((d) => d.id)]);
}
function discItems() { return lensSet() ? curMap()?.disc || [] : []; }
function visible() {
  const L = lensSet();
  const ppl = D.people.filter((p) => {
    if (!placed(p)) return false;
    if (state.mode !== 'all' && p.m !== state.mode && !(L && L.has(p.id)) && p.id !== state.sel) return false;
    return true;
  });
  return state.layers.disc ? ppl.concat(discItems().filter(placed)) : ppl;
}
function draw() {
  if (!W || !gBase) return;
  const t = state.t, k = t.k; gBase.attr('transform', t);
  const items = visible(), L = lensSet(), HL = new Set(state.hl);
  const pt = (lat, lng) => { const p = proj([lng, lat]); return [t.applyX(p[0]), t.applyY(p[1])]; };
  const groups = d3.groups(items, (d) => d.ck || `${d.lat},${d.lng}`).map(([ck, arr]) => { const [x, y] = pt(arr[0].lat, arr[0].lng); return { cities: [arr[0].city || ''], items: arr, x, y }; }).sort((a, b) => b.items.length - a.items.length);
  const C = Math.min(30, 13 + Math.max(0, k - SPLIT) * 1.6);
  const md = k < SPLIT ? 30 : C * 3.2, cl = [];
  for (const g of groups) {
    const m = cl.find((o) => Math.hypot(o.x - g.x, o.y - g.y) < md);
    if (m) { const a = m.items.length, b = g.items.length; m.x = (m.x * a + g.x * b) / (a + b); m.y = (m.y * a + g.y * b) / (a + b); m.items.push(...g.items); m.cities.push(...g.cities); }
    else cl.push(g);
  }
  const h = home(); let you = h ? pt(h.lat, h.lng) : null;
  let mk = '', labels = ''; const now = performance.now();
  cl.forEach((g, gi) => {
    const indiv = g.items.length === 1 || k >= SPLIT;
    const isHome = you && Math.hypot(g.x - you[0], g.y - you[1]) < (k < SPLIT ? 30 : C * 3.2);
    if (indiv) {
      const ord = [...g.items].sort((a, b) => (a.t === 'disc') - (b.t === 'disc'));
      const off = isHome || g.items.length > 1 ? 1 : 0;
      const cx = isHome ? you[0] : g.x, cy = isHome ? you[1] : g.y;
      ord.forEach((p, i) => { const j = i + off, a = j * 2.39996, r = j ? C * Math.sqrt(j) : 0; p._x = cx + r * Math.cos(a); p._y = cy + r * Math.sin(a); p._b = null; });
      const n = g.items.length, nl = L ? g.items.filter((q) => L.has(q.id)).length : 0;
      g.items.forEach((p) => {
        const on = L && L.has(p.id), dimd = L && !on && p.id !== state.sel, sel = p.id === state.sel, hov = HL.has(p.id);
        let s = `<g class="mk${dimd ? ' dim' : ''}" data-id="${esc(p.id)}" transform="translate(${p._x},${p._y})">`;
        if (sel) s += `<circle class="halo" r="15" style="animation-delay:-${now % 2200}ms"/>`;
        if (on || hov) s += `<circle r="14.5" fill="none" stroke="var(--string)" stroke-width="${hov ? 3 : 2}"/>`;
        if (p.t === 'disc') s += `<rect x="-10" y="-10" width="20" height="20" rx="6" fill="var(--surface)" stroke="var(--m-disc)" stroke-width="2" stroke-dasharray="3 2"/><text class="ini out" style="fill:var(--m-disc)">${esc(p.g || '★')}</text>`;
        else s += `<circle r="11" fill="${col(p)}" stroke="var(--surface)" stroke-width="1.5"/><text class="ini">${esc(ini(p.n))}</text>`;
        mk += s + '</g>';
        const showName = sel || hov || (n === 1 && !dimd && (on || k >= 2)) || (k >= SPLIT && C >= 24 && !dimd && (L ? on && nl <= 10 : n <= 6));
        if (showName) labels += `<text class="nm" x="${p._x}" y="${p._y + 24}">${esc(p.n.length > 24 ? p.n.slice(0, 23) + '…' : p.n)}</text>`;
      });
      if (n > 1) { const rr = C * Math.sqrt(n + 1); labels += `<text class="cityl" x="${cx}" y="${cy - rr - 8}">${esc([...new Set(g.cities)].slice(0, 3).join(' · '))}</text>`; }
    } else {
      g.items.forEach((p) => { p._x = g.x; p._y = g.y; p._b = gi; });
      const r = 9 + Math.sqrt(g.items.length) * 3;
      if (isHome) you = [g.x + r * 0.72, g.y - r * 0.72];
      const arcs = d3.pie().sort(null).value((d) => d[1])(d3.rollups(g.items, (v) => v.length, (d) => (d.t === 'disc' ? 'disc' : circleOf(d) ? d.m : 'none')));
      const arc = d3.arc().innerRadius(r - 4.5).outerRadius(r);
      const hl = (L && g.items.some((p) => L.has(p.id))) || g.items.some((p) => HL.has(p.id));
      const fill = (k2) => (k2 === 'disc' ? 'var(--m-disc)' : k2 === 'none' ? 'var(--c-none)' : `var(${MODES[k2].c})`);
      mk += `<g class="mk${L && !hl ? ' dim' : ''}" data-b="${gi}" transform="translate(${g.x},${g.y})">` + (hl ? `<circle r="${r + 4}" fill="none" stroke="var(--string)" stroke-width="2"/>` : '') +
        `<circle r="${r}" fill="var(--surface)" stroke="var(--line)"/>` + arcs.map((a) => `<path d="${arc(a)}" fill="${fill(a.data[0])}"/>`).join('') + `<text class="ct">${g.items.length}</text></g>`;
      if (!cl.some((o) => o !== g && Math.hypot(o.x - g.x, o.y - g.y) < 80)) labels += `<text class="cityl" x="${g.x}" y="${g.y + r + 13}">${esc(g.cities.length > 1 ? g.cities[0] + ' area' : g.cities[0])}</text>`;
    }
  });
  const targets = new Map();
  if (L) items.filter((p) => L.has(p.id) && p.t !== 'disc').forEach((p) => targets.set(p.id, 'lens'));
  state.hl.forEach((id) => { const p = byId(id); if (p && p.t !== 'disc') targets.set(id, 'hl'); });
  if (state.sel && byId(state.sel) && byId(state.sel).t !== 'disc') targets.set(state.sel, 'sel');
  const done = new Set(); let st = '';
  const curve = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy); if (d < 6) return null; const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; let nx = -dy / d, ny = dx / d; if (ny > 0) { nx = -nx; ny = -ny; } const b = Math.min(d * 0.22, 160); return `M${x1},${y1}Q${mx + nx * b},${my + ny * b} ${x2},${y2}`; };
  const anim = (at) => { const e = now - at; return e < 1300 && !reduce ? ` draw" style="animation-delay:-${e}ms` : ''; };
  if (you) targets.forEach((kind, id) => {
    const p = byId(id); if (!p || !items.includes(p)) return;
    const key = p._b != null ? 'b' + p._b : id; if (done.has(key) && kind === 'lens') return; done.add(key);
    const cls = 'str' + (kind !== 'lens' ? ' sel' : ''), at = kind === 'sel' ? state.selAt : kind === 'lens' ? state.lensAt : 0;
    const d = curve(you[0], you[1], p._x, p._y); if (d) st += `<path class="${cls}${anim(at)}" d="${d}" pathLength="1"/>`;
  });
  gStr.html(st); gMk.html(mk + labels);
  gYou.html(you ? `<g class="you" transform="translate(${you[0]},${you[1]})"><circle r="9" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><path d="M0,-5.5l1.6,3.6 3.9,.3-3,2.5 1,3.8L0,2.1l-3.5,2.1 1-3.8-3-2.5 3.9-.3z" fill="#fff"/><text y="-14">You</text></g>` : '');
  const ppl = items.filter((p) => p.t !== 'disc'), unpl = D.people.filter((p) => !placed(p)).length;
  $('stats').innerHTML = D.loaded ? `<span><b>${ppl.length}</b> on the map</span><span><b>${new Set(ppl.map((p) => p.ck)).size}</b> cities</span>${unpl ? `<button data-act="place" title="Add cities"><b>${unpl}</b> need a city</button>` : ''}<span class="opt"><svg viewBox="0 0 22 10"><path d="M1,9Q11,-3 21,9" fill="none" stroke="var(--string)" stroke-width="1.8"/></svg>Connection to you</span>` : '';
}
function flyLL(lat, lng, k) { const v = view(), cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, [x, y] = proj([lng, lat]); svg.transition().duration(reduce ? 0 : 1600).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(k).translate(-x, -y)); }
function flyWorld() { svg.transition().duration(reduce ? 0 : 1300).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity); }
function cityZoom(p) {
  const a = proj([p.lng, p.lat]); const others = [...new Map(D.people.filter(placed).filter((o) => o.ck !== p.ck).map((o) => [o.ck, o])).values()];
  if (!others.length) return 8;
  const dmin = Math.min(...others.map((o) => { const b = proj([o.lng, o.lat]); return Math.hypot(a[0] - b[0], a[1] - b[1]); }));
  return Math.min(14, Math.max(SPLIT + 4, 140 / Math.max(dmin, 1)));
}
function fitItems(list) {
  const h = home(); const pts = list.filter(placed).map((p) => proj([p.lng, p.lat])); if (h) pts.push(proj([h.lng, h.lat]));
  if (pts.length < 2) { const p = list.find(placed) || h; if (p) flyLL(p.lat, p.lng, cityZoom(p)); return; }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), v = view();
  const w = Math.max(...xs) - Math.min(...xs), hh = Math.max(...ys) - Math.min(...ys);
  const k = Math.max(1, Math.min(12, 0.75 * Math.min((v.x1 - v.x0) / Math.max(w, 1), (v.y1 - v.y0) / Math.max(hh, 1))));
  if (k < 1.4) { flyWorld(); return; }
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, vx = (v.x0 + v.x1) / 2, vy = (v.y0 + v.y1) / 2;
  svg.transition().duration(reduce ? 0 : 1500).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity.translate(vx, vy).scale(k).translate(-cx, -cy));
}
let tip;
function hideTip() { if (tip) tip.hidden = true; }
function showTip(p, e) { tip.innerHTML = `<b>${esc(p.n)}</b><span>${esc(p.t === 'disc' ? p.k : [p.role, p.company].filter(Boolean).join(' · '))}${p.city ? ' · ' + esc(p.city) : ''}</span>${p.doing ? `<i>${esc(p.doing)}</i>` : ''}`; tip.hidden = false; placeTip(e); }
function placeTip(e) { let x = e.clientX + 14, y = e.clientY + 14; if (x > innerWidth - 260) x -= 270; if (y > innerHeight - 100) y -= 110; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
function bindMap() {
  tip = $('tip');
  gMk.on('mouseover', (e) => { const g = e.target.closest('[data-id]'); if (!g) return; const p = byId(g.dataset.id); if (!p || (state.hl.length === 1 && state.hl[0] === p.id)) return; state.hl = [p.id]; draw(); showTip(p, e); })
    .on('mousemove', (e) => { if (!tip.hidden) placeTip(e); })
    .on('mouseout', (e) => { const g = e.target.closest('[data-id]'); if (g && !(e.relatedTarget && g.contains(e.relatedTarget))) { state.hl = []; hideTip(); draw(); } })
    .on('click', (e) => {
      const g = e.target.closest('[data-id]'); if (g) { openPerson(g.dataset.id); return; }
      const b = e.target.closest('[data-b]'); if (b) { const [x, y] = d3.pointer(e, svg.node()), t = state.t, v = view(); svg.transition().duration(reduce ? 0 : 900).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity.translate((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2).scale(Math.max(SPLIT + 0.4, t.k * 2.6)).translate(-t.invertX(x), -t.invertY(y))); }
    });
  $('zin').onclick = () => svg.transition().duration(400).call(zoom.scaleBy, 2);
  $('zout').onclick = () => svg.transition().duration(400).call(zoom.scaleBy, 0.5);
  $('zhome').onclick = () => flyWorld();
}

/* ================= top bar + strip ================= */
// Generic starting points. Each one fills the box so the person can finish the sentence.
const IDEAS = [
  ['Learn', 'I want to get better at '],
  ['Work', 'Who could help me with '],
  ['Travel', 'I’m visiting  next month. Who should I see?'],
  ['Catch up', 'Who should I catch up with this month?'],
  ['Introduce', 'Who in my network should meet each other?'],
  ['Event', 'Who did I meet at '],
];
function drawBar() {
  $('modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button data-mode="${esc(k)}" aria-pressed="${state.mode === k}">${m.c ? `<i style="background:var(${m.c})"></i>` : ''}${esc(m.l)}</button>`).join('');
  $('layers').innerHTML = `<button class="chip" data-layer="disc" aria-pressed="${state.layers.disc}"><svg viewBox="0 0 16 8"><rect x="4.5" y=".5" width="7" height="7" rx="2" fill="none" stroke="var(--m-disc)" stroke-width="1.4"/></svg>Places</button>`;
  const lt = state.lens ? lensTitle() : null;
  $('lensSlot').innerHTML = lt ? `<span class="lenschip"><small>${esc(lt[0])}</small><span>${esc(lt[1])}</span><button id="clearLens" aria-label="Clear filter">${icon('close', 14)}</button></span>` : '';
  const saved = Object.values(D.maps).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10);
  $('strip').innerHTML = saved.length ? `<span class="lbl">Maps</span>` + saved.map((s) => storyCard('map', s.id, s.chip || 'Map', s.m, s.prompt)).join('') : '';
}
function storyCard(kind, id, chip, m, prompt) { const c = MODES[m]?.c || '--accent'; return `<button class="story" data-${kind}="${esc(id)}" aria-pressed="${kind === 'map' && state.lens === id}"><small style="color:var(${c})"><i style="background:var(${c})"></i>${esc(chip)}</small><span>“${esc(prompt)}”</span></button>`; }
function lensTitle() {
  if (state.lens.startsWith('place:')) { const ck = state.lens.slice(6); const p = D.people.find((x) => x.ck === ck); return ['Place', p ? p.city : 'Place']; }
  const s = curMap(); return s ? [s.chip || 'Map', s.title] : ['Map', ''];
}
function useIdea(i) {
  const inp = $('askIn'); const t = IDEAS[i][1]; inp.value = t; inp.focus();
  const gap = t.indexOf('  '); const pos = gap >= 0 ? gap + 1 : t.length; inp.setSelectionRange(pos, pos);
}
function bindBar() {
  document.querySelector('.top').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]'); if (m) { state.mode = m.dataset.mode; drawBar(); draw(); if (state.view === 'today') renderPanel(true); return; }
    const l = e.target.closest('[data-layer]'); if (l) { state.layers.disc = !state.layers.disc; drawBar(); draw(); return; }
    if (e.target.closest('#clearLens')) setLens(null);
  });
  $('strip').addEventListener('click', (e) => {
    const m = e.target.closest('[data-map]'); if (m) { openMap(m.dataset.map); return; }
    const i = e.target.closest('[data-idea]'); if (i) useIdea(+i.dataset.idea);
  });
  $('askForm').addEventListener('submit', (e) => {
    e.preventDefault(); const q = $('askIn').value.trim(); if (!q) return;
    const p = D.people.find((p) => p.n.toLowerCase() === q.toLowerCase()); if (p) { openPerson(p.id); return; }
    runAgent(q);
  });
}

/* ================= views ================= */
let runId = 0;
function setLens(id, { fly = true } = {}) {
  state.lens = id; state.lensAt = performance.now(); state.sel = null; state.hl = []; state.tab = 'today';
  state.view = id ? 'lens' : 'today';
  if (!id) $('askIn').value = '';
  drawBar(); draw(); renderPanel();
  if (!fly) return;
  if (!id) { flyWorld(); return; }
  if (id.startsWith('place:')) { const ck = id.slice(6); const p = D.people.find((x) => x.ck === ck); if (p) flyLL(p.lat, p.lng, cityZoom(p)); return; }
  const L = lensSet(); fitItems([...D.people, ...discItems()].filter((p) => L.has(p.id)));
}
function openMap(id) { runId++; $('askIn').value = D.maps[id]?.prompt || ''; setLens(id); }
function openPerson(id) {
  const p = byId(id); if (!p) return; runId++;
  state.back = state.view === 'person' ? state.back : { view: state.view, tab: state.tab };
  state.sel = id; state.selAt = performance.now(); state.view = 'person'; state.hl = []; state.tab = 'today'; state.edit = null; hideTip();
  if (mobile()) $('panel').classList.remove('big');
  draw(); renderPanel(); if (placed(p)) flyLL(p.lat, p.lng, cityZoom(p));
}
function goBack() {
  const b = state.back; state.sel = null; state.back = null; state.edit = null;
  if (b && b.tab === 'people') { state.tab = 'people'; state.view = 'today'; draw(); renderPanel(); return; }
  if (b && b.view === 'lens' && state.lens) { setLens(state.lens); return; }
  setLens(null);
}

/* ================= panel ================= */
let pb;
function avatar(p, size) {
  const c = size ? ' ' + size : '';
  if (p.t === 'disc') return `<span class="av disc${c}">${esc(p.g || '★')}</span>`;
  return `<span class="av${c}" style="background:${col(p)}">${esc(ini(p.n))}</span>`;
}
function allPlans() { const out = []; Object.values(D.maps).forEach((s) => (s.plans || []).forEach((p) => out.push({ ...p, mapId: s.id, planned: s.state?.[p.id]?.planned }))); return out; }
function navCount(tab) { return tab === 'people' ? D.people.length : tab === 'plans' ? allPlans().filter((p) => p.planned).length : 0; }
function renderTabs() {
  const cur = state.view === 'person' ? state.back?.tab || 'today' : state.tab;
  const ready = D.loaded && home();
  $('tabs').innerHTML = ready ? NAV.map((n) => { const c = navCount(n.tab); return `<button role="tab" data-tab="${n.tab}" aria-selected="${cur === n.tab}">${esc(n.label)}${c ? `<span class="badge">${c}</span>` : ''}</button>`; }).join('') + `<button class="add" data-act="add" aria-label="Add a person">${icon('plus', 18)}</button>` : '';
  document.querySelectorAll('.rail-item').forEach((b) => {
    const t = b.dataset.tab, c = navCount(t);
    b.setAttribute('aria-current', cur === t ? 'page' : 'false');
    b.disabled = !ready;
    b.querySelector('.badge')?.remove();
    if (c && t === 'plans') b.insertAdjacentHTML('beforeend', `<span class="badge">${c}</span>`);
  });
}
function renderSkeleton() {
  pb.innerHTML = `<div aria-busy="true" aria-label="Loading your network"><div class="sk t"></div><div class="sk s"></div><div class="sk c"></div>${'<div class="skrow"><span class="sk"></span><div><div class="sk l"></div><div class="sk l"></div></div></div>'.repeat(5)}</div>`;
}
function renderError() {
  const signin = typeof D.error === 'string';
  pb.innerHTML = `<div class="empty"><div class="ei">${icon('alert', 26)}</div><h3>${signin ? 'Sign in to use Sparkles' : 'We couldn’t load your network'}</h3><p>${signin ? esc(D.error) : 'Check your connection, then try again. Nothing you saved is lost.'}</p>${signin ? '' : `<button class="btn go" data-act="retry">Try again</button>`}</div>`;
}
function renderPanel(keepScroll?) {
  if (!keepScroll) pb.scrollTop = 0; renderTabs();
  if (!D.loaded) return D.error ? renderError() : renderSkeleton();
  if (!home()) return renderWelcome();
  if (state.view === 'person') return renderPerson();
  if (state.view === 'lens') return renderLens();
  if (state.tab === 'people') return renderPeople();
  if (state.tab === 'plans') return renderPlans();
  renderToday();
}
const firstName = () => (VIEWER.name || '').split(' ')[0];
const canSample = () => !!API.loadSample;
const isSampleP = (p) => (p.src || []).includes('Sample');
function sampleOption(primary = false) {
  return canSample() ? `<button class="option${primary ? ' primary' : ''}" data-act="sample"><span class="oi">${icon('sample', 20)}</span><div><b>Explore with sample people</b><small>28 people around the world. Remove them any time.</small></div></button>` : '';
}
function renderWelcome() {
  pb.innerHTML = `<div class="eb">${icon('spark', 14)}Welcome${firstName() ? ', ' + esc(firstName()) : ''}</div>
   <h2 class="greet">Put the people you care about on a map</h2>
   <p class="sub">Say what you want to do, and Sparkles finds the right people in your network and suggests a small next step.</p>
   <ol class="steps" aria-label="Step 1 of 3"><li class="on"></li><li></li><li></li></ol>
   <div class="steps-l"><span>Home city</span><span>Your people</span><span>First plan</span></div>
   <form class="form" id="homeForm"><label>Where do you live?<input id="homeCity" list="cityList" placeholder="City, for example Lisbon" autocomplete="off" required></label><button class="btn go lg block" type="submit">Continue</button></form>
   ${canSample() ? `<div class="or">or</div>${sampleOption()}` : ''}
   <p class="privacy">${icon('lock', 15)}<span>Your people, notes and maps are private to your account.</span></p>`;
}
const DAY = 864e5;
const since = (p) => (p.last ? (Date.now() - new Date(p.last).getTime()) / DAY : Infinity);
function addPeopleCard() {
  return `<div class="card hero"><ol class="steps" aria-label="Step 2 of 3" style="margin-top:0"><li class="on"></li><li class="on"></li><li></li></ol>
   <h3 style="margin-top:14px">Add your people</h3><p>Start with a few people who matter. You can import everyone else later.</p>
   <div class="options">
    <button class="option primary" data-act="add"><span class="oi">${icon('user', 20)}</span><div><b>Add a person</b><small>Name, city and a note about them</small></div></button>
    <button class="option" data-act="import"><span class="oi">${icon('upload', 20)}</span><div><b>Import a CSV</b><small>LinkedIn’s Connections.csv or any list with names</small></div></button>
    ${sampleOption()}
   </div></div>`;
}
function renderToday() {
  const ppl = D.people.filter((p) => state.mode === 'all' || p.m === state.mode), unpl = D.people.filter((p) => !placed(p)).length;
  const due = ppl.filter((p) => since(p) >= 45 && since(p) < Infinity).sort((a, b) => since(b) - since(a)).slice(0, 5);
  const recent = [...ppl].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 4);
  const saved = Object.values(D.maps).sort((a, b) => (b.at || 0) - (a.at || 0));
  const planned = allPlans().filter((p) => p.planned).sort((a, b) => b.planned - a.planned);
  const samples = D.people.filter(isSampleP).length;
  const cities = new Set(D.people.filter(placed).map((p) => p.ck)).size;
  pb.innerHTML = `
   <h2 class="greet">${greetWord()}${firstName() ? ', ' + esc(firstName()) : ''}</h2>
   <p class="sub">${esc(today())} · <button class="homechip" data-act="home" title="Change home city">${icon('pin', 14)}${esc(home().city)}</button></p>
   ${D.people.length === 0 ? addPeopleCard() : `<div class="tiles"><button class="tile" data-tab="people"><b>${D.people.length}</b><small>People</small></button><button class="tile" data-act="world"><b>${cities}</b><small>Cities</small></button><button class="tile" data-tab="plans"><b>${planned.length}</b><small>Plans</small></button></div>`}
   ${samples ? `<div class="banner">${icon('sample', 18)}<span>You’re exploring ${samples} sample people.</span><button class="btn sm ghost" data-act="clearsample">Remove</button></div>` : ''}
   ${unpl ? `<div class="card warn"><div class="cardhead">${icon('pin', 20)}<div><h3>${unpl} ${unpl === 1 ? 'person needs' : 'people need'} a city</h3><p>Add a city to put them on the map.</p><button class="btn sm go" data-act="place">Add cities</button></div></div></div>` : ''}
   ${planned.length ? `<div class="h4">Your plans<span class="cnt">${planned.length}</span></div>${planned.slice(0, 5).map(planRow).join('')}` : ''}
   ${due.length ? `<div class="h4">Reach out<span class="cnt">Longest since you talked</span></div>${due.map((p) => `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc(p.doing || [p.role, p.company].filter(Boolean).join(' · ') || p.city || '')}</small></div><span class="pill${since(p) > 120 ? ' warn' : ''}">${esc(ago(p.last))}</span></div>`).join('')}` : ''}
   <div class="h4">Ask Sparkles</div>
   <div class="tags">${IDEAS.map((x, i) => `<button class="tag" data-ideaq="${i}">${esc(x[1].replace(/\s+$/, '…'))}</button>`).join('')}</div>
   ${!D.ai ? `<p class="hint">${icon('spark', 14)}Offline suggestions: Sparkles matches your words to people’s notes and interests.</p>` : ''}
   ${saved.length ? `<div class="h4">Your maps<span class="cnt">${saved.length}</span></div>${saved.slice(0, 8).map((s) => `<div class="row" data-openmap="${esc(s.id)}"><span class="globe">${esc(ICONS.includes(s.plans?.[0]?.ic) ? s.plans[0].ic : '◎')}</span><div><b>${esc(s.title)}</b><small>“${esc(s.prompt)}”</small></div></div>`).join('')}` : ''}
   ${recent.length ? `<div class="h4">Recently added</div>${recent.map((p) => `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc([p.role, p.company].filter(Boolean).join(' · ') || 'No details yet')}</small></div><span class="when">${esc(p.city || 'No city')}</span></div>`).join('')}` : ''}`;
}
const planRow = (p) => `<div class="row" data-hl="${esc((p.with || []).join(','))}" data-openmap="${esc(p.mapId)}"><span class="av" style="background:var(--good)">${icon('check', 18)}</span><div><b>${esc(p.title)}</b><small>${esc(p.when || '')}${p.where ? ' · ' + esc(p.where) : ''}</small></div></div>`;
function planCard(p, mapId) {
  const b = !!D.maps[mapId]?.state?.[p.id]?.planned, w = (p.with || []).map(byId).filter(Boolean), d = state.drafts[p.id];
  return `<div class="plan${b ? ' booked' : ''}" data-hl="${esc((p.with || []).join(','))}" data-plan="${esc(p.id)}" data-pmap="${esc(mapId)}">
    <div class="pk"><span class="pic">${esc(ICONS.includes(p.ic) ? p.ic : '◎')}</span>${esc(p.kind || 'Plan')}<span class="wh">${esc(p.when || '')}</span></div>
    <b class="t">${esc(p.title)}</b>
    ${w.length ? `<div class="with"><span class="avs">${w.map((x) => avatar(x, 'xs')).join('')}</span>&nbsp;with ${esc(w.map(fn).join(' and '))}</div>` : ''}
    ${p.why ? `<div class="why">${esc(p.why)}</div>` : ''}
    ${p.where ? `<div class="where">${esc(p.where)}</div>` : ''}
    ${d ? `<div class="draft"><textarea id="draft-${esc(p.id)}" aria-label="Draft message">${esc(d.text)}</textarea><div class="btns" style="margin-top:0"><button class="btn sm" data-copy="${esc(p.id)}">Copy</button>${w[0]?.email ? `<span class="src" style="align-self:center;user-select:all">${esc(w[0].email)}</span>` : ''}${w[0]?.url ? `<a class="btn sm" href="${esc(w[0].url)}" target="_blank" rel="noopener">Open profile</a>` : ''}</div></div>` : ''}
    <div class="btns">${b ? `<button class="btn sm done" data-undo="${esc(p.id)}">✓ Planned</button>` : `<button class="btn sm go" data-draftp="${esc(p.id)}">${d ? 'Redraft' : 'Draft a message'}</button><button class="btn sm" data-book="${esc(p.id)}">Mark as planned</button>`}</div>
  </div>`;
}
function rowFor(id, why) {
  const p = byId(id); if (!p) return '';
  const sub = why || (p.t === 'disc' ? [p.k || 'Place', p.doing].filter(Boolean).join(' · ') : [p.role, p.company].filter(Boolean).join(' · '));
  return `<div class="row" data-person="${esc(id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc(sub)}</small></div><span class="when">${esc(p.city || '')}</span></div>`;
}
function renderLens() {
  if (state.lens.startsWith('place:')) {
    const ck = state.lens.slice(6), ppl = D.people.filter((p) => p.ck === ck), p0 = ppl[0];
    pb.innerHTML = `<button class="back" data-back>${icon('back', 16)}Today</button><div class="eb">Place</div><h2 class="greet">${esc(p0 ? p0.city : '')}</h2><p class="sub">${ppl.length} ${ppl.length === 1 ? 'person' : 'people'} you know.${p0 && p0.tz ? ' It is ' + esc(localTime(p0.tz)) + ' there now.' : ''}</p>
     <div class="h4">Who’s there</div>${ppl.map((p) => `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc(p.doing || [p.role, p.company].filter(Boolean).join(' · '))}</small></div></div>`).join('')}`;
    return;
  }
  const s = curMap(); if (!s) { setLens(null); return; }
  const c = MODES[s.m]?.c || '--accent';
  pb.innerHTML = `<button class="back" data-back>${icon('back', 16)}Today</button>
   <div class="eb"><i style="background:var(${c})"></i>${esc(s.chip || 'Map')}</div><h2 class="greet">${esc(s.title)}</h2><p class="sub">${esc(s.sub || '')}</p>
   ${(s.plans || []).length ? `<div class="h4">Suggested plans<span class="cnt">${s.plans.length}</span></div>${s.plans.map((p) => planCard(p, s.id)).join('')}` : ''}
   ${(s.sec || []).map(secOf).map(([h, ids = [], why, note]) => { const rows = ids.map((id) => rowFor(id, why && why[id])).join(''); return rows ? `<div class="h4">${esc(h)}<span class="cnt">${ids.length}</span></div>${note ? `<p class="optin">${esc(note)}</p>` : ''}${rows}` : ''; }).join('')}
   ${(s.disc || []).length ? `<p class="optin" style="margin-top:8px">Places are suggested by AI from general knowledge. Check details before you go.</p>` : ''}
   <div class="btns" style="margin-top:16px"><button class="btn sm" data-rerun="${esc(s.id)}">Map it again</button><button class="btn sm ghost" data-delmap="${esc(s.id)}">Delete this map</button></div>
   ${state.confirm === 'map:' + s.id ? `<div class="confirm">Delete “${esc(s.title)}”? Your people stay.<div class="btns"><button class="btn sm danger" data-delmap-yes="${esc(s.id)}">Delete</button><button class="btn sm" data-cancel>Keep it</button></div></div>` : ''}`;
}
function renderPlans() {
  const list = allPlans().filter((p) => p.planned).sort((a, b) => b.planned - a.planned);
  pb.innerHTML = `<h2 class="greet">Plans</h2><p class="sub">Plans you’ve marked from your maps.</p>
   ${list.length ? `<div class="h4">Planned<span class="cnt">${list.length}</span></div>` + list.map(planRow).join('') : `<div class="empty"><div class="ei">${icon('plans', 26)}</div><h3>No plans yet</h3><p>Tell Sparkles what you want to do. It suggests small plans with people you know, and you mark the ones you’ll do.</p><button class="btn go" data-ideaq="3">Who should I catch up with?</button></div>`}`;
}
function circleOptions(sel, withNone = true) {
  return (withNone ? `<option value=""${!sel ? ' selected' : ''}>No circle</option>` : '') + D.circles.map((c) => `<option value="${esc(c.id)}"${sel === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
}
function renderPeople() {
  if (state.edit) return renderEdit();
  const q = state.pq.toLowerCase();
  let list = D.people;
  if (state.pf === 'unplaced') list = list.filter((p) => !placed(p));
  if (state.mode !== 'all') list = list.filter((p) => p.m === state.mode);
  if (q) list = list.filter((p) => [p.n, p.role, p.company, p.city, (p.tags || []).join(' '), p.note].join(' ').toLowerCase().includes(q));
  list = [...list].sort((a, b) => String(a.n).localeCompare(String(b.n)));
  const unpl = D.people.filter((p) => !placed(p)).length;
  const emptyList = !D.people.length
    ? `<div class="empty"><div class="ei">${icon('people', 26)}</div><h3>No one here yet</h3><p>Add the people you want to stay close to, or import a list.</p><div class="btns" style="justify-content:center"><button class="btn go" data-act="add">Add a person</button><button class="btn" data-act="import">Import a CSV</button></div>${canSample() ? `<div class="btns" style="justify-content:center"><button class="btn ghost sm" data-act="sample">Or explore sample people</button></div>` : ''}</div>`
    : `<div class="empty"><div class="ei">${icon('search', 26)}</div><h3>No one matches</h3><p>Try a name, a company, a city or an interest.</p></div>`;
  pb.innerHTML = `<div class="headrow"><div><h2 class="greet">People</h2><p class="sub">${D.people.length} ${D.people.length === 1 ? 'person' : 'people'}${state.mode !== 'all' && MODES[state.mode] ? ' · showing ' + esc(MODES[state.mode].l) : ''}</p></div><button class="btn go" data-act="add">${icon('plus', 16)}Add</button></div>
   ${D.people.length ? `<div class="search" style="margin-top:16px"><label class="sbox">${icon('search', 16)}<input id="pq" type="search" placeholder="Search names, companies, cities, interests" value="${esc(state.pq)}" aria-label="Search people"></label></div>
   <div class="pfilter"><button data-pf="all" aria-pressed="${state.pf === 'all'}">All ${D.people.length}</button>${unpl ? `<button data-pf="unplaced" aria-pressed="${state.pf === 'unplaced'}">Need a city ${unpl}</button>` : ''}</div>` : ''}
   ${state.pf === 'unplaced' && unpl ? `<p class="optin">Type a city and press Enter to put someone on the map.</p>` : ''}
   ${list.slice(0, state.plimit).map((p) => `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc([p.role, p.company].filter(Boolean).join(' · ') || (p.tags || []).join(', ') || circleOf(p)?.l || 'No details yet')}</small></div>${!placed(p) ? `<span class="place"><input data-placeid="${esc(p.id)}" list="cityList" placeholder="Add city" aria-label="City for ${esc(p.n)}"></span>` : `<span class="when">${esc(p.city || '')}</span>`}</div>`).join('') || emptyList}
   ${list.length > state.plimit ? `<div class="btns"><button class="btn sm" data-act="more">Show more (${list.length - state.plimit})</button></div>` : ''}
   <div class="h4">Import</div>
   <div class="form" style="margin-top:0"><label>Put imported people in<select id="impCircle">${circleOptions(state.importCircle)}</select></label></div>
   <div class="btns"><button class="btn sm" data-act="import">Import a CSV</button></div>
   <p class="optin" style="margin-top:8px">Reads LinkedIn’s Connections.csv, or any CSV with a Name (or First Name and Last Name) column, plus optional City, Company, Title, Email, URL, Notes and Interests.</p>
   <div class="h4">Circles</div>
   <p class="optin">Group people your own way. Rename, recolor or add circles.</p>
   ${D.circles.map((c, i) => `<div class="c-edit"><button class="c-dot" style="background:var(--c${c.color})" data-ccolor="${i}" aria-label="Change color of ${esc(c.label)}"></button><input data-clabel="${i}" value="${esc(c.label)}" maxlength="24" aria-label="Circle name"><button class="btn sm ghost" data-cdel="${i}">Remove</button></div>`).join('')}
   <div class="btns">${D.circles.length < 12 ? `<button class="btn sm" data-act="addcircle">Add a circle</button>` : ''}</div>
   <div class="h4">Settings</div>
   <div class="btns"><button class="btn sm" data-act="home">${icon('pin', 16)}Home: ${esc(home().city)}</button>${D.people.some(isSampleP) ? `<button class="btn sm" data-act="clearsample">Remove sample people</button>` : ''}${D.people.length ? `<button class="btn sm ghost" data-act="wipe">Remove everyone</button>` : ''}</div>
   ${state.confirm === 'wipe' ? `<div class="confirm">Remove all ${D.people.length} people? Your maps stay. This can’t be undone.<div class="btns"><button class="btn sm danger" data-act="wipe-yes">Remove everyone</button><button class="btn sm" data-cancel>Cancel</button></div></div>` : ''}
   ${state.confirm === 'home' ? `<form class="form" id="homeForm"><label>Home city<input id="homeCity" list="cityList" value="${esc(home().city)}" autocomplete="off" required></label><div class="btns" style="margin-top:0"><button class="btn sm go" type="submit">Save</button><button class="btn sm" type="button" data-cancel>Cancel</button></div></form>` : ''}`;
  const inp = $('pq'); inp?.addEventListener('input', () => { state.pq = inp.value; state.plimit = 60; const pos = inp.selectionStart; renderPanel(true); const n = $('pq'); n.focus(); n.setSelectionRange(pos, pos); });
  $('impCircle').addEventListener('change', (e) => (state.importCircle = e.target.value));
}
function renderEdit() {
  const p = state.edit.id ? byId(state.edit.id) : null, v = p || { m: state.mode !== 'all' ? state.mode : '' };
  const cityVal = v.city ? v.city + (v.country ? ', ' + v.country : '') : '';
  pb.innerHTML = `<button class="back" data-back-edit>${icon('back', 16)}${p ? esc(fn(p)) : 'Cancel'}</button>
   <h2 class="greet">${p ? 'Edit ' + esc(fn(p)) : 'Add a person'}</h2>
   <p class="sub">${p ? 'Changes save to your private map.' : 'Only a name is required. Add a city to put them on the map.'}</p>
   <form class="form" id="personForm" novalidate>
    <label>Name<input id="f-n" value="${esc(v.n || '')}" required maxlength="120" autocomplete="off" placeholder="Full name"><span class="err" id="e-n" hidden>Add a name to save.</span></label>
    <label>City<input id="f-city" list="cityList" value="${esc(cityVal)}" placeholder="City, Country" autocomplete="off"><span id="cityHint" class="${cityVal ? 'ok' : 'err'}"${cityVal ? '' : ' hidden'}>${cityVal ? icon('check', 13) + 'On the map' : ''}</span></label>
    <div class="lbl">Circle<div class="cpick" role="radiogroup" aria-label="Circle">
      <label><input type="radio" name="f-m" value=""${!v.m ? ' checked' : ''}><i></i>None</label>
      ${D.circles.map((c) => `<label><input type="radio" name="f-m" value="${esc(c.id)}"${v.m === c.id ? ' checked' : ''}><i style="background:var(--c${c.color})"></i>${esc(c.label)}</label>`).join('')}
    </div></div>
    <div class="fsec"><h5>What you know</h5>
     <div class="two"><label>Role<input id="f-role" value="${esc(v.role || '')}" autocomplete="off" placeholder="Designer"></label><label>Company<input id="f-company" value="${esc(v.company || '')}" autocomplete="off"></label></div>
     <label>Interests <small>comma separated</small><input id="f-tags" value="${esc((v.tags || []).join(', '))}" autocomplete="off" placeholder="jazz, climbing, fundraising"></label>
     <label>What they’re up to<input id="f-doing" value="${esc(v.doing || '')}" autocomplete="off" placeholder="Training for a marathon"></label>
     <label>Your notes<textarea id="f-note" placeholder="How you met, what you talked about, what you promised">${esc(v.note || '')}</textarea></label>
    </div>
    <div class="fsec"><h5>Keeping in touch</h5>
     <div class="two"><label>Last talked<input id="f-last" type="date" value="${esc((v.last || '').slice(0, 10))}" max="${new Date().toISOString().slice(0, 10)}"></label><label>Email<input id="f-email" type="email" value="${esc(v.email || '')}" autocomplete="off"></label></div>
     <label>Profile link<input id="f-url" value="${esc(v.url || '')}" placeholder="https://" autocomplete="off"></label>
    </div>
    ${p && state.confirm === 'del:' + p.id ? `<div class="confirm">Delete ${esc(p.n)}? This can’t be undone.<div class="btns"><button class="btn sm danger solid" type="button" data-delp-yes="${esc(p.id)}">Delete</button><button class="btn sm" type="button" data-cancel>Keep</button></div></div>` : ''}
    <div class="formbar">${p ? `<button class="btn ghost danger-text" type="button" data-delp="${esc(p.id)}">Delete</button>` : ''}<span class="sp"></span><button class="btn" type="button" data-back-edit>Cancel</button><button class="btn go" type="submit" id="saveBtn">${p ? 'Save changes' : 'Add to map'}</button></div>
   </form>`;
  const ci = $('f-city'), hint = $('cityHint');
  ci.addEventListener('input', () => {
    const q = ci.value.trim(); hint.hidden = !q;
    if (!q) return;
    const hit = findCity(q);
    hint.className = hit ? 'ok' : 'hint';
    hint.innerHTML = hit ? `${icon('check', 13)}${esc(hit.city)}, ${esc(hit.country)}` : 'We’ll look this up when you save.';
  });
  $('f-n').addEventListener('input', (e) => { if (e.target.value.trim()) { e.target.removeAttribute('aria-invalid'); $('e-n').hidden = true; } });
}
function renderPerson() {
  const p = byId(state.sel); if (!p) { goBack(); return; }
  const back = state.back && state.back.view === 'lens' && state.lens ? lensTitle()[1] : state.back && state.back.tab === 'people' ? 'People' : state.back && state.back.tab === 'plans' ? 'Plans' : 'Today';
  const backBtn = `<button class="back" data-back>${icon('back', 16)}${esc(back)}</button>`;
  if (p.t === 'disc') {
    pb.innerHTML = `${backBtn}<div class="phead">${avatar(p, 'lg')}<div><h3>${esc(p.n)}</h3><p>${esc(p.k || 'Place')}${p.city ? ' · ' + esc(p.city) : ''}</p></div></div>
     ${p.doing ? `<div class="now"><span>About</span><p>${esc(p.doing)}</p></div>` : ''}
     <p class="optin" style="margin-top:12px">Suggested by AI from general knowledge. Check dates, hours and details before you go.</p>`;
    return;
  }
  const c = circleOf(p), d = since(p);
  pb.innerHTML = `${backBtn}
   <div class="phead">${avatar(p, 'lg')}<div style="flex:1;min-width:0"><h3>${esc(p.n)}</h3><p>${esc([p.role, p.company].filter(Boolean).join(' · ') || 'No role yet')}</p>
    <div class="chips">${c ? `<span class="tag"><i style="background:var(${c.c})"></i>${esc(c.l)}</span>` : ''}${p.city ? `<span class="tag">${icon('pin', 13)}${esc(p.city)}</span>` : `<button class="tag" data-editp="${esc(p.id)}">${icon('pin', 13)}Add a city</button>`}${isSampleP(p) ? `<span class="tag">Sample</span>` : ''}</div></div>
    <button class="iconbtn" data-editp="${esc(p.id)}" title="Edit ${esc(fn(p))}" aria-label="Edit ${esc(p.n)}" style="align-self:flex-start">${icon('edit', 18)}</button></div>
   <div class="actions"><button class="btn go sm" data-nextstep="${esc(p.id)}">${icon('spark', 16)}${p.next ? 'Another idea' : 'Suggest a next step'}</button><button class="btn sm" data-talked="${esc(p.id)}">${icon('check', 16)}We talked today</button></div>
   <div class="facts"><div>Where<b>${esc(p.city || 'Not set')}</b></div><div>Their time<b>${esc(localTime(p.tz) || '–')}</b></div><div class="${d > 120 && d < Infinity ? 'warn' : ''}">Last talked<b>${esc(p.last ? (d < 1 ? 'Today' : ago(p.last) + ' ago') : 'Not logged')}</b></div></div>
   ${p.next ? `<div class="ai" style="margin-top:16px"><b>${icon('spark', 14)}Next step</b><span id="nextText">${esc(p.next)}</span></div>` : `<div id="nextText" class="sr"></div>`}
   ${p.doing ? `<div class="now"><span>Right now</span><p>${esc(p.doing)}</p></div>` : ''}
   ${p.tags && p.tags.length ? `<div class="h4">Interests</div><div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
   <div class="h4">Your notes${p.note ? '' : `<button class="lnk" data-editp="${esc(p.id)}">Add a note</button>`}</div>${p.note ? `<div class="note">${esc(p.note)}</div>` : `<p class="optin">What you talked about, what you promised, what they care about.</p>`}
   ${p.url || p.email || (p.src || []).length ? `<div class="h4">Details</div><div class="tags">${p.email ? `<a class="tag" href="mailto:${esc(p.email)}">${icon('mail', 13)}${esc(p.email)}</a>` : ''}${p.url ? `<a class="tag" href="${esc(p.url)}" target="_blank" rel="noopener">Profile ↗</a>` : ''}${(p.src || []).filter((s) => s !== 'Sample').map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}`;
}


/* ================= panel events ================= */
function toastErr(e) { console.warn(e); toast(e?.status === 401 ? 'Your session ended. Reload and sign in again.' : e?.message && e.status && e.status < 500 ? e.message : 'Couldn’t save. Check your connection and try again.', { kind: 'err' }); }
function goTab(tab) {
  if (!D.loaded || !home()) return;
  runId++; state.tab = tab; state.edit = null; state.confirm = null; state.sel = null; state.hl = [];
  if (state.view !== 'today') { state.view = 'today'; if (state.lens) { state.lens = null; drawBar(); } }
  if (mobile()) $('panel').classList.add('big');
  draw(); renderPanel();
}
function bindPanel() {
  pb = $('pbody');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { goTab(b.dataset.tab); return; }
    const a = e.target.closest('[data-act]');
    if (a && !pb.contains(a)) act(a.dataset.act);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target.closest?.('#askForm')) return;
    if (state.edit) { pb.querySelector('[data-back-edit]')?.click(); return; }
    if (state.confirm) { state.confirm = null; renderPanel(true); return; }
    if (state.view === 'person' || state.view === 'lens') goBack();
  });
  pb.addEventListener('click', async (e) => {
    const t = e.target;
    const bk = t.closest('[data-book]'); if (bk) { bookPlan(bk.closest('.plan'), true); return; }
    const ud = t.closest('[data-undo]'); if (ud) { bookPlan(ud.closest('.plan'), false); return; }
    const dp = t.closest('[data-draftp]'); if (dp) { draftPlan(dp.closest('.plan')); return; }
    const cp = t.closest('[data-copy]'); if (cp) { const ta = $('draft-' + cp.dataset.copy); try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch { ta.select(); toast('Selected. Press Ctrl+C or ⌘C to copy'); } return; }
    const om = t.closest('[data-openmap]'); if (om) { openMap(om.dataset.openmap); return; }
    const iq = t.closest('[data-ideaq]'); if (iq) { useIdea(+iq.dataset.ideaq); return; }
    if (t.closest('[data-back]')) { goBack(); return; }
    if (t.closest('[data-back-edit]')) { const id = state.edit && state.edit.id, from = state.edit?.from; state.edit = null; state.confirm = null; if (id) { state.view = 'person'; state.sel = id; } else if (from) state.tab = from; draw(); renderPanel(); return; }
    if (t.closest('[data-cancel]')) { state.confirm = null; renderPanel(true); return; }
    const a = t.closest('[data-act]'); if (a) { act(a.dataset.act); return; }
    const pf = t.closest('[data-pf]'); if (pf) { state.pf = pf.dataset.pf; state.plimit = 60; renderPanel(); return; }
    const ep = t.closest('[data-editp]'); if (ep) { state.edit = { id: ep.dataset.editp }; state.view = 'today'; state.tab = 'people'; state.back = { tab: 'people' }; renderPanel(); return; }
    const dl = t.closest('[data-delp]'); if (dl) { state.confirm = 'del:' + dl.dataset.delp; renderPanel(true); return; }
    const dly = t.closest('[data-delp-yes]'); if (dly) { removePerson(dly.dataset.delpYes); return; }
    const ns = t.closest('[data-nextstep]'); if (ns) { nextStep(ns.dataset.nextstep, ns); return; }
    const tk = t.closest('[data-talked]'); if (tk) { const p = { ...byId(tk.dataset.talked), last: new Date().toISOString() }; try { await savePeople([p]); toast('Logged. Last talked: today'); renderPanel(true); } catch (err) { toastErr(err); } return; }
    const rr = t.closest('[data-rerun]'); if (rr) { const m = D.maps[rr.dataset.rerun]; runAgent(m.prompt, m.id); return; }
    const dm = t.closest('[data-delmap]'); if (dm) { state.confirm = 'map:' + dm.dataset.delmap; renderPanel(true); return; }
    const dmy = t.closest('[data-delmap-yes]'); if (dmy) { const id = dmy.dataset.delmapYes; try { await API.deleteMap(id); delete D.maps[id]; state.confirm = null; reindex(); setLens(null); toast('Map deleted'); } catch (err) { toastErr(err); } return; }
    const cc = t.closest('[data-ccolor]'); if (cc) { const c = D.circles[+cc.dataset.ccolor]; c.color = (c.color + 1) % 8; saveCircles(); return; }
    const cd = t.closest('[data-cdel]'); if (cd) { D.circles.splice(+cd.dataset.cdel, 1); saveCircles(); return; }
    if (t.closest('input,select,textarea,a')) return;
    const pr = t.closest('[data-person]'); if (pr) { openPerson(pr.dataset.person); return; }
  });
  pb.addEventListener('change', (e) => { const l = e.target.closest('[data-clabel]'); if (l) { const v = l.value.trim(); if (v) { D.circles[+l.dataset.clabel].label = v.slice(0, 24); saveCircles(); } } });
  pb.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-placeid]')) {
      e.preventDefault(); const inp = e.target; const p = byId(inp.dataset.placeid); inp.disabled = true;
      const loc = await resolveCity(inp.value); inp.disabled = false;
      if (!loc) { toast('Couldn’t find that city. Try “City, Country”.'); inp.focus(); return; }
      try { await savePeople([{ ...p, ...loc }]); toast(`${fn(p)} is on the map in ${loc.city}`); draw(); renderPanel(true); } catch (err) { toastErr(err); }
      return;
    }
    if (e.key === 'Enter' && e.target.matches('.row[tabindex]')) e.target.click();
  });
  pb.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'homeForm') {
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const loc = await resolveCity($('homeCity').value); btn.disabled = false;
      if (!loc) { toast('Couldn’t find that city. Try “City, Country”.'); return; }
      try { const r = await API.saveProfile({ home: loc, circles: D.circles }); D.profile = { ...(D.profile || {}), home: r.home }; setCircles(r.circles); state.confirm = null; drawBar(); draw(); renderPanel(); flyLL(loc.lat, loc.lng, 3); toast(`Home set to ${loc.city}`); } catch (err) { toastErr(err); }
      return;
    }
    if (e.target.id === 'personForm') savePersonForm();
  });
  pb.addEventListener('mouseover', (e) => { const r = e.target.closest('[data-person],[data-hl]'); const ids = r ? (r.dataset.person ? [r.dataset.person] : (r.dataset.hl || '').split(',').filter(Boolean)) : []; if (ids.join() !== state.hl.join()) { state.hl = ids; draw(); } });
  pb.addEventListener('mouseleave', () => { if (state.hl.length) { state.hl = []; draw(); } });
  $('handle').onclick = () => $('panel').classList.toggle('big');
  $('csvIn').addEventListener('change', importCsv);
}
let circleTimer;
function saveCircles() {
  setCircles(D.circles); drawBar(); draw(); renderPanel(true);
  clearTimeout(circleTimer);
  circleTimer = setTimeout(async () => { try { const r = await API.saveProfile({ circles: D.circles }); setCircles(r.circles); } catch (err) { toastErr(err); } }, 500);
}
async function savePeople(list) {
  await API.savePeople(list);
  for (const p of list) { const i = D.people.findIndex((x) => x.id === p.id); if (i >= 0) D.people[i] = p; else D.people.push(p); }
  reindex();
}
async function act(a) {
  if (a === 'import') { $('csvIn').click(); return; }
  if (a === 'add') { if (!D.loaded || !home()) return; state.edit = { id: null, from: state.view === 'today' ? state.tab : 'people' }; state.tab = 'people'; state.view = 'today'; state.sel = null; if (mobile()) $('panel').classList.add('big'); draw(); renderPanel(); setTimeout(() => $('f-n')?.focus(), 0); return; }
  if (a === 'place') { state.tab = 'people'; state.pf = 'unplaced'; state.view = 'today'; state.sel = null; draw(); renderPanel(); return; }
  if (a === 'more') { state.plimit += 100; renderPanel(true); return; }
  if (a === 'home') { state.tab = 'people'; state.view = 'today'; state.confirm = 'home'; renderPanel(); setTimeout(() => { $('homeForm')?.scrollIntoView({ block: 'center' }); $('homeCity')?.select(); }, 0); return; }
  if (a === 'world') { flyWorld(); return; }
  if (a === 'retry') { D.error = false; renderPanel(); await loadAll(); return; }
  if (a === 'sample') {
    pb.querySelectorAll('[data-act="sample"]').forEach((b) => { b.disabled = true; b.style.opacity = '.6'; });
    try { const r = await API.loadSample(); await loadAll(); state.tab = 'today'; state.view = 'today'; renderPanel(); if (r.home) flyWorld(); toast(`Added ${r.added} sample people`, { action: { label: 'Undo', run: () => act('clearsample') } }); }
    catch (err) { renderPanel(true); toastErr(err); }
    return;
  }
  if (a === 'clearsample') { try { const r = await API.clearSample(); D.people = D.people.filter((p) => !isSampleP(p)); reindex(); draw(); drawBar(); renderPanel(true); toast(`Removed ${r.removed} sample people`); } catch (err) { toastErr(err); } return; }
  if (a === 'wipe') { state.confirm = 'wipe'; renderPanel(true); return; }
  if (a === 'wipe-yes') { try { await API.deleteAllPeople(); D.people = []; state.confirm = null; reindex(); draw(); renderPanel(); toast('Everyone removed'); } catch (err) { toastErr(err); } return; }
  if (a === 'addcircle') { const used = new Set(D.circles.map((c) => c.id)); let n = 1; while (used.has('c' + n)) n++; D.circles.push({ id: 'c' + n, label: 'New circle', color: D.circles.length % 8 }); saveCircles(); setTimeout(() => { const l = document.querySelector(`[data-clabel="${D.circles.length - 1}"]`); l?.focus(); l?.select(); }, 0); }
}
async function savePersonForm() {
  const g = (id) => $(id).value.trim();
  if (!g('f-n')) { const n = $('f-n'); n.setAttribute('aria-invalid', 'true'); $('e-n').hidden = false; n.focus(); return; }
  const btn = $('saveBtn'); btn.disabled = true; btn.classList.add('busy');
  const fail = (msg?) => { btn.disabled = false; btn.classList.remove('busy'); if (msg) toast(msg, { kind: 'err' }); };
  const existing = state.edit.id ? byId(state.edit.id) : null;
  const p = existing ? { ...existing } : { id: 'p' + uid8(), added: Date.now(), src: ['Added by you'] };
  const circle = document.querySelector('input[name="f-m"]:checked')?.value || '';
  Object.assign(p, { n: g('f-n'), m: circle, role: g('f-role'), company: g('f-company'), doing: g('f-doing'), note: g('f-note'), url: g('f-url'), email: g('f-email') });
  p.tags = g('f-tags').split(',').map((s) => s.trim()).filter(Boolean);
  const last = g('f-last'); p.last = last ? new Date(last + 'T12:00:00').toISOString() : '';
  const cityIn = g('f-city');
  if (cityIn && cityIn !== (existing && existing.city ? existing.city + (existing.country ? ', ' + existing.country : '') : '')) {
    const loc = await resolveCity(cityIn);
    if (!loc) { fail(); const h = $('cityHint'); h.hidden = false; h.className = 'err'; h.textContent = 'We couldn’t find that city. Try “City, Country”.'; $('f-city').setAttribute('aria-invalid', 'true'); $('f-city').focus(); return; }
    Object.assign(p, loc);
  }
  if (!cityIn) ['city', 'cc', 'country', 'lat', 'lng', 'tz', 'ck'].forEach((k) => delete p[k]);
  try { await savePeople([p]); } catch (err) { fail(); toastErr(err); return; }
  state.edit = null; drawBar(); toast(existing ? 'Saved' : `${fn(p)} is ${placed(p) ? 'on your map' : 'saved. Add a city to place them'}`); openPerson(p.id);
}
async function removePerson(id) {
  try { await API.deletePerson(id); } catch (err) { toastErr(err); return; }
  D.people = D.people.filter((p) => p.id !== id);
  state.confirm = null; state.edit = null; state.sel = null; state.view = 'today'; state.tab = 'people'; reindex(); draw(); renderPanel(); toast('Deleted');
}
async function resolveCity(q) {
  q = (q || '').trim(); if (!q) return null;
  const hit = findCity(q); if (hit) return hit;
  try { const r = await API.geocode(q); return r.place || null; } catch { return null; }
}

/* ================= CSV import ================= */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
async function importCsv(e) {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 10e6) { toast('That file is too large. Import up to 10 MB at a time.'); return; }
  const rows = parseCSV(await file.text());
  const hi = rows.findIndex((r) => r.some((c) => /^(first name|name|full name)$/i.test(c.trim())));
  if (hi < 0) { toast('Couldn’t find a “Name” or “First Name” column'); return; }
  const H = rows[hi].map((c) => c.trim().toLowerCase()); const colI = (...ns) => { for (const n of ns) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const cF = colI('first name'), cL = colI('last name'), cN = colI('name', 'full name'), cC = colI('company', 'organization'), cP = colI('position', 'title', 'job title', 'role'), cU = colI('url', 'profile url', 'linkedin', 'website'), cE = colI('email address', 'email', 'e-mail'), cD = colI('connected on'), cCity = colI('city', 'location'), cNote = colI('notes', 'note'), cTags = colI('interests', 'tags');
  const seen = new Set(D.people.map((p) => (p.url || p.n).toLowerCase()));
  const src = cD >= 0 ? 'LinkedIn' : 'Imported';
  const add = []; let unknownCity = 0;
  for (const r of rows.slice(hi + 1)) {
    const n = (cN >= 0 ? r[cN] || '' : [r[cF], r[cL]].filter(Boolean).join(' ')).trim(); if (!n) continue;
    const url = cU >= 0 ? (r[cU] || '').trim() : ''; const key = (url || n).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    const p = { id: 'p' + uid8(), n: n.slice(0, 120), m: state.importCircle || '', role: cP >= 0 ? (r[cP] || '').trim() : '', company: cC >= 0 ? (r[cC] || '').trim() : '', url: /^https?:\/\//.test(url) ? url : '', email: cE >= 0 ? (r[cE] || '').trim() : '', src: [src], added: Date.now() };
    if (cD >= 0 && r[cD]) { const d = new Date(r[cD]); if (!isNaN(d)) p.connected = d.toISOString(); }
    if (cNote >= 0 && r[cNote]) p.note = r[cNote].trim();
    if (cTags >= 0 && r[cTags]) p.tags = r[cTags].split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    if (cCity >= 0 && r[cCity]) { const loc = findCity(r[cCity]); if (loc) Object.assign(p, loc); else unknownCity++; }
    add.push(p);
  }
  if (!add.length) { toast('No new people found in that file'); return; }
  toast(`Importing ${add.length} people…`);
  try { for (let i = 0; i < add.length; i += 1000) await API.savePeople(add.slice(i, i + 1000)); }
  catch (err) { toastErr(err); const fresh = await API.load().catch(() => null); if (fresh) { D.people = fresh.people; reindex(); draw(); renderPanel(); } return; }
  D.people.push(...add); reindex(); draw(); state.tab = 'today'; state.view = 'today'; renderPanel(); drawBar();
  toast(`Imported ${add.length} people${unknownCity ? `. ${unknownCity} cities weren’t recognized` : ''}`);
}

/* ================= AI ================= */
async function runAgent(prompt, reuseId?) {
  if (!home()) { renderPanel(); toast('Set your home city first'); return; }
  const my = ++runId; state.sel = null; state.hl = []; state.view = 'loading';
  if (mobile()) $('panel').classList.remove('big');
  pb.scrollTop = 0; renderTabs();
  pb.innerHTML = `<div class="eb">Thinking</div><h2 class="greet">“${esc(prompt)}”</h2><ul class="think" id="think"></ul><div class="btns"><button class="btn sm" id="stopBtn">Stop</button></div>`;
  const th = $('think');
  const steps = [`Reading your network (${D.people.length} people)`, 'Looking for the right people and places', 'Suggesting small plans'];
  let si = 0; const addStep = () => { if (si < steps.length && my === runId) { th.lastElementChild?.classList.remove('wait'); th.insertAdjacentHTML('beforeend', `<li class="wait">${esc(steps[si++])}</li>`); } };
  addStep(); const timer = setInterval(addStep, 1800);
  const ctl = new AbortController(); $('stopBtn').onclick = () => ctl.abort();
  let r = null;
  try { r = await API.createMap(prompt, reuseId, ctl.signal); }
  catch (err) { clearInterval(timer); if (my !== runId) return; state.view = 'today'; renderPanel(); if (err.name !== 'AbortError') toastErr(err); return; }
  clearInterval(timer); if (my !== runId) return;
  if (r.fallback && D.ai) toast('AI didn’t answer, so Sparkles matched by keywords');
  D.maps[r.map.id] = r.map; reindex();
  th.lastElementChild?.classList.remove('wait'); await sleep(250); if (my !== runId) return;
  setLens(r.map.id);
}
async function draftPlan(card) {
  const pid = card.dataset.plan, mid = card.dataset.pmap;
  state.drafts[pid] = { text: 'Writing…' }; renderPanel(true);
  try { const r = await API.draft(mid, pid); state.drafts[pid] = { text: r.text }; }
  catch (err) { delete state.drafts[pid]; toastErr(err); }
  renderPanel(true);
}
async function bookPlan(card, on) {
  const pid = card.dataset.plan, mid = card.dataset.pmap, m = D.maps[mid];
  const st = { ...(m.state || {}) }; if (on) st[pid] = { planned: Date.now() }; else delete st[pid];
  const prev = m.state; m.state = st;
  const pl = m.plans.find((p) => p.id === pid);
  const tmp = document.createElement('div'); tmp.innerHTML = planCard(pl, mid); card.replaceWith(tmp.firstElementChild); renderTabs();
  try { await API.saveMapState(mid, st); if (on) toast('Added to your plans'); } catch (err) { m.state = prev; renderPanel(true); toastErr(err); }
}
async function nextStep(id, btn?) {
  if (btn) { btn.classList.add('busy'); btn.disabled = true; }
  try { const r = await API.next(id); const p = byId(id); p.next = r.text; renderPanel(true); }
  catch (err) { if (btn) { btn.classList.remove('busy'); btn.disabled = false; } toastErr(err); }
}

/* ================= toast ================= */
let tt;
function toast(m, opts: { kind?: 'ok' | 'err'; action?: { label: string; run: () => void } } = {}) {
  const l = $('layer'); l.querySelector('.toast')?.remove();
  const d = document.createElement('div'); d.className = 'toast' + (opts.kind === 'err' ? ' err' : ''); d.setAttribute('role', opts.kind === 'err' ? 'alert' : 'status');
  d.innerHTML = icon(opts.kind === 'err' ? 'alert' : 'check', 16) + `<span>${esc(m)}</span>` + (opts.action ? `<button type="button">${esc(opts.action.label)}</button>` : '');
  if (opts.action) d.querySelector('button').onclick = () => { d.remove(); opts.action.run(); };
  l.appendChild(d); clearTimeout(tt); tt = setTimeout(() => d.remove(), opts.action ? 6000 : 3200);
}

/* ================= account ================= */
function renderAccount() {
  const who = VIEWER.name || VIEWER.email || 'You';
  const ini2 = who.split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'Y';
  document.querySelectorAll('[data-acct]').forEach((el) => (el.innerHTML = `<div class="acct"><button class="acct-btn" aria-haspopup="menu" aria-expanded="false" title="Account">${esc(ini2)}</button></div>`));
}
function accountMenu() {
  const samples = D.people.some(isSampleP);
  const where = VIEWER.mode === 'local' ? 'Local mode' : VIEWER.mode === 'claude' ? 'Signed in with Claude' : VIEWER.email;
  return `<div class="menu float" role="menu">
    <div class="who"><b>${esc(VIEWER.name || 'Your account')}</b><small>${esc(where || '')}</small></div>
    ${VIEWER.admin && VIEWER.mode === 'supabase' ? `<a href="/admin" role="menuitem">${icon('mail', 18)}Invite people</a>` : ''}
    ${canSample() && D.loaded && home() ? (samples ? `<button role="menuitem" data-act="clearsample">${icon('sample', 18)}Remove sample people</button>` : `<button role="menuitem" data-act="sample">${icon('sample', 18)}Load sample people</button>`) : ''}
    ${VIEWER.mode === 'supabase' ? `<form action="/auth/signout" method="post"><button type="submit" role="menuitem">${icon('logout', 18)}Sign out</button></form>` : ''}
    ${VIEWER.mode === 'local' ? `<p class="note">Your data is saved on this computer in the .data folder. Add Supabase keys to sign in and invite people.</p>` : ''}
  </div>`;
}
function closeMenus() { document.querySelectorAll('.acct .menu').forEach((m) => m.remove()); document.querySelectorAll('.acct-btn').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
function bindAccount() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.acct-btn');
    if (b) { const open = b.getAttribute('aria-expanded') === 'true'; closeMenus(); if (!open) { b.insertAdjacentHTML('afterend', accountMenu()); b.setAttribute('aria-expanded', 'true'); } return; }
    if (!e.target.closest('.acct .menu') || e.target.closest('[data-act]')) closeMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
}

/* ================= start ================= */
async function loadAll() {
  try {
    const d = await API.load();
    D.profile = d.profile; D.people = d.people || []; D.maps = Object.fromEntries((d.maps || []).map((m) => [m.id, m])); D.ai = !!d.ai; D.loaded = true; D.error = false;
    setCircles(d.circles);
  } catch (err) {
    D.error = err.userMessage || true; D.loaded = false;
    if (API === FETCH_API && (err.status === 401 || err.status === 403)) { location.href = err.status === 401 ? '/login' : '/no-access'; return; }
  }
  reindex(); drawBar(); draw(); renderPanel();
}
let started = false;
export async function start(viewer: Viewer, api = FETCH_API) {
  if (started) return () => {};
  started = true;
  VIEWER = viewer; API = api;
  $('cityList').innerHTML = CITIES.slice(0, 2500).map((c) => `<option value="${esc(c[0])}, ${esc(COUNTRY_NAMES[c[1]] || c[1])}">`).join('');
  initMap(); bindMap(); bindBar(); bindPanel(); bindAccount(); renderAccount();
  setCircles([]); drawBar(); renderPanel();
  const onResize = () => { layout(); };
  addEventListener('resize', onResize); layout();
  await loadAll();
  if (D.people.some(placed)) fitItems(D.people.filter(placed));
  else if (home()) flyLL(home().lat, home().lng, 2.4);
  return () => removeEventListener('resize', onResize);
}
