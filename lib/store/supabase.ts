import type { SupabaseClient } from '@supabase/supabase-js';
import type { MapDoc, Person, Profile, Store } from './types';

// Supabase store. Uses the signed-in user's client, so row level security
// limits every query to that user's own rows.

type PersonRow = Record<string, any>;

const toRow = (uid: string, p: Person): PersonRow => ({
  user_id: uid,
  id: p.id,
  name: p.n,
  mode: p.m || null,
  city: p.city ?? null,
  cc: p.cc ?? null,
  country: p.country ?? null,
  lat: p.lat ?? null,
  lng: p.lng ?? null,
  tz: p.tz ?? null,
  ck: p.ck ?? null,
  role: p.role || null,
  company: p.company || null,
  tags: p.tags || [],
  doing: p.doing || null,
  note: p.note || null,
  last_talked: p.last || null,
  url: p.url || null,
  email: p.email || null,
  src: p.src || [],
  next_step: p.next || null,
  connected_at: p.connected || null,
  created_at: new Date(p.added || Date.now()).toISOString(),
  updated_at: new Date().toISOString(),
});

const fromRow = (r: PersonRow): Person => {
  const p: Person = {
    id: r.id,
    n: r.name,
    m: r.mode || '',
    role: r.role || undefined,
    company: r.company || undefined,
    tags: r.tags || [],
    doing: r.doing || undefined,
    note: r.note || undefined,
    last: r.last_talked || undefined,
    url: r.url || undefined,
    email: r.email || undefined,
    src: r.src || [],
    next: r.next_step || undefined,
    connected: r.connected_at || undefined,
    added: r.created_at ? new Date(r.created_at).getTime() : undefined,
  };
  if (r.lat !== null && r.lng !== null) {
    Object.assign(p, { city: r.city || '', cc: r.cc || '', country: r.country || '', lat: r.lat, lng: r.lng, tz: r.tz || '', ck: r.ck || `${r.city}|${r.cc}` });
  }
  return p;
};

const mapFromRow = (r: Record<string, any>): MapDoc => ({
  id: r.id,
  prompt: r.prompt,
  title: r.title,
  chip: r.chip || 'Map',
  m: r.mode || '',
  sub: r.sub || '',
  plans: r.plans || [],
  sec: r.sec || [],
  disc: r.disc || [],
  state: r.plan_state || {},
  at: new Date(r.created_at).getTime(),
});

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient, private uid: string) {}

  async load() {
    const [prof, people, maps] = await Promise.all([
      this.db.from('profiles').select('home,circles').eq('user_id', this.uid).maybeSingle(),
      this.listPeople(),
      this.db.from('maps').select('*').eq('user_id', this.uid).order('created_at', { ascending: false }).limit(200),
    ]);
    check(prof.error);
    check(maps.error);
    return {
      profile: prof.data ? ({ home: prof.data.home, circles: prof.data.circles || undefined } as Profile) : null,
      people,
      maps: (maps.data || []).map(mapFromRow),
    };
  }
  async saveProfile(p: Profile) {
    const { error } = await this.db.from('profiles').upsert({ user_id: this.uid, home: p.home, circles: p.circles || null, updated_at: new Date().toISOString() });
    check(error);
  }
  async listPeople() {
    const out: Person[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from('people').select('*').eq('user_id', this.uid).order('created_at').range(from, from + 999);
      check(error);
      out.push(...(data || []).map(fromRow));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async upsertPeople(list: Person[]) {
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await this.db.from('people').upsert(list.slice(i, i + 500).map((p) => toRow(this.uid, p)));
      check(error);
    }
  }
  async deletePerson(id: string) {
    const { error } = await this.db.from('people').delete().eq('user_id', this.uid).eq('id', id);
    check(error);
  }
  async deleteAllPeople() {
    const { error } = await this.db.from('people').delete().eq('user_id', this.uid);
    check(error);
  }
  async getMap(id: string) {
    const { data, error } = await this.db.from('maps').select('*').eq('user_id', this.uid).eq('id', id).maybeSingle();
    check(error);
    return data ? mapFromRow(data) : null;
  }
  async saveMap(m: MapDoc) {
    const { error } = await this.db.from('maps').upsert({
      user_id: this.uid,
      id: m.id,
      prompt: m.prompt,
      title: m.title,
      chip: m.chip,
      mode: m.m,
      sub: m.sub,
      plans: m.plans,
      sec: m.sec,
      disc: m.disc,
      plan_state: m.state,
      created_at: new Date(m.at).toISOString(),
    });
    check(error);
  }
  async setMapState(id: string, state: MapDoc['state']) {
    const { error } = await this.db.from('maps').update({ plan_state: state }).eq('user_id', this.uid).eq('id', id);
    check(error);
  }
  async deleteMap(id: string) {
    const { error } = await this.db.from('maps').delete().eq('user_id', this.uid).eq('id', id);
    check(error);
  }
}
