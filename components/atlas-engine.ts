// @ts-nocheck
// The map app. Plain DOM + d3 for speed: it renders into the shell markup in Atlas.tsx
// and talks to the server only through the small API object below.
import * as d3 from 'd3';
import { tile as d3tile } from 'd3-tile';
import { feature, mesh } from 'topojson-client';
import TOPO from 'world-atlas/countries-50m.json';
import { CITIES, COUNTRY_NAMES, findCity, makePlace } from '@/lib/geo';
import { buildToday } from '@/lib/agenda/build';
import { domainOf } from '@/lib/agenda/clean';
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
  agenda: () => call('/api/agenda?off=' + new Date().getTimezoneOffset()),
  agendaAct: (data) => call('/api/agenda', 'POST', data),
  saveNote: (note) => call('/api/notes', 'POST', { note }),
  deleteNote: (id) => call('/api/notes?id=' + encodeURIComponent(id), 'DELETE'),
  saveFollowUp: (followUp) => call('/api/follow-ups', 'POST', { followUp }),
  nudge: (kind, personId, about) => call('/api/ai/nudge', 'POST', { kind, personId, about }),
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
const AG = { data: null, mods: null, at: 0, loading: false, error: false };
const AGENDA = 'agenda:today';
const state = { fuFor: null, noteFor: null, more: {}, tab: 'today', mode: 'all', layers: { disc: true }, lens: null, view: 'today', sel: null, hl: [], lensAt: 0, selAt: 0, t: d3.zoomIdentity, back: null, pf: 'all', pq: '', plimit: 60, edit: null, drafts: {}, confirm: null, importCircle: '' };
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
function reindex() { IDX = {}; D.people.forEach((p) => (IDX[p.id] = p)); Object.values(D.maps).forEach((m) => (m.disc || []).forEach((d) => (IDX[d.id] = d))); recompute(); }
function recompute() { AG.mods = AG.data ? buildToday(AG.data, D.people) : null; }
const byId = (id) => IDX[id];
const home = () => D.profile?.home || null;
const secOf = (x) => (Array.isArray(x) ? x : [x.h, x.ids, x.why, x.note]);

/* ================= map ================= */
let svg, gBase, gTiles, pGrat, pLand, pBord, gTether, gStr, gMk, gYou, zoom, land, borders, tileLayout;
const TILE_ZOOM_IN = 3.2;
const TILE_ZOOM_FULL = 5.8;
const tileMix = (k) => d3.scaleLinear().domain([TILE_ZOOM_IN, TILE_ZOOM_FULL]).range([0, 1]).clamp(true)(k);
const tileHref = (d) => {
  const r = devicePixelRatio > 1 ? '@2x' : '';
  return `https://a.basemaps.cartocdn.com/rastertiles/voyager/${d[2]}/${d[0]}/${d[1]}${r}.png`;
};
const ASK_PH_LONG = 'What do you want to do? Sparkles finds the people.';
const ASK_PH_SHORT = 'What do you want to do?';
let W = 0, H = 0, proj = d3.geoMercator();
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
  tileLayout = d3tile();
  gTiles = gBase.append('g').attr('class', 'maptiles');
  land = feature(TOPO, TOPO.objects.countries);
  borders = mesh(TOPO, TOPO.objects.countries, (a, b) => a !== b);
  pGrat = gBase.append('path').attr('class', 'grat');
  pLand = gBase.append('path').attr('class', 'land');
  pBord = gBase.append('path').attr('class', 'borders');
  gTether = svg.append('g').attr('class', 'tethers');
  gStr = svg.append('g'); gMk = svg.append('g'); gYou = svg.append('g');
  zoom = d3.zoom().scaleExtent([0.8, 60]).on('zoom', (e) => { state.t = e.transform; draw(); hideTip(); });
  svg.call(zoom).on('dblclick.zoom', null);
}
function layout() {
  const w = innerWidth, h = innerHeight; if (Math.abs(w - W) < 2 && Math.abs(h - H) < 2) return;
  W = w; H = h; const v = view();
  proj = d3.geoMercator().fitExtent([[v.x0 + 16, v.y0], [v.x1 - 16, v.y1]], { type: 'MultiPoint', coordinates: [[-170, 72], [180, 72], [-170, -46], [180, -46], [0, 72], [0, -46]] });
  const path = d3.geoPath(proj);
  pLand.attr('d', path(land)); pBord.attr('d', path(borders)); pGrat.attr('d', path(d3.geoGraticule10()));
  tileLayout.size([W, H]);
  zoom.translateExtent([[-W * 0.3, -H * 0.3], [W * 1.3, H * 1.3]]).extent([[0, 0], [W, H]]);
  draw();
}
function drawTiles(k) {
  const mix = tileMix(k);
  const attr = $('mapAttr');
  if (attr) attr.hidden = mix < 0.15;
  const fade = 1 - mix * 0.9;
  pGrat.style('opacity', 0.22 * fade);
  pLand.style('opacity', fade);
  pBord.style('opacity', 0.55 * fade);
  if (mix < 0.02) { gTiles.style('opacity', 0).selectAll('image').remove(); return; }
  const tiles = tileLayout.scale(proj.scale() * 2 * Math.PI).translate(proj.translate())();
  gTiles.style('opacity', mix * 0.96);
  gTiles.selectAll('image').data(tiles, (d) => d.join('/')).join(
    (enter) => enter.append('image').attr('pointer-events', 'none'),
    (update) => update,
    (exit) => exit.remove(),
  ).attr('x', (d) => d[0] * 256).attr('y', (d) => d[1] * 256).attr('width', 256).attr('height', 256).attr('href', tileHref);
}
function curMap() { return state.lens && !state.lens.startsWith('place:') ? D.maps[state.lens] : null; }
function lensSet() {
  if (!state.lens) return null;
  if (state.lens === AGENDA) return new Set(Object.keys(AG.mods?.lens || {}));
  if (state.lens.startsWith('place:')) { const ck = state.lens.slice(6); return new Set(D.people.filter((p) => p.ck === ck).map((p) => p.id)); }
  const m = curMap(); if (!m) return null;
  return new Set([...(m.sec || []).map(secOf).flatMap((x) => x[1] || []), ...(m.plans || []).flatMap((p) => p.with || []), ...(m.disc || []).map((d) => d.id)]);
}
function discItems() { return lensSet() ? curMap()?.disc || [] : []; }
/** Push cluster / city markers apart on screen while staying near their geo anchor. */
function separateGroups(cl, k, C) {
  const nodes = cl.map((g) => {
    const indiv = g.items.length === 1 || k >= SPLIT + 1.1;
    const n = g.items.length;
    const r = indiv ? (n <= 1 ? 12 : 14 + C * Math.sqrt(n + 1) * 1.15) : 8 + Math.sqrt(n) * 2.8;
    g._ax = g.x; g._ay = g.y;
    return { g, ax: g.x, ay: g.y, x: g.x, y: g.y, r };
  });
  const maxOff = k < SPLIT ? 80 : 52;
  const pad = k < SPLIT ? 14 : 9;
  const iters = k < SPLIT ? 18 : 12;
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = (j - i) * 0.21 + 0.05; dy = (i - j) * 0.17; d = Math.hypot(dx, dy); }
        const need = a.r + b.r + pad;
        if (d < need) {
          const push = (need - d) / 2, ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
    for (const n of nodes) {
      const dx = n.x - n.ax, dy = n.y - n.ay, d = Math.hypot(dx, dy);
      if (d > maxOff) { n.x = n.ax + (dx / d) * maxOff; n.y = n.ay + (dy / d) * maxOff; }
    }
  }
  for (const n of nodes) { n.g.x = n.x; n.g.y = n.y; }
}
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
  drawTiles(k);
  const items = visible(), L = lensSet(), HL = new Set(state.hl);
  const pt = (lat, lng) => { const p = proj([lng, lat]); return [t.applyX(p[0]), t.applyY(p[1])]; };
  const groups = d3.groups(items, (d) => d.ck || `${d.lat},${d.lng}`).map(([ck, arr]) => { const [x, y] = pt(arr[0].lat, arr[0].lng); return { cities: [arr[0].city || ''], items: arr, x, y }; }).sort((a, b) => b.items.length - a.items.length);
  const C = Math.min(24, 10 + Math.max(0, k - SPLIT) * 1.35);
  const md = k < SPLIT ? 24 : C * 2.8, cl = [];
  for (const g of groups) {
    const m = cl.find((o) => Math.hypot(o.x - g.x, o.y - g.y) < md);
    if (m) { const a = m.items.length, b = g.items.length; m.x = (m.x * a + g.x * b) / (a + b); m.y = (m.y * a + g.y * b) / (a + b); m.items.push(...g.items); m.cities.push(...g.cities); }
    else cl.push(g);
  }
  separateGroups(cl, k, C);
  const h = home(); let you = h ? pt(h.lat, h.lng) : null;
  let mk = '', labels = '', tethers = ''; const now = performance.now();
  cl.forEach((g, gi) => {
    const indiv = g.items.length === 1 || k >= SPLIT + 1.1;
    if (g._ax != null && Math.hypot(g.x - g._ax, g.y - g._ay) > 6) tethers += `<line class="tether" x1="${g._ax}" y1="${g._ay}" x2="${g.x}" y2="${g.y}"/>`;
    const isHome = you && Math.hypot(g.x - you[0], g.y - you[1]) < (k < SPLIT ? 30 : C * 3.2);
    if (indiv) {
      const ord = [...g.items].sort((a, b) => (a.t === 'disc') - (b.t === 'disc'));
      const off = isHome || g.items.length > 1 ? 1 : 0;
      const cx = isHome ? you[0] : g.x, cy = isHome ? you[1] : g.y;
      const pinStep = Math.max(17, C * 1.05);
      ord.forEach((p, i) => { const j = i + off, a = j * 2.39996, r = j ? pinStep * Math.sqrt(j) * 1.2 : 0; p._x = cx + r * Math.cos(a); p._y = cy + r * Math.sin(a); p._b = null; });
      const n = g.items.length, nl = L ? g.items.filter((q) => L.has(q.id)).length : 0;
      g.items.forEach((p) => {
        const on = L && L.has(p.id), dimd = L && !on && p.id !== state.sel, sel = p.id === state.sel, hov = HL.has(p.id);
        let s = `<g class="mk${dimd ? ' dim' : ''}" data-id="${esc(p.id)}" transform="translate(${p._x},${p._y})">`;
        if (sel) s += `<circle class="halo" r="11"/>`;
        if (on || hov) s += `<circle r="10.5" fill="none" stroke="${(on && agRing(p.id)) || 'var(--string)'}" stroke-width="${hov ? 2 : 1.5}"/>`;
        if (p.t === 'disc') s += `<rect x="-8" y="-8" width="16" height="16" rx="4" fill="var(--surface)" stroke="var(--m-disc)" stroke-width="1.5" stroke-dasharray="3 2"/><text class="ini out" style="fill:var(--m-disc)">${esc(p.g || '·')}</text>`;
        else s += `<circle r="8" fill="${col(p)}" stroke="var(--land)" stroke-width="1.25"/><text class="ini">${esc(ini(p.n))}</text>`;
        mk += s + '</g>';
        const showName = sel || hov || (n === 1 && !dimd && (on || k >= 2)) || (k >= SPLIT && C >= 24 && !dimd && (L ? on && nl <= 10 : n <= 6));
        if (showName) labels += `<text class="nm" x="${p._x}" y="${p._y + 20}">${esc(p.n.length > 24 ? p.n.slice(0, 23) + '…' : p.n)}</text>`;
      });
      if (n > 1) { const rr = C * Math.sqrt(n + 1); labels += `<text class="cityl" x="${cx}" y="${cy - rr - 8}">${esc([...new Set(g.cities)].slice(0, 3).join(' · '))}</text>`; }
    } else {
      g.items.forEach((p) => { p._x = g.x; p._y = g.y; p._b = gi; });
      const r = 6 + Math.sqrt(g.items.length) * 2.2;
      if (isHome) you = [g.x + r * 0.85, g.y - r * 0.85];
      const arcs = d3.pie().sort(null).value((d) => d[1])(d3.rollups(g.items, (v) => v.length, (d) => (d.t === 'disc' ? 'disc' : circleOf(d) ? d.m : 'none')));
      const arc = d3.arc().innerRadius(Math.max(2, r - 4)).outerRadius(r);
      const hl = (L && g.items.some((p) => L.has(p.id))) || g.items.some((p) => HL.has(p.id));
      const fill = (k2) => (k2 === 'disc' ? 'var(--m-disc)' : k2 === 'none' ? 'var(--c-none)' : `var(${MODES[k2].c})`);
      mk += `<g class="mk cluster${L && !hl ? ' dim' : ''}" data-b="${gi}" transform="translate(${g.x},${g.y})">` + (hl ? `<circle r="${r + 3}" fill="none" stroke="var(--string)" stroke-width="1.5"/>` : '') +
        `<circle r="${r}" fill="var(--land)" stroke="var(--coast)" stroke-width="1"/>` + arcs.map((a) => `<path d="${arc(a)}" fill="${fill(a.data[0])}"/>`).join('') + `<text class="ct" y="0.5">${g.items.length}</text></g>`;
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
  gTether.html(tethers); gStr.html(st); gMk.html(mk + labels);
  gYou.html(you ? `<g class="you" transform="translate(${you[0]},${you[1]})"><circle r="7" fill="var(--accent)" stroke="var(--land)" stroke-width="1.5"/><circle r="2.5" fill="var(--accent-ink)"/><text y="-12">You</text></g>` : '');
  const ppl = items.filter((p) => p.t !== 'disc'), unpl = D.people.filter((p) => !placed(p)).length;
  $('stats').innerHTML = D.loaded ? `<span><b>${ppl.length}</b> on the map</span><span><b>${new Set(ppl.map((p) => p.ck)).size}</b> cities</span>${unpl ? `<button data-act="place" title="Add cities"><b>${unpl}</b> need a city</button>` : ''}<span class="opt"><svg viewBox="0 0 22 10"><path d="M1,9Q11,-3 21,9" fill="none" stroke="var(--string)" stroke-width="1.8"/></svg>Connection to you</span>` : '';
}
function flyLL(lat, lng, k) { const v = view(), cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, [x, y] = proj([lng, lat]); svg.transition().duration(reduce ? 0 : 200).ease(d3.easeCubicOut).call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(k).translate(-x, -y)); }
function flyWorld() { svg.transition().duration(reduce ? 0 : 200).ease(d3.easeCubicOut).call(zoom.transform, d3.zoomIdentity); }
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
  svg.transition().duration(reduce ? 0 : 200).ease(d3.easeCubicOut).call(zoom.transform, d3.zoomIdentity.translate(vx, vy).scale(k).translate(-cx, -cy));
}
let tip;
function hideTip() { if (tip) tip.hidden = true; }
function showTip(p, e) { tip.innerHTML = `<b>${esc(p.n)}</b><span>${esc(p.t === 'disc' ? p.k : [p.role, p.company].filter(Boolean).join(' · '))}${p.city ? ' · ' + esc(p.city) : ''}</span>${p.doing ? `<i>${esc(p.doing)}</i>` : ''}`; tip.hidden = false; placeTip(e); }
function placeTip(e) { let x = e.clientX + 14, y = e.clientY + 14; if (x > innerWidth - 260) x -= 270; if (y > innerHeight - 100) y -= 110; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
function bindMap() {
  tip = $('tip');
  // Tooltip + light CSS highlight only — never redraw on map hover (redraw replaces nodes and causes shake).
  gMk.on('mouseover', (e) => {
    const g = e.target.closest('[data-id]'); if (!g) return;
    const p = byId(g.dataset.id); if (!p) return;
    gMk.selectAll('[data-id].hov').classed('hov', false);
    d3.select(g).classed('hov', true);
    showTip(p, e);
  })
    .on('mousemove', (e) => { if (!tip.hidden) placeTip(e); })
    .on('mouseleave', () => { gMk.selectAll('[data-id].hov').classed('hov', false); hideTip(); })
    .on('click', (e) => {
      const g = e.target.closest('[data-id]'); if (g) { openPerson(g.dataset.id); return; }
      const b = e.target.closest('[data-b]'); if (b) { const [x, y] = d3.pointer(e, svg.node()), t = state.t, v = view(); svg.transition().duration(reduce ? 0 : 200).ease(d3.easeCubicOut).call(zoom.transform, d3.zoomIdentity.translate((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2).scale(Math.max(SPLIT + 0.4, t.k * 2.6)).translate(-t.invertX(x), -t.invertY(y))); }
    });
  $('zin').onclick = () => svg.transition().duration(180).ease(d3.easeCubicOut).call(zoom.scaleBy, 2);
  $('zout').onclick = () => svg.transition().duration(180).ease(d3.easeCubicOut).call(zoom.scaleBy, 0.5);
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
let CUR_IDEAS = IDEAS;
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
  if (state.lens === AGENDA) return ['Today', 'On your agenda'];
  if (state.lens.startsWith('place:')) { const ck = state.lens.slice(6); const p = D.people.find((x) => x.ck === ck); return ['Place', p ? p.city : 'Place']; }
  const s = curMap(); return s ? [s.chip || 'Map', s.title] : ['Map', ''];
}
function useIdea(i) {
  const inp = $('askIn'); const t = CUR_IDEAS[i][1]; inp.value = t; inp.focus();
  const gap = t.indexOf('  '); const pos = gap >= 0 ? gap + 1 : t.length; inp.setSelectionRange(pos, pos);
}
function syncAskPlaceholder() {
  const el = $('askIn');
  if (!el) return;
  el.placeholder = innerWidth < 400 ? ASK_PH_SHORT : ASK_PH_LONG;
}
function bindBar() {
  syncAskPlaceholder();
  addEventListener('resize', syncAskPlaceholder);
  document.querySelector('.top')?.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]'); if (m) { state.mode = m.dataset.mode; drawBar(); draw(); renderPanel(true); return; }
    const l = e.target.closest('[data-layer]'); if (l) { state.layers.disc = !state.layers.disc; drawBar(); draw(); return; }
    if (e.target.closest('#clearLens')) setLens(null);
  });
  $('strip')?.addEventListener('click', (e) => {
    const m = e.target.closest('[data-map]'); if (m) { openMap(m.dataset.map); return; }
    const i = e.target.closest('[data-idea]'); if (i) useIdea(+i.dataset.idea);
  });
  $('askForm')?.addEventListener('submit', (e) => {
    e.preventDefault(); const q = $('askIn').value.trim(); if (!q) return;
    const p = D.people.find((p) => p.n.toLowerCase() === q.toLowerCase()); if (p) { openPerson(p.id); return; }
    runAgent(q);
  });
}

/* ================= views ================= */
let runId = 0;
function setLens(id, { fly = true } = {}) {
  state.lens = id; state.lensAt = performance.now(); state.sel = null; state.hl = []; state.tab = 'today';
  state.view = id && id !== AGENDA ? 'lens' : 'today';
  if (!id) $('askIn').value = '';
  drawBar(); draw(); renderPanel();
  if (!fly) return;
  if (!id) { flyWorld(); return; }
  if (id === AGENDA) { const L = lensSet(); const list = D.people.filter((p) => L.has(p.id)); if (list.length) fitItems(list); return; }
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
  if (state.lens === AGENDA) { state.view = 'today'; state.tab = 'today'; draw(); renderPanel(); return; }
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
const canSample = () => !!API.loadSample && VIEWER.mode === 'local';
const isSampleP = (p) => (p.src || []).includes('Sample');
function sampleOption(primary = false) {
  return canSample() ? `<button class="option${primary ? ' primary' : ''}" data-act="sample"><span class="oi">${icon('sample', 20)}</span><div><b>Explore with sample people</b><small>28 people around the world. Remove them any time.</small></div></button>` : '';
}
function renderWelcome() {
  pb.innerHTML = `<div class="eb">Welcome${firstName() ? ', ' + esc(firstName()) : ''}</div>
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
/* ================= agenda (Today) ================= */
const hasAgenda = () => !!API.agenda;
const MIN = 6e4;
const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);
const sod = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hm = (iso, tz?) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }); } catch { return ''; } };
const dayName = (t) => { const d = Math.round((sod(t) - sod()) / DAY); return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const wd = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short' });
function agoLong(iso) {
  const m = (Date.now() - ms(iso)) / MIN; if (!Number.isFinite(m)) return '';
  if (m < 1) return 'just now'; if (m < 60) return Math.round(m) + ' min ago'; if (m < 60 * 24) return Math.round(m / 60) + ' h ago';
  const d = Math.floor((sod() - sod(ms(iso))) / DAY); if (d <= 1) return 'yesterday'; if (d < 14) return d + ' days ago'; if (d < 60) return Math.round(d / 7) + ' wk ago'; if (d < 365) return Math.round(d / 30) + ' mo ago'; return Math.round(d / 365) + ' yr ago';
}
function untilLong(iso) { const m = Math.round((ms(iso) - Date.now()) / MIN); return m < 1 ? 'now' : m < 60 ? `in ${m} min` : m < 60 * 6 ? `in ${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : 'at ' + hm(iso); }
const KIND_VERB = { talked: 'talked', meeting: 'met', email: 'emailed', note: 'wrote a note' };
const AG_RING = { meet: 'var(--ag-meet)', reply: 'var(--ag-reply)', due: 'var(--ag-due)' };
const agRing = (id) => (state.lens === AGENDA ? AG_RING[AG.mods?.lens?.[id]] : null);
const firstOf = (id) => { const p = byId(id); return p ? fn(p) : ''; };
const namesOf = (ids, guests = []) => [...ids.map(firstOf).filter(Boolean), ...guests.map((g) => g.name.split(' ')[0])];
function pchips(ids, guests = []) {
  return ids.map(byId).filter(Boolean).map((p) => `<button class="pchip" data-person="${esc(p.id)}">${avatar(p, 'xs')}${esc(fn(p))}</button>`).join('') + guests.map((g) => `<span class="pchip guest"><span class="av xs">${esc(ini(g.name))}</span>${esc(g.name.split(' ')[0])}</span>`).join('');
}
function theirTime(e) {
  const p = e.people.length === 1 ? byId(e.people[0]) : null, mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!p || !p.tz || p.tz === mine) return '';
  const a = hm(e.start, p.tz); return a && a !== hm(e.start) ? `${a} for ${fn(p)}` : '';
}
function dueLabel(f) {
  if (f.status === 'snoozed') return 'Back from snooze';
  if (!f.due) return 'No date';
  const d = Math.round((sod(ms(f.due)) - sod()) / DAY);
  return d < 0 ? `Overdue · ${-d === 1 ? '1 day' : -d + ' days'}` : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : 'Due ' + dayName(ms(f.due));
}
function updLabel() { const m = Math.round((Date.now() - AG.at) / MIN); return AG.loading ? 'Updating…' : m < 1 ? 'Updated just now' : `Updated ${m} min ago`; }
async function loadAgenda() {
  if (!hasAgenda() || AG.loading || !D.loaded) return;
  AG.loading = true; const u = $('agUpd'); if (u) u.textContent = updLabel();
  try { AG.data = await API.agenda(); AG.at = Date.now(); AG.error = false; }
  catch (err) { AG.error = true; console.warn(err); }
  AG.loading = false; recompute();
  if (state.lens === AGENDA) draw();
  refreshToday();
}
// Re-render Today without losing what someone is typing.
function refreshToday() {
  if (!(state.view === 'today' && state.tab === 'today' && D.loaded && home())) return;
  const f = document.activeElement; if (f && pb.contains(f) && f.matches('textarea,input')) { const u = $('agUpd'); if (u) u.textContent = updLabel(); return; }
  renderPanel(true);
}
function agendaBar(m) {
  const d = AG.data, on = state.lens === AGENDA, n = Object.keys(m?.lens || {}).length;
  return `<div class="agbar">${d?.demo ? `<span class="demo-badge" title="Generated from your people. Nothing here is real or stored.">${icon('sample', 14)}Demo data</span><button class="lnk" data-act="exitdemo">Exit demo</button>` : ''}
   <span class="sp"></span><span class="upd" id="agUpd">${esc(updLabel())}</span><button class="iconbtn sm" data-act="agrefresh" aria-label="Refresh agenda" title="Refresh">${icon('refresh', 16)}</button></div>
   ${n ? `<button class="maptoggle" data-act="aglens" aria-pressed="${on}">${icon('globe', 16)}<span>${on ? 'Showing today on the map' : 'Show today on the map'}</span><small>${n} ${n === 1 ? 'person' : 'people'}</small></button>${on ? `<div class="legend"><span><i style="border-color:var(--ag-meet)"></i>Meeting today</span><span><i style="border-color:var(--ag-reply)"></i>Awaiting your reply</span><span><i style="border-color:var(--ag-due)"></i>Follow-up due</span></div>` : ''}` : ''}`;
}
function connectCard() {
  return `<div class="card connect"><div class="cardhead">${icon('today', 20)}<div><h3>Connect calendar or email</h3><p>See today’s meetings, who’s waiting on a reply and what you promised, all next to your map.</p>
   <div class="btns" style="align-items:center"><button class="btn sm go" data-act="trydemo">Try demo data</button><span class="optin" style="margin:0">Google and Outlook are next.</span></div></div></div></div>`;
}
function evRow(e, opts: { brief?: boolean; compact?: boolean } = {}) {
  const t = Date.now(), past = ms(e.end) <= t, live = ms(e.start) <= t && !past, tt = theirTime(e);
  const meta = [pchips(e.people, e.guests), tt ? `<span class="tz">${icon('clock', 13)}${esc(tt)}</span>` : '', e.location && !opts.compact ? `<span class="loc">${icon('pin', 13)}${esc(e.location)}</span>` : ''].filter(Boolean).join('');
  const pill = live ? `<span class="pill good">Now</span>` : past ? '' : opts.brief ? `<span class="pill accent">${esc(untilLong(e.start))}</span>` : '';
  return `<div class="ev${past ? ' past' : ''}${opts.brief ? ' next' : ''}" data-hl="${esc(e.people.join(','))}"${e.people.length ? ` data-person="${esc(e.people[0])}" tabindex="0"` : ''}>
   <div class="ev-t"><b>${esc(hm(e.start).replace(/ (AM|PM)$/, ''))}</b><small>${esc(hm(e.start).slice(-2))}</small></div>
   <div class="ev-b"><div class="ev-h"><b>${esc(e.title)}</b>${pill}</div><div class="ev-m">${meta}</div>${e.description && !opts.brief && !opts.compact ? `<div class="ev-d">${esc(e.description.split('\n')[0])}</div>` : ''}</div></div>`;
}
function briefCard(b) {
  const e = b.event, p = b.personId ? byId(b.personId) : null, open = !!state.more[e.id], last = p ? AG.mods.last[p.id] : null;
  const lines = [];
  if (last) lines.push(`<div><span>Last contact</span><b>${esc(KIND_VERB[last.kind][0].toUpperCase() + KIND_VERB[last.kind].slice(1))} ${esc(agoLong(last.at))}</b></div>`);
  if (b.lastThread) lines.push(`<div><span>Last email</span><b>${esc(b.lastThread.subject)}</b><small>${esc(agoLong(b.lastThread.lastAt))}</small></div>`);
  if (b.lastNote) lines.push(`<div><span>Last note</span><b class="q">“${esc(b.lastNote.body.slice(0, 140))}${b.lastNote.body.length > 140 ? '…' : ''}”</b><small>${esc(agoLong(b.lastNote.at))}</small></div>`);
  if (p?.next) lines.push(`<div><span>Next step</span><b>${esc(p.next)}</b></div>`);
  if (b.open.length) lines.push(`<div><span>Open</span><b>${b.open.map((f) => esc(f.title)).join('<br>')}</b></div>`);
  return `<div class="brief" data-hl="${esc(e.people.join(','))}">
   <div class="brief-h"><span class="eb" style="margin:0">Meeting brief</span><span class="sp"></span>${e.joinUrl ? `<a class="btn sm go" href="${esc(e.joinUrl)}" target="_blank" rel="noopener">Join</a>` : ''}</div>
   ${e.description ? `<div class="desc${open ? ' open' : ''}">${esc(open ? e.description : e.description.replace(/\n{2,}/g, '\n'))}</div>${e.description.split('\n').length > 4 || e.description.length > 220 ? `<button class="lnk" data-more="${esc(e.id)}">${open ? 'Show less' : 'Show more'}</button>` : ''}` : ''}
   ${(e.links || []).length ? `<div class="lchips">${e.links.map((u) => `<a class="tag" href="${esc(u)}" target="_blank" rel="noopener">${icon('globe', 12)}${esc(domainOf(u))}</a>`).join('')}</div>` : ''}
   ${lines.length ? `<div class="bfacts">${lines.join('')}</div>` : ''}
   ${p ? `<div class="btns"><button class="btn sm" data-nextstep="${esc(p.id)}">${icon('chat', 15)}Suggest a talking point</button><button class="btn sm ghost" data-person="${esc(p.id)}">Open ${esc(fn(p))}</button></div>` : ''}
  </div>`;
}
function captureCard(e) {
  const who = namesOf(e.people).join(' and ');
  return `<div class="card capture"><div class="cardhead">${icon('chat', 20)}<div style="flex:1;min-width:0"><h3>How was ${esc(e.title.charAt(0).toLowerCase() + e.title.slice(1))}?</h3><p>Ended ${esc(agoLong(e.end))}. A quick note now saves digging later.</p>
   <form id="capForm" data-ev="${esc(e.id)}">
    <textarea id="capNote" rows="3" placeholder="What did you talk about with ${esc(who)}? Anything you promised?" aria-label="Meeting note"></textarea>
    <label class="chk"><input type="checkbox" id="capFuOn">Add a follow-up</label>
    <div id="capFu" class="fucomp" hidden><input id="capFuT" placeholder="Send ${esc(who.split(' and ')[0])} the article" maxlength="300" aria-label="Follow-up">${dueChips('cap', 'tomorrow')}</div>
    <div class="btns"><button class="btn sm go" type="submit">Save note</button><button class="btn sm ghost" type="button" data-capskip="${esc(e.id)}">Not now</button></div>
   </form></div></div></div>`;
}
function dueChips(name, sel) {
  return `<div class="duechips" role="radiogroup" aria-label="Due">${[['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next week'], ['none', 'No date']].map(([v, l]) => `<label><input type="radio" name="${name}-due" value="${v}"${v === sel ? ' checked' : ''}>${l}</label>`).join('')}</div>`;
}
function dueISO(v) {
  const d = new Date(); d.setSeconds(0, 0);
  if (v === 'today') { d.setHours(17, 0); return d.toISOString(); }
  if (v === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0); return d.toISOString(); }
  if (v === 'week') { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0); return d.toISOString(); }
  return undefined;
}
function draftBox(key) {
  const d = state.drafts[key]; if (!d) return '';
  const p = d.pid ? byId(d.pid) : null;
  return `<div class="draft"><textarea id="draft-${esc(key)}" aria-label="Draft message">${esc(d.text)}</textarea><div class="btns" style="margin-top:0"><button class="btn sm" data-copy="${esc(key)}">Copy</button>${p?.email ? `<button class="btn sm" data-mailto="${esc(key)}">${icon('mail', 15)}Open in email</button>` : ''}<button class="btn sm ghost" data-undraft="${esc(key)}">Close</button></div><p class="optin" style="margin:6px 0 0">Sparkles never sends email. Copy it, or open it in your email app.</p></div>`;
}
function fuRow(f, withName = true) {
  const p = byId(f.personId), od = f.due && ms(f.due) < sod();
  return `<div class="row fu" data-person="${esc(f.personId)}" tabindex="0"><button class="tick" data-fudone="${esc(f.id)}" aria-label="Mark “${esc(f.title)}” done">${icon('check', 14)}</button>
   <div><b>${esc(f.title)}</b><small><span class="${od ? 'od' : ''}">${esc(dueLabel(f))}</span>${withName && p ? ' · ' + esc(p.n) : ''}</small>
   <div class="ra"><button class="lnk" data-draft="followup|${esc(f.personId)}|${esc(f.id)}">Draft</button><button class="lnk" data-fusnooze="${esc(f.id)}">Snooze to tomorrow</button></div>${draftBox('f-' + f.id)}</div></div>`;
}
function threadRow(t, kind) {
  const id = t.people[0], who = namesOf(t.people, t.guests).join(', '), d = Math.floor((Date.now() - ms(t.lastAt)) / DAY);
  const head = kind === 'reply' ? `<b>${esc(who)}</b> wrote ${esc(agoLong(t.lastAt))}` : `No reply from <b>${esc(who)}</b> in ${d} days`;
  return `<div class="row th"${id ? ` data-person="${esc(id)}" tabindex="0"` : ''} data-hl="${esc(t.people.join(','))}">${id ? avatar(byId(id)) : `<span class="av">${esc(ini(who))}</span>`}
   <div><span class="th-h">${head}</span><small class="subj">${icon('mail', 13)}${esc(t.subject)}</small>
   <div class="ra">${id ? `<button class="lnk" data-draft="${kind === 'reply' ? 'reply' : 'nudge'}|${esc(id)}|${esc(t.id)}">${kind === 'reply' ? 'Draft a reply' : 'Nudge'}</button>` : ''}${kind === 'reply' ? `<button class="lnk" data-thact="done|${esc(t.id)}">Done</button><button class="lnk" data-thact="snoozed|${esc(t.id)}">Snooze</button>` : `<button class="lnk" data-thact="dismissed|${esc(t.id)}">Dismiss</button>`}</div>${draftBox('t-' + t.id)}</div></div>`;
}
function circleKind() {
  if (state.mode === 'all') return 'all';
  if (state.mode === 'work' || state.mode === 'friends' || state.mode === 'family') return state.mode;
  const label = MODES[state.mode]?.l?.toLowerCase();
  if (label === 'work') return 'work';
  if (label === 'friends' || label === 'friend') return 'friends';
  if (label === 'family') return 'family';
  return 'other';
}
function personInMode(id) {
  if (state.mode === 'all') return true;
  const p = byId(id);
  return p && p.m === state.mode;
}
function planInMode(p) {
  if (state.mode === 'all') return true;
  return (p.with || []).some((id) => personInMode(id));
}
function mapPersonIds(s) {
  return [
    ...(s.sec || []).map(secOf).flatMap((x) => (Array.isArray(x[1]) ? x[1] : [])),
    ...(s.plans || []).flatMap((p) => p.with || []),
  ].filter((id) => typeof id === 'string' && id);
}
function mapInMode(s) {
  if (!s || state.mode === 'all') return true;
  if (s.m === state.mode) return true;
  const ids = mapPersonIds(s);
  return ids.length > 0 && ids.every((id) => personInMode(id));
}
function ideasForMode() {
  const k = circleKind();
  if (k === 'work') return [['Prep', 'Who should I prep for '], ['Follow up', 'Who am I overdue emailing about '], ['Intro', 'Who at work should meet '], ['Help', 'Who could help me with '], ['Travel', 'Work trip to ']];
  if (k === 'friends') return [['Coffee', 'Who should I grab coffee with '], ['Plan', 'Who should I plan something fun with '], ['Catch up', 'Which friends should I check in with '], ['Visit', 'Friends to see in '], ['Group', 'Who should I invite to ']];
  if (k === 'family') return [['Call', 'Which family should I call '], ['Visit', 'When should I visit '], ['Errand', 'Pick up from '], ['Dinner', 'Plan dinner with '], ['Help', 'Who in the family needs ']];
  return IDEAS;
}
function filterTodayMods(m) {
  if (!m || state.mode === 'all') return m;
  const has = personInMode;
  const evOk = (e) => (e.people || []).some(has);
  const meetings = (m.meetings || []).filter(evOk);
  const next = meetings.find((e) => ms(e.end) > Date.now()) || null;
  let brief = null;
  const baseReply = m.needsReply || [];
  const baseWaiting = m.waiting || [];
  const baseDue = m.due || [];
  if (next) {
    const pid = next.people.find(has) || next.people[0];
    const notes = AG.data?.notes || [];
    const threads = [...baseReply, ...baseWaiting];
    brief = {
      event: next,
      personId: pid,
      lastNote: pid ? notes.find((n) => n.people.includes(pid)) : undefined,
      lastThread: pid ? threads.filter((t) => t.people.includes(pid)).sort((x, y) => ms(y.lastAt) - ms(x.lastAt))[0] : undefined,
      open: baseDue.filter((f) => f.personId === pid),
    };
  }
  const after = m.after && evOk(m.after) ? m.after : null;
  const needsReply = baseReply.filter((t) => t.people.some(has));
  const waiting = baseWaiting.filter((t) => t.people.some(has));
  const due = baseDue.filter((f) => has(f.personId));
  const coming = (m.coming || []).map((g) => ({ day: g.day, events: (g.events || []).filter(evOk) })).filter((g) => g.events.length);
  const trips = (m.trips || []).filter((t) => t.people.some(has));
  const reconnect = (m.reconnect || []).filter((r) => has(r.id));
  const notes = (m.notes || []).filter((n) => n.people.some(has));
  const lens = {};
  for (const f of due) lens[f.personId] = 'due';
  for (const t of needsReply) for (const id of t.people) if (has(id)) lens[id] = 'reply';
  for (const e of meetings) for (const id of e.people) if (has(id)) lens[id] = 'meet';
  return { ...m, meetings, next, brief, after, needsReply, waiting, due, coming, trips, reconnect, notes, lens };
}
function casualPromptFor(p, kind) {
  const name = fn(p);
  if (p.doing && /pick up|drop off|school|soccer|doctor/i.test(p.doing)) return p.doing.replace(/\.$/, '');
  if (kind === 'family') {
    const opts = [`Pick up from ${name}`, `Call ${name}`, `Plan a visit with ${name}`, `Check in with ${name}`];
    return opts[((p.id || '').length + Math.floor(since(p) / 14)) % opts.length];
  }
  if (p.doing) return `Ask ${name} about ${p.doing.replace(/\.$/, '').toLowerCase()}`;
  const city = p.city ? p.city.split(',')[0].trim() : '';
  const opts = [`Grab coffee with ${name}`, `Plan something with ${name}`, `Check in with ${name}`, city ? `See ${name} in ${city}` : `Catch up with ${name}`];
  return opts[((p.id || '').length + Math.floor(since(p) / 21)) % opts.length];
}
function casualIdeaRows(kind) {
  const people = D.people.filter((p) => state.mode === 'all' || p.m === state.mode);
  return people
    .filter((p) => p.t !== 'disc')
    .sort((a, b) => since(b) - since(a))
    .slice(0, 6)
    .map((p) => {
      const idea = casualPromptFor(p, kind);
      return `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc(idea)}</small>
       <div class="ra"><button class="lnk" data-runask="${esc(idea)}">Map it</button><button class="lnk" data-nextstep="${esc(p.id)}">Suggest</button></div></div></div>`;
    })
    .join('');
}
function reconnectRows(rc, title, sub) {
  if (!rc.length) return '';
  return `<div class="h4">${esc(title)}<span class="cnt">${esc(sub)}</span></div>${rc.map((r) => { const p = byId(r.id); if (!p) return ''; return `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc(r.days >= 60 ? Math.round(r.days / 30) + ' months' : r.days + ' days')} since you last ${esc(KIND_VERB[r.kind] || 'talked')}</small></div><span class="pill${r.days > 120 ? ' warn' : ''}">${esc(ago(new Date(Date.now() - r.days * DAY).toISOString()))}</span></div>`; }).join('')}`;
}
function agendaModulesWork(m) {
  const d = AG.data, out = [];
  if (!d.demo && !d.connected) out.push(connectCard());
  if (m.after) out.push(captureCard(m.after));
  if (m.meetings.length) {
    const left = m.meetings.filter((e) => ms(e.end) > Date.now()).length;
    out.push(`<div class="h4" id="ag-meet">Today’s meetings<span class="cnt">${left ? left + ' to go' : 'All done'}</span></div><div class="tl">${m.meetings.map((e) => evRow(e, { brief: m.next && e.id === m.next.id }) + (m.brief && e.id === m.brief.event.id ? briefCard(m.brief) : '')).join('')}</div>`);
  }
  if (m.due.length) out.push(`<div class="h4" id="ag-due">Follow-ups due<span class="cnt">${m.due.length}</span></div>${m.due.map((f) => fuRow(f)).join('')}`);
  if (m.needsReply.length) out.push(`<div class="h4" id="ag-reply">Needs your reply<span class="cnt">${m.needsReply.length}</span></div>${m.needsReply.map((t) => threadRow(t, 'reply')).join('')}`);
  if (m.waiting.length) out.push(`<div class="h4">Waiting on them<span class="cnt">${m.waiting.length}</span></div>${m.waiting.map((t) => threadRow(t, 'wait')).join('')}`);
  return out.join('');
}
function agendaModulesPersonal(m, kind) {
  const out = [];
  const ideas = casualIdeaRows(kind);
  if (ideas) out.push(`<div class="h4" id="ag-ideas">${kind === 'family' ? 'Family this week' : 'Ideas with friends'}<span class="cnt">Small next steps</span></div>${ideas}`);
  if (m.meetings.length) {
    const left = m.meetings.filter((e) => ms(e.end) > Date.now()).length;
    out.push(`<div class="h4" id="ag-meet">On the calendar<span class="cnt">${left ? left + ' to go' : 'All done'}</span></div><div class="tl">${m.meetings.map((e) => evRow(e, { brief: m.next && e.id === m.next.id }) + (m.brief && e.id === m.brief.event.id ? briefCard(m.brief) : '')).join('')}</div>`);
  }
  if (m.due.length) out.push(`<div class="h4" id="ag-due">Don’t forget<span class="cnt">${m.due.length}</span></div>${m.due.map((f) => fuRow(f)).join('')}`);
  out.push(reconnectRows(m.reconnect.slice(0, 5), kind === 'family' ? 'Check in' : 'Catch up', 'Past your usual rhythm'));
  return out.join('');
}
function agendaModulesShared(m) {
  const d = AG.data, out = [];
  if (m.trips.length || m.coming.length) {
    out.push(`<div class="h4">Coming up<span class="cnt">Next 7 days</span></div>` + m.trips.map((t) => {
      const a = ms(t.event.start), b = ms(t.event.end) - 1, span = sod(a) === sod(b) ? dayName(a) : `${wd(a)}–${wd(b)}`;
      return `<div class="card trip" data-hl="${esc(t.people.join(','))}"><div class="cardhead"><span class="oi">${icon('plans', 20)}</span><div style="flex:1"><h3>${esc(t.city)} · ${esc(span)}</h3><p>${t.people.length} ${t.people.length === 1 ? 'person' : 'people'} you know ${t.people.length === 1 ? 'is' : 'are'} there: ${esc(namesOf(t.people.slice(0, 4)).join(', '))}${t.people.length > 4 ? '…' : ''}</p>
       <div class="btns"><button class="btn sm go" data-place="${esc(t.ck)}">See who’s there</button><button class="btn sm" data-tripask="${esc(`I’m in ${t.city} ${span}. Who should I see?`)}">Plan the trip</button></div></div></div></div>`;
    }).join('') + m.coming.map((g) => `<div class="dayh">${esc(dayName(g.day))}</div>${g.events.map((e) => evRow(e, { compact: true })).join('')}`).join(''));
  }
  const k = circleKind();
  if (k === 'all' || k === 'work') {
    const rc = m.reconnect.slice(0, 5);
    out.push(reconnectRows(rc, 'Reconnect', 'Past your usual rhythm'));
  }
  if (m.suggested.length && state.mode === 'all') out.push(`<div class="h4">New people<span class="cnt">Not on your map yet</span></div>${m.suggested.map((g) => `<div class="row sg"><span class="av" style="background:var(--sunk2);color:var(--ink2)">${esc(ini(g.name))}</span><div><b>${esc(g.name)}</b><small>${esc([g.meetings ? `You met ${g.meetings === 1 ? 'once' : g.meetings === 2 ? 'twice' : g.meetings + ' times'} this month` : '', g.threads ? `${g.threads} email ${g.threads === 1 ? 'thread' : 'threads'}` : ''].filter(Boolean).join(' · '))}</small>
     <div class="ra"><button class="lnk" data-sgadd="${esc(g.email)}">Add to map</button><button class="lnk" data-sgno="${esc(g.email)}">Ignore</button></div></div></div>`).join('')}`);
  if (m.notes.length) out.push(`<div class="h4">Recent notes</div>${m.notes.map((n) => `<div class="nrow" data-person="${esc(n.people[0])}" data-hl="${esc(n.people.join(','))}" tabindex="0"><p>${esc(n.body)}</p><small>${esc(namesOf(n.people).join(', '))} · ${esc(agoLong(n.at))}</small></div>`).join('')}`);
  return out.join('');
}
function agendaModules(m) {
  const fm = filterTodayMods(m);
  const k = circleKind();
  if (k === 'friends' || k === 'family') return agendaModulesPersonal(fm, k) + agendaModulesShared(fm);
  return agendaModulesWork(fm) + agendaModulesShared(fm);
}
function todayTiles(m) {
  const k = circleKind();
  const fm = m ? filterTodayMods(m) : null;
  const ppl = D.people.filter((p) => state.mode === 'all' || p.m === state.mode);
  const planned = allPlans().filter((p) => p.planned && planInMode(p));
  const cities = new Set(ppl.filter(placed).map((p) => p.ck)).size;
  if (fm && (AG.data.demo || AG.data.connected)) {
    if (k === 'friends' || k === 'family') {
      const catchUp = fm.reconnect.length || ppl.filter((p) => since(p) >= 30 && since(p) < Infinity).length;
      return `<div class="tiles"><button class="tile" data-jump="ag-ideas"><b>${Math.min(ppl.length, 6)}</b><small>${k === 'family' ? 'Family ideas' : 'Friend ideas'}</small></button><button class="tile" data-jump="ag-meet"><b>${fm.meetings.length}</b><small>On the calendar</small></button><button class="tile" data-jump="ag-due"><b>${catchUp}</b><small>Catch up</small></button></div>`;
    }
    return `<div class="tiles"><button class="tile" data-jump="ag-meet"><b>${fm.meetings.length}</b><small>Meetings today</small></button><button class="tile" data-jump="ag-reply"><b>${fm.needsReply.length}</b><small>Need a reply</small></button><button class="tile${fm.due.some((f) => f.due && ms(f.due) < sod()) ? ' warn' : ''}" data-jump="ag-due"><b>${fm.due.length}</b><small>Follow-ups due</small></button></div>`;
  }
  return `<div class="tiles"><button class="tile" data-tab="people"><b>${ppl.length}</b><small>People</small></button><button class="tile" data-act="world"><b>${cities}</b><small>Cities</small></button><button class="tile" data-tab="plans"><b>${planned.length}</b><small>Plans</small></button></div>`;
}
function renderToday() {
  CUR_IDEAS = ideasForMode();
  const ppl = D.people.filter((p) => state.mode === 'all' || p.m === state.mode), unpl = D.people.filter((p) => !placed(p)).length;
  const recent = [...ppl].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 4);
  const saved = Object.values(D.maps).filter(mapInMode).sort((a, b) => (b.at || 0) - (a.at || 0));
  const planned = allPlans().filter((p) => p.planned && planInMode(p)).sort((a, b) => b.planned - a.planned);
  const samples = D.people.filter(isSampleP).length;
  const ag = hasAgenda() && D.people.length > 0, raw = ag && AG.data ? AG.mods : null, m = raw ? filterTodayMods(raw) : null;
  const modeLbl = state.mode !== 'all' && MODES[state.mode] ? MODES[state.mode].l : '';
  const unplCard = `<div class="card warn"><div class="cardhead">${icon('pin', 20)}<div><h3>${unpl} ${unpl === 1 ? 'person needs' : 'people need'} a city</h3><p>Add a city to put them on the map.</p><button class="btn sm go" data-act="place">Add cities</button></div></div></div>`;
  const due = m ? [] : ppl.filter((p) => since(p) >= 45 && since(p) < Infinity).sort((a, b) => since(b) - since(a)).slice(0, 5);
  const tiles = todayTiles(raw);
  pb.innerHTML = `
   <h2 class="greet">${greetWord()}${firstName() ? ', ' + esc(firstName()) : ''}</h2>
   <p class="sub">${modeLbl ? `<strong>${esc(modeLbl)}</strong> · ` : ''}${esc(today())} · <button class="homechip" data-act="home" title="Change home city">${icon('pin', 14)}${esc(home().city)}</button></p>
   ${ag && AG.data ? agendaBar(m || raw) : ''}
   ${D.people.length === 0 ? addPeopleCard() : tiles}
   ${samples ? `<div class="banner">${icon('sample', 18)}<span>You’re exploring ${samples} sample people.</span><button class="btn sm ghost" data-act="clearsample">Remove</button></div>` : ''}
   ${unpl && !m ? unplCard : ''}
   ${ag && !AG.data ? (AG.error ? `<div class="banner err">${icon('alert', 18)}<span>Couldn’t load your agenda. Your people and maps are fine.</span><button class="btn sm ghost" data-act="agrefresh">Try again</button></div>` : `<div aria-busy="true" aria-label="Loading your agenda"><div class="sk c"></div>${'<div class="skrow"><span class="sk"></span><div><div class="sk l"></div><div class="sk l"></div></div></div>'.repeat(3)}</div>`) : ''}
   ${m ? agendaModules(raw) + (unpl ? unplCard : '') : ''}
   ${planned.length ? `<div class="h4">Your plans<span class="cnt">${planned.length}</span></div>${planned.slice(0, 5).map(planRow).join('')}` : ''}
   ${due.length ? `<div class="h4">Reach out<span class="cnt">Longest since you talked</span></div>${due.map((p) => `<div class="row" data-person="${esc(p.id)}" tabindex="0">${avatar(p)}<div><b>${esc(p.n)}</b><small>${esc(p.doing || [p.role, p.company].filter(Boolean).join(' · ') || p.city || '')}</small></div><span class="pill${since(p) > 120 ? ' warn' : ''}">${esc(ago(p.last))}</span></div>`).join('')}` : ''}
   <div class="h4">Ask Sparkles</div>
   <div class="tags">${(CUR_IDEAS || IDEAS).map((x, i) => (x && x[1] ? `<button class="tag" data-ideaq="${i}">${esc(String(x[1]).replace(/\s+$/, '…'))}</button>` : '')).join('')}</div>
   ${!D.ai ? `<p class="hint">Offline suggestions: Sparkles matches your words to people’s notes and interests.</p>` : ''}
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
  return (withNone ? `<option value=""${!sel ? ' selected' : ''}>No circle</option>` : '') + (D.circles || []).map((c) => `<option value="${esc(c.id)}"${sel === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
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
   ${(D.circles || []).map((c, i) => `<div class="c-edit"><button class="c-dot" style="background:var(--c${c.color})" data-ccolor="${i}" aria-label="Change color of ${esc(c.label)}"></button><input data-clabel="${i}" value="${esc(c.label)}" maxlength="24" aria-label="Circle name"><button class="btn sm ghost" data-cdel="${i}">Remove</button></div>`).join('')}
   <div class="btns">${(D.circles || []).length < 12 ? `<button class="btn sm" data-act="addcircle">Add a circle</button>` : ''}</div>
   <div class="h4">Settings</div>
   <div class="btns"><button class="btn sm" data-act="home">${icon('pin', 16)}Home: ${esc(home()?.city || 'Set home')}</button>${D.people.some(isSampleP) ? `<button class="btn sm" data-act="clearsample">Remove sample people</button>` : ''}${D.people.length ? `<button class="btn sm ghost" data-act="wipe">Remove everyone</button>` : ''}</div>
   ${state.confirm === 'wipe' ? `<div class="confirm">Remove all ${D.people.length} people? Your maps stay. This can’t be undone.<div class="btns"><button class="btn sm danger" data-act="wipe-yes">Remove everyone</button><button class="btn sm" data-cancel>Cancel</button></div></div>` : ''}
   ${state.confirm === 'home' ? `<form class="form" id="homeForm"><label>Home city<input id="homeCity" list="cityList" value="${esc(home()?.city || '')}" autocomplete="off" required></label><div class="btns" style="margin-top:0"><button class="btn sm go" type="submit">Save</button><button class="btn sm" type="button" data-cancel>Cancel</button></div></form>` : ''}`;
}
function renderEdit() {
  const p = state.edit.id ? byId(state.edit.id) : null, v = p || { m: state.mode !== 'all' ? state.mode : '', ...(state.edit.prefill || {}) };
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
     <div class="two"><label>Profile link<input id="f-url" value="${esc(v.url || '')}" placeholder="https://" autocomplete="off"></label><label>Remind me after<select id="f-every">${[['', `${AG.data?.defaultEvery || 45} days (default)`], ['14', '2 weeks'], ['30', '1 month'], ['60', '2 months'], ['90', '3 months'], ['180', '6 months'], ['365', '1 year'], ['0', 'Never']].map(([val, l]) => `<option value="${val}"${String(v.every ?? '') === val ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    </div>
    ${p && state.confirm === 'del:' + p.id ? `<div class="confirm">Delete ${esc(p.n)}? This can’t be undone.<div class="btns"><button class="btn sm danger solid" type="button" data-delp-yes="${esc(p.id)}">Delete</button><button class="btn sm" type="button" data-cancel>Keep</button></div></div>` : ''}
    <div class="formbar">${p ? `<button class="btn ghost danger-text" type="button" data-delp="${esc(p.id)}">Delete</button>` : ''}<span class="sp"></span><button class="btn" type="button" data-back-edit>Cancel</button><button class="btn go" type="submit" id="saveBtn">${p ? 'Save changes' : 'Add to map'}</button></div>
   </form>`;
  const ci = $('f-city'), hint = $('cityHint');
  ci?.addEventListener('input', () => {
    const q = ci.value.trim(); hint.hidden = !q;
    if (!q) return;
    const hit = findCity(q);
    hint.className = hit ? 'ok' : 'hint';
    hint.innerHTML = hit ? `${icon('check', 13)}${esc(hit.city)}, ${esc(hit.country)}` : 'We’ll look this up when you save.';
  });
  $('f-n')?.addEventListener('input', (e) => { if (e.target.value.trim()) { e.target.removeAttribute('aria-invalid'); $('e-n').hidden = true; } });
}
function personAgenda(p) {
  if (!hasAgenda() || !AG.data) return '';
  const t = Date.now();
  const nextEv = AG.data.events.filter((e) => !e.allDay && e.people.includes(p.id) && ms(e.end) > t).sort((a, b) => ms(a.start) - ms(b.start))[0];
  const fus = AG.data.followUps.filter((f) => f.personId === p.id && f.status !== 'done').sort((a, b) => (ms(a.due) || Infinity) - (ms(b.due) || Infinity));
  const notes = AG.data.notes.filter((n) => n.people.includes(p.id));
  const th = AG.data.threads.filter((x) => x.people.includes(p.id)).sort((a, b) => ms(b.lastAt) - ms(a.lastAt))[0];
  return `${nextEv ? `<div class="h4">Next meeting</div>${evRow(nextEv, { compact: true }).replace(/ data-person="[^"]*" tabindex="0"/, '')}` : ''}
   ${th ? `<div class="h4">Last email</div><div class="row th"><span class="av" style="background:var(--sunk2);color:var(--ink2)">${icon('mail', 16)}</span><div><b>${esc(th.subject)}</b><small>${esc(th.awaiting === 'me' ? 'They wrote ' : 'You wrote ') + esc(agoLong(th.lastAt))}</small></div></div>` : ''}
   <div class="h4">Follow-ups${fus.length ? `<span class="cnt">${fus.length}</span>` : ''}${state.fuFor === p.id ? '' : `<button class="lnk" data-fuadd="${esc(p.id)}">Add</button>`}</div>
   ${state.fuFor === p.id ? `<form class="fucomp" id="fuForm" data-pid="${esc(p.id)}"><input id="fuT" placeholder="Send ${esc(fn(p))} the article" maxlength="300" aria-label="Follow-up" required>${dueChips('fu', 'tomorrow')}<div class="btns" style="margin-top:0"><button class="btn sm go" type="submit">Add follow-up</button><button class="btn sm" type="button" data-fucancel>Cancel</button></div></form>` : ''}
   ${fus.map((f) => fuRow(f, false)).join('') || (state.fuFor === p.id ? '' : `<p class="optin">Nothing open. Add what you promised ${esc(fn(p))} so it shows up on Today.</p>`)}
   <div class="h4">Notes${notes.length ? `<span class="cnt">${notes.length}</span>` : ''}</div>
   <form class="notecomp" id="noteForm" data-pid="${esc(p.id)}"><textarea id="noteT" rows="2" placeholder="What did you talk about? What do they care about right now?" aria-label="New note about ${esc(p.n)}"></textarea><div class="btns" style="margin-top:0"><button class="btn sm go" type="submit">Save note</button><span class="optin" style="margin:0">Dated, private to you.</span></div></form>
   ${notes.slice(0, 20).map((n) => `<div class="nrow static"><p>${esc(n.body)}</p><small>${esc(dayName(ms(n.at)))}${n.people.length > 1 ? ' · with ' + esc(namesOf(n.people.filter((x) => x !== p.id)).join(', ')) : ''}${n.demo ? ' · demo' : `<button class="lnk" data-delnote="${esc(n.id)}">Delete</button>`}</small></div>`).join('')}`;
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
  const c = circleOf(p), lt = AG.mods?.last?.[p.id], d = lt ? (Date.now() - ms(lt.at)) / DAY : since(p);
  const lastTxt = lt ? (d < 1 ? 'Today' : ago(lt.at) + ' ago') : 'Not logged';
  pb.innerHTML = `${backBtn}
   <div class="phead">${avatar(p, 'lg')}<div style="flex:1;min-width:0"><h3>${esc(p.n)}</h3><p>${esc([p.role, p.company].filter(Boolean).join(' · ') || 'No role yet')}</p>
    <div class="chips">${c ? `<span class="tag"><i style="background:var(${c.c})"></i>${esc(c.l)}</span>` : ''}${p.city ? `<span class="tag">${icon('pin', 13)}${esc(p.city)}</span>` : `<button class="tag" data-editp="${esc(p.id)}">${icon('pin', 13)}Add a city</button>`}${isSampleP(p) ? `<span class="tag">Sample</span>` : ''}</div></div>
    <button class="iconbtn" data-editp="${esc(p.id)}" title="Edit ${esc(fn(p))}" aria-label="Edit ${esc(p.n)}" style="align-self:flex-start">${icon('edit', 18)}</button></div>
   <div class="actions"><button class="btn go sm" data-nextstep="${esc(p.id)}">${icon('chat', 16)}${p.next ? 'Another idea' : 'Suggest a next step'}</button><button class="btn sm" data-talked="${esc(p.id)}">${icon('check', 16)}We talked today</button></div>
   <div class="facts"><div>Where<b>${esc(p.city || 'Not set')}</b></div><div>Their time<b>${esc(localTime(p.tz) || '–')}</b></div><div class="${d > 120 && d < Infinity ? 'warn' : ''}"${lt ? ` title="Last ${esc(lt.kind === 'note' ? 'note' : lt.kind === 'talked' ? 'talked' : lt.kind)}"` : ''}>Last contact<b>${esc(lastTxt)}</b></div></div>
   ${p.next ? `<div class="ai" style="margin-top:16px"><b>Next step</b><span id="nextText">${esc(p.next)}</span></div>` : `<div id="nextText" class="sr"></div>`}
   ${p.doing ? `<div class="now"><span>Right now</span><p>${esc(p.doing)}</p></div>` : ''}
   ${p.tags && p.tags.length ? `<div class="h4">Interests</div><div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
   ${personAgenda(p)}
   <div class="h4">About ${esc(fn(p))}${p.note ? `<button class="lnk" data-editp="${esc(p.id)}">Edit</button>` : `<button class="lnk" data-editp="${esc(p.id)}">Add</button>`}</div>${p.note ? `<div class="note">${esc(p.note)}</div>` : `<p class="optin">How you met, what they care about. Dated notes go above.</p>`}
   ${p.url || p.email || (p.src || []).length ? `<div class="h4">Details</div><div class="tags">${p.email ? `<a class="tag" href="mailto:${esc(p.email)}">${icon('mail', 13)}${esc(p.email)}</a>` : ''}${p.url ? `<a class="tag" href="${esc(p.url)}" target="_blank" rel="noopener">Profile ↗</a>` : ''}${(p.src || []).filter((s) => s !== 'Sample').map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}`;
}


/* ================= panel events ================= */
function toastErr(e) { console.warn(e); toast(e?.status === 401 ? 'Your session ended. Reload and sign in again.' : e?.message && e.status && e.status < 500 ? e.message : 'Couldn’t save. Check your connection and try again.', { kind: 'err' }); }
function goTab(tab) {
  if (!D.loaded || !home()) return;
  runId++; state.tab = tab; state.edit = null; state.confirm = null; state.sel = null; state.hl = [];
  if (state.view !== 'today') { state.view = 'today'; if (state.lens && state.lens !== AGENDA) { state.lens = null; drawBar(); } }
  if (mobile()) $('panel').classList.add('big');
  draw(); renderPanel();
}
function bindPanel() {
  pb = $('pbody');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { goTab(b.dataset.tab); return; }
    const a = e.target.closest('[data-act]');
    if (a && a.isConnected && !pb.contains(a)) act(a.dataset.act);
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
    if (agendaClick(t)) return;
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
  pb.addEventListener('input', (e) => {
    if (e.target.id !== 'pq') return;
    const inp = e.target;
    state.pq = inp.value;
    state.plimit = 60;
    const pos = inp.selectionStart;
    renderPanel(true);
    const n = $('pq');
    n?.focus();
    if (n && pos != null) try { n.setSelectionRange(pos, pos); } catch {}
  });
  pb.addEventListener('change', (e) => {
    if (e.target.id === 'impCircle') { state.importCircle = e.target.value; return; }
    const l = e.target.closest('[data-clabel]'); if (l) { const v = l.value.trim(); if (v) { D.circles[+l.dataset.clabel].label = v.slice(0, 24); saveCircles(); } }
  });
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
    if (e.target.id === 'capForm') saveCapture(e.target);
    if (e.target.id === 'noteForm') saveNoteForm(e.target);
    if (e.target.id === 'fuForm') saveFuForm(e.target);
  });
  pb.addEventListener('change', (e) => { if (e.target.id === 'capFuOn') { $('capFu').hidden = !e.target.checked; if (e.target.checked) $('capFuT').focus(); } });
  pb.addEventListener('mouseover', (e) => { const r = e.target.closest('[data-person],[data-hl]'); const ids = r ? (r.dataset.hl != null ? r.dataset.hl.split(',').filter(Boolean) : [r.dataset.person]) : []; if (ids.join() !== state.hl.join()) { state.hl = ids; draw(); } });
  pb.addEventListener('mouseleave', () => { if (state.hl.length) { state.hl = []; draw(); } });
  const handle = $('handle'); if (handle) handle.onclick = () => $('panel').classList.toggle('big');
  $('csvIn')?.addEventListener('change', importCsv);
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
  if (a === 'agrefresh') { await loadAgenda(); return; }
  if (a === 'aglens') { if (state.lens === AGENDA) setLens(null); else { setLens(AGENDA); if (mobile()) $('panel').classList.remove('big'); } return; }
  if (a === 'exitdemo' || a === 'trydemo') {
    const on = a === 'trydemo';
    try { await API.agendaAct({ action: 'demo', on }); if (state.lens === AGENDA) setLens(null, { fly: false }); state.drafts = {}; AG.data = null; renderPanel(true); await loadAgenda(); toast(on ? 'Showing demo data built from your people' : 'Demo data hidden. Your people, notes and follow-ups stay.'); } catch (err) { toastErr(err); }
    return;
  }
  if (a === 'wipe') { state.confirm = 'wipe'; renderPanel(true); return; }
  if (a === 'wipe-yes') { try { await API.deleteAllPeople(); D.people = []; state.confirm = null; reindex(); draw(); renderPanel(); toast('Everyone removed'); } catch (err) { toastErr(err); } return; }
  if (a === 'addcircle') { const used = new Set(D.circles.map((c) => c.id)); let n = 1; while (used.has('c' + n)) n++; D.circles.push({ id: 'c' + n, label: 'New circle', color: D.circles.length % 8 }); saveCircles(); setTimeout(() => { const l = document.querySelector(`[data-clabel="${D.circles.length - 1}"]`); l?.focus(); l?.select(); }, 0); }
}
/* ================= agenda actions ================= */
const newId = (pfx) => pfx + Date.now().toString(36) + uid8();
const tomorrow9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
async function demoAct(id, s, until?) { await API.agendaAct({ action: 'act', id, s, until }); }
async function setFollowUp(id, patch, msg?) {
  const f = AG.data.followUps.find((x) => x.id === id); if (!f) return;
  const prev = { ...f }; Object.assign(f, patch); recompute(); renderPanel(true); if (state.lens === AGENDA) draw();
  try {
    if (f.demo) await demoAct(f.id, f.status === 'open' ? 'open' : f.status, f.until);
    else await API.saveFollowUp(f);
    if (msg) toast(msg, { action: { label: 'Undo', run: () => setFollowUp(id, { status: prev.status, until: prev.until, doneAt: prev.doneAt }) } });
  } catch (err) { Object.assign(f, prev); recompute(); renderPanel(true); toastErr(err); }
}
async function setThread(id, s) {
  const i = AG.data.threads.findIndex((x) => x.id === id); if (i < 0) return;
  const [th] = AG.data.threads.splice(i, 1); recompute(); renderPanel(true); if (state.lens === AGENDA) draw();
  const undo = async () => { AG.data.threads.splice(i, 0, th); recompute(); renderPanel(true); try { await demoAct(id, 'open'); } catch (err) { toastErr(err); } };
  try { await demoAct(id, s, s === 'snoozed' ? tomorrow9() : undefined); toast(s === 'snoozed' ? 'Snoozed until tomorrow' : s === 'done' ? 'Marked as handled' : 'Dismissed', { action: { label: 'Undo', run: undo } }); }
  catch (err) { AG.data.threads.splice(i, 0, th); recompute(); renderPanel(true); toastErr(err); }
}
async function makeDraft(key, kind, pid, about) {
  state.drafts[key] = { text: 'Writing…', pid }; renderPanel(true);
  try { const r = await API.nudge(kind, pid, about); state.drafts[key] = { text: r.text, pid, subject: kind === 'followup' ? '' : about }; }
  catch (err) { delete state.drafts[key]; toastErr(err); }
  renderPanel(true);
}
function agendaClick(t) {
  const fd = t.closest('[data-fudone]'); if (fd) { setFollowUp(fd.dataset.fudone, { status: 'done', doneAt: new Date().toISOString(), until: undefined }, 'Done. Nice follow-through'); return true; }
  const fs = t.closest('[data-fusnooze]'); if (fs) { setFollowUp(fs.dataset.fusnooze, { status: 'snoozed', until: tomorrow9() }, 'Snoozed until tomorrow'); return true; }
  const th = t.closest('[data-thact]'); if (th) { const [s, id] = th.dataset.thact.split('|'); setThread(id, s); return true; }
  const dr = t.closest('[data-draft]'); if (dr) {
    const [kind, pid, id] = dr.dataset.draft.split('|');
    if (kind === 'followup') { const f = AG.data.followUps.find((x) => x.id === id); makeDraft('f-' + id, kind, pid, f?.title || ''); }
    else { const x = AG.data.threads.find((y) => y.id === id); makeDraft('t-' + id, kind, pid, x?.subject || ''); }
    return true;
  }
  const ud = t.closest('[data-undraft]'); if (ud) { delete state.drafts[ud.dataset.undraft]; renderPanel(true); return true; }
  const mt = t.closest('[data-mailto]'); if (mt) { const k = mt.dataset.mailto, d = state.drafts[k], p = byId(d.pid), body = $('draft-' + k).value; location.href = `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(d.subject ? (/^re:/i.test(d.subject) ? d.subject : 'Re: ' + d.subject) : '')}&body=${encodeURIComponent(body)}`; return true; }
  const mo = t.closest('[data-more]'); if (mo) { state.more[mo.dataset.more] = !state.more[mo.dataset.more]; renderPanel(true); return true; }
  const pl = t.closest('[data-place]'); if (pl) { setLens('place:' + pl.dataset.place); return true; }
  const ta = t.closest('[data-tripask]'); if (ta) { $('askIn').value = ta.dataset.tripask; runAgent(ta.dataset.tripask); return true; }
  const ra = t.closest('[data-runask]'); if (ra) { $('askIn').value = ra.dataset.runask; runAgent(ra.dataset.runask); return true; }
  const jp = t.closest('[data-jump]'); if (jp) { $(jp.dataset.jump)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); return true; }
  const sk = t.closest('[data-capskip]'); if (sk) { const e = AG.data.events.find((x) => x.id === sk.dataset.capskip); if (e) { e.captured = true; recompute(); renderPanel(true); if (e.demo) demoAct(e.id, 'captured').catch(toastErr); } return true; }
  const sa = t.closest('[data-sgadd]'); if (sa) { const g = AG.data.suggested.find((x) => x.email === sa.dataset.sgadd); state.edit = { id: null, from: 'today', prefill: { n: g.name, email: g.email } }; state.tab = 'people'; state.view = 'today'; if (mobile()) $('panel').classList.add('big'); draw(); renderPanel(); return true; }
  const sn = t.closest('[data-sgno]'); if (sn) { const em = sn.dataset.sgno; AG.data.suggested = AG.data.suggested.filter((x) => x.email !== em); recompute(); renderPanel(true); demoAct('demo-sg-' + em, 'dismissed').then(() => toast('Ignored. They won’t be suggested again.'), toastErr); return true; }
  const fa = t.closest('[data-fuadd]'); if (fa) { state.fuFor = fa.dataset.fuadd; renderPanel(true); setTimeout(() => $('fuT')?.focus(), 0); return true; }
  if (t.closest('[data-fucancel]')) { state.fuFor = null; renderPanel(true); return true; }
  const dn = t.closest('[data-delnote]'); if (dn) { const id = dn.dataset.delnote, i = AG.data.notes.findIndex((n) => n.id === id); if (i < 0) return true; const [n] = AG.data.notes.splice(i, 1); recompute(); renderPanel(true); API.deleteNote(id).then(() => toast('Note deleted'), (err) => { AG.data.notes.splice(i, 0, n); recompute(); renderPanel(true); toastErr(err); }); return true; }
  return false;
}
const dueOf = (name) => dueISO(document.querySelector(`input[name="${name}-due"]:checked`)?.value);
async function saveCapture(form) {
  const e = AG.data.events.find((x) => x.id === form.dataset.ev); if (!e) return;
  const body = $('capNote').value.trim(), fuOn = $('capFuOn').checked, fuT = fuOn ? $('capFuT').value.trim() : '';
  if (!body && !fuT) { $('capNote').focus(); toast('Write a quick note, or choose Not now'); return; }
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.classList.add('busy');
  try {
    const note = { id: newId('n'), body: body || fuT, people: e.people, eventId: e.id, at: new Date().toISOString(), source: 'sparkles' };
    const r = await API.saveNote(note); AG.data.notes.unshift(r.note);
    if (fuT) { const f = await API.saveFollowUp({ id: newId('f'), personId: e.people[0], title: fuT, due: dueOf('cap'), status: 'open', origin: 'meeting', eventId: e.id, created: new Date().toISOString() }); AG.data.followUps.push(f.followUp); }
    if (e.demo) demoAct(e.id, 'captured').catch(() => {});
    recompute(); renderPanel(true); if (state.lens === AGENDA) draw();
    toast(`Saved. Last contact with ${namesOf(e.people).join(' and ')}: today`);
  } catch (err) { btn.disabled = false; btn.classList.remove('busy'); toastErr(err); }
}
async function saveNoteForm(form) {
  const pid = form.dataset.pid, ta = $('noteT'), body = ta.value.trim(); if (!body) { ta.focus(); return; }
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.classList.add('busy');
  try { const r = await API.saveNote({ id: newId('n'), body, people: [pid], at: new Date().toISOString(), source: 'sparkles' }); AG.data.notes.unshift(r.note); recompute(); renderPanel(true); toast('Note saved'); }
  catch (err) { btn.disabled = false; btn.classList.remove('busy'); toastErr(err); }
}
async function saveFuForm(form) {
  const pid = form.dataset.pid, title = $('fuT').value.trim(); if (!title) { $('fuT').focus(); return; }
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.classList.add('busy');
  try { const r = await API.saveFollowUp({ id: newId('f'), personId: pid, title, due: dueOf('fu'), status: 'open', origin: 'manual', created: new Date().toISOString() }); AG.data.followUps.push(r.followUp); state.fuFor = null; recompute(); renderPanel(true); toast(r.followUp.due && ms(r.followUp.due) < sod() + DAY ? 'Added. It’s on Today' : 'Follow-up added'); }
  catch (err) { btn.disabled = false; btn.classList.remove('busy'); toastErr(err); }
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
  const ev = g('f-every'); if (ev === '') delete p.every; else p.every = +ev;
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
  if (D.loaded) loadAgenda();
}
// Polling only: refresh on open, every 5 minutes while Today is on screen, and when the tab comes back.
const POLL = 5 * MIN;
function todayOnScreen() { return document.visibilityState === 'visible' && state.view === 'today' && state.tab === 'today'; }
function startPolling() {
  setInterval(() => {
    if (!todayOnScreen()) return;
    if (Date.now() - AG.at >= POLL) loadAgenda(); else { const u = $('agUpd'); if (u) u.textContent = updLabel(); }
  }, MIN);
  document.addEventListener('visibilitychange', () => { if (todayOnScreen() && AG.data && Date.now() - AG.at >= POLL) loadAgenda(); });
}
let started = false;
export async function start(viewer: Viewer, api = FETCH_API) {
  if (started) return () => {};
  started = true;
  VIEWER = viewer; API = api;
  $('cityList').innerHTML = CITIES.slice(0, 2500).map((c) => `<option value="${esc(c[0])}, ${esc(COUNTRY_NAMES[c[1]] || c[1])}">`).join('');
  initMap(); bindMap(); bindBar(); bindPanel(); bindAccount(); renderAccount(); if (hasAgenda()) startPolling();
  setCircles([]); drawBar(); renderPanel();
  const onResize = () => { layout(); };
  addEventListener('resize', onResize); layout();
  await loadAll();
  if (D.people.some(placed)) fitItems(D.people.filter(placed));
  else if (home()) flyLL(home().lat, home().lng, 2.4);
  return () => removeEventListener('resize', onResize);
}
