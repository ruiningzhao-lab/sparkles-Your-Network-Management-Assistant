import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgendaPrefs, FollowUp, MapDoc, Note, Person, Profile, Store } from './types';

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
  reconnect_days: p.every ? p.every : null,
  reconnect_off: p.every === 0,
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
    every: r.reconnect_off ? 0 : r.reconnect_days || undefined,
  };
  if (r.lat !== null && r.lng !== null) {
    Object.assign(p, { city: r.city || '', cc: r.cc || '', country: r.country || '', lat: r.lat, lng: r.lng, tz: r.tz || '', ck: r.ck || `${r.city}|${r.cc}` });
  }
  return p;
};

const noteFromRow = (r: Record<string, any>): Note => ({
  id: r.id,
  body: r.body_md || '',
  title: r.title || undefined,
  people: (r.note_people || []).map((x: { person_id: string }) => x.person_id),
  eventId: r.event_id || undefined,
  source: r.source,
  url: r.url || undefined,
  at: r.created_at,
  updated: r.updated_at,
});

const fuFromRow = (r: Record<string, any>): FollowUp => ({
  id: r.id,
  personId: r.person_id,
  title: r.title,
  due: r.due_at || undefined,
  status: r.status,
  until: r.snoozed_until || undefined,
  origin: r.origin,
  eventId: r.event_id || undefined,
  threadId: r.thread_id || undefined,
  created: r.created_at,
  doneAt: r.done_at || undefined,
});

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
      this.db.from('profiles').select('home,circles,agenda').eq('user_id', this.uid).maybeSingle(),
      this.listPeople(),
      this.db.from('maps').select('*').eq('user_id', this.uid).order('created_at', { ascending: false }).limit(200),
    ]);
    check(prof.error);
    check(maps.error);
    return {
      profile: prof.data ? ({ home: prof.data.home, circles: prof.data.circles || undefined, agenda: prof.data.agenda || undefined } as Profile) : null,
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
      const batch = list.slice(i, i + 500);
      const { error } = await this.db.from('people').upsert(batch.map((p) => toRow(this.uid, p)));
      check(error);
      await this.syncEmails(batch);
    }
  }
  // Keep person_emails in step with each person's main email. Matched addresses are left alone.
  private async syncEmails(batch: Person[]) {
    const del = await this.db.from('person_emails').delete().eq('user_id', this.uid).eq('source', 'manual').in('person_id', batch.map((p) => p.id));
    check(del.error);
    const rows = batch.filter((p) => p.email && p.email.includes('@')).map((p) => ({ user_id: this.uid, person_id: p.id, email: p.email!.toLowerCase(), source: 'manual', confirmed: true }));
    if (!rows.length) return;
    const { error } = await this.db.from('person_emails').upsert(rows, { onConflict: 'user_id,email' });
    check(error);
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
  async saveAgendaPrefs(a: AgendaPrefs) {
    const { data, error } = await this.db.from('profiles').update({ agenda: a, updated_at: new Date().toISOString() }).eq('user_id', this.uid).select('user_id');
    check(error);
    if (!data?.length) check((await this.db.from('profiles').insert({ user_id: this.uid, home: null, agenda: a })).error);
  }
  async listNotes(limit = 300) {
    const { data, error } = await this.db.from('notes').select('*, note_people(person_id)').eq('user_id', this.uid).order('created_at', { ascending: false }).limit(limit);
    check(error);
    return (data || []).map(noteFromRow);
  }
  async saveNote(n: Note) {
    const { error } = await this.db.from('notes').upsert({
      user_id: this.uid,
      id: n.id,
      source: n.source,
      url: n.url || null,
      title: n.title || null,
      body_md: n.body,
      event_id: n.eventId || null,
      created_at: n.at,
      updated_at: new Date().toISOString(),
    });
    check(error);
    check((await this.db.from('note_people').delete().eq('user_id', this.uid).eq('note_id', n.id)).error);
    if (n.people.length) check((await this.db.from('note_people').insert(n.people.map((person_id) => ({ user_id: this.uid, note_id: n.id, person_id })))).error);
  }
  async deleteNote(id: string) {
    check((await this.db.from('notes').delete().eq('user_id', this.uid).eq('id', id)).error);
  }
  async listFollowUps() {
    const { data, error } = await this.db.from('follow_ups').select('*').eq('user_id', this.uid).order('created_at', { ascending: false }).limit(1000);
    check(error);
    return (data || []).map(fuFromRow);
  }
  async saveFollowUp(f: FollowUp) {
    const { error } = await this.db.from('follow_ups').upsert({
      user_id: this.uid,
      id: f.id,
      person_id: f.personId,
      title: f.title,
      due_at: f.due || null,
      status: f.status,
      snoozed_until: f.until || null,
      origin: f.origin,
      event_id: f.eventId || null,
      thread_id: f.threadId || null,
      created_at: f.created,
      done_at: f.doneAt || null,
    });
    check(error);
  }
  async deleteFollowUp(id: string) {
    check((await this.db.from('follow_ups').delete().eq('user_id', this.uid).eq('id', id)).error);
  }
}
