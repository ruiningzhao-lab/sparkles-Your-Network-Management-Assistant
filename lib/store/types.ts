// Shapes shared by the browser and the server. Field names match the map UI.

/** A circle is a user-defined group (for example Work, Friends, Family). Stored by id. */
export type Circle = { id: string; label: string; color: number };
export type Mode = string; // circle id, or '' for none

export type Place = {
  city: string;
  cc: string;
  country: string;
  lat: number;
  lng: number;
  tz: string;
  ck: string;
};

export type Person = Partial<Place> & {
  id: string;
  n: string; // name
  m: Mode;
  role?: string;
  company?: string;
  tags?: string[];
  doing?: string; // what they're up to
  note?: string;
  last?: string; // ISO date last talked
  url?: string;
  email?: string;
  src?: string[];
  next?: string; // suggested next step
  connected?: string;
  added?: number;
};

export type Plan = {
  id: string;
  kind: string;
  ic: string;
  when: string;
  title: string;
  with: string[];
  why: string;
  where: string;
};

export type Discover = Place & { id: string; t: 'disc'; g: string; n: string; k: string; doing: string };

export type Section = { h: string; ids: string[]; why?: Record<string, string> };

export type MapDoc = {
  id: string;
  prompt: string;
  title: string;
  chip: string;
  m: Mode;
  sub: string;
  plans: Plan[];
  sec: Section[];
  disc: Discover[];
  state: Record<string, { planned: number }>;
  at: number;
};

export type Profile = { home: Place | null; circles?: Circle[] };

export interface Store {
  load(): Promise<{ profile: Profile | null; people: Person[]; maps: MapDoc[] }>;
  saveProfile(p: Profile): Promise<void>;
  listPeople(): Promise<Person[]>;
  upsertPeople(list: Person[]): Promise<void>;
  deletePerson(id: string): Promise<void>;
  deleteAllPeople(): Promise<void>;
  getMap(id: string): Promise<MapDoc | null>;
  saveMap(m: MapDoc): Promise<void>;
  setMapState(id: string, state: MapDoc['state']): Promise<void>;
  deleteMap(id: string): Promise<void>;
}
