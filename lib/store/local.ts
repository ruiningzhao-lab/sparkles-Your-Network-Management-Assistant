import { promises as fs } from 'fs';
import path from 'path';
import type { AgendaPrefs, FollowUp, MapDoc, Note, Person, Profile, Store } from './types';

// Local mode: one JSON file per user under .data/. For trying Sparkles on your own machine.
type Data = { profile: Profile | null; people: Person[]; maps: MapDoc[]; notes?: Note[]; followUps?: FollowUp[] };
const DIR = path.join(process.cwd(), '.data');
let chain: Promise<unknown> = Promise.resolve();

export class LocalStore implements Store {
  constructor(private userId: string) {}
  private file() {
    return path.join(DIR, `${this.userId.replace(/[^a-z0-9_-]/gi, '')}.json`);
  }
  private async read(): Promise<Data> {
    try {
      return JSON.parse(await fs.readFile(this.file(), 'utf8'));
    } catch {
      return { profile: null, people: [], maps: [] };
    }
  }
  // Serialize writes so concurrent requests never lose each other's changes.
  private change(fn: (d: Data) => void): Promise<void> {
    const run = chain.then(async () => {
      const d = await this.read();
      fn(d);
      await fs.mkdir(DIR, { recursive: true });
      const tmp = this.file() + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(d));
      await fs.rename(tmp, this.file());
    });
    chain = run.catch(() => {});
    return run;
  }
  private async data() {
    await chain;
    return this.read();
  }
  async load() {
    const d = await this.data();
    return { profile: d.profile, people: d.people, maps: d.maps };
  }
  async saveProfile(p: Profile) {
    await this.change((d) => {
      d.profile = { ...p, agenda: p.agenda ?? d.profile?.agenda };
    });
  }
  async listPeople() {
    return (await this.data()).people;
  }
  async upsertPeople(list: Person[]) {
    await this.change((d) => {
      const idx = new Map(d.people.map((p, i) => [p.id, i]));
      for (const p of list) {
        const i = idx.get(p.id);
        if (i === undefined) {
          idx.set(p.id, d.people.length);
          d.people.push(p);
        } else d.people[i] = p;
      }
    });
  }
  // Mirrors the cascades in 0002_agenda.sql: follow-ups go with the person, notes lose the link.
  private unlink(d: Data, gone: (id: string) => boolean) {
    d.followUps = (d.followUps || []).filter((f) => !gone(f.personId));
    d.notes = (d.notes || []).map((n) => ({ ...n, people: n.people.filter((id) => !gone(id)) }));
  }
  async deletePerson(id: string) {
    await this.change((d) => {
      d.people = d.people.filter((p) => p.id !== id);
      this.unlink(d, (x) => x === id);
    });
  }
  async deleteAllPeople() {
    await this.change((d) => {
      d.people = [];
      this.unlink(d, () => true);
    });
  }
  async getMap(id: string) {
    return (await this.data()).maps.find((m) => m.id === id) || null;
  }
  async saveMap(m: MapDoc) {
    await this.change((d) => {
      d.maps = [m, ...d.maps.filter((x) => x.id !== m.id)];
    });
  }
  async setMapState(id: string, state: MapDoc['state']) {
    await this.change((d) => {
      const m = d.maps.find((x) => x.id === id);
      if (m) m.state = state;
    });
  }
  async deleteMap(id: string) {
    await this.change((d) => {
      d.maps = d.maps.filter((m) => m.id !== id);
    });
  }
  async saveAgendaPrefs(a: AgendaPrefs) {
    await this.change((d) => {
      d.profile = { home: d.profile?.home || null, circles: d.profile?.circles, agenda: a };
    });
  }
  async listNotes(limit = 300) {
    return [...((await this.data()).notes || [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
  async saveNote(n: Note) {
    await this.change((d) => {
      d.notes = [n, ...(d.notes || []).filter((x) => x.id !== n.id)];
    });
  }
  async deleteNote(id: string) {
    await this.change((d) => {
      d.notes = (d.notes || []).filter((x) => x.id !== id);
    });
  }
  async listFollowUps() {
    return (await this.data()).followUps || [];
  }
  async saveFollowUp(f: FollowUp) {
    await this.change((d) => {
      d.followUps = [f, ...(d.followUps || []).filter((x) => x.id !== f.id)];
    });
  }
  async deleteFollowUp(id: string) {
    await this.change((d) => {
      d.followUps = (d.followUps || []).filter((x) => x.id !== id);
    });
  }
}
