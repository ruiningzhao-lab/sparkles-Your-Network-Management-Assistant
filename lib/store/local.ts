import { promises as fs } from 'fs';
import path from 'path';
import type { MapDoc, Person, Profile, Store } from './types';

// Local mode: one JSON file per user under .data/. For trying Sparkles on your own machine.
type Data = { profile: Profile | null; people: Person[]; maps: MapDoc[] };
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
  async load() {
    await chain;
    return this.read();
  }
  async saveProfile(p: Profile) {
    await this.change((d) => {
      d.profile = p;
    });
  }
  async listPeople() {
    return (await this.load()).people;
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
  async deletePerson(id: string) {
    await this.change((d) => {
      d.people = d.people.filter((p) => p.id !== id);
    });
  }
  async deleteAllPeople() {
    await this.change((d) => {
      d.people = [];
    });
  }
  async getMap(id: string) {
    return (await this.load()).maps.find((m) => m.id === id) || null;
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
}
