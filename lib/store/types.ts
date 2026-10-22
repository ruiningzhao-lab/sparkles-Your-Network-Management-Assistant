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
  every?: number; // reach-out cadence in days; 0 turns reminders off, unset uses the default
};

/** A note you wrote, or one imported from a notes connector. */
export type Note = {
  id: string;
  body: string;
  title?: string;
  people: string[];
  eventId?: string;
  source: 'sparkles' | 'notion' | 'gdocs' | 'onenote' | 'md_folder';
  url?: string;
  at: string; // ISO
  updated?: string;
  demo?: boolean;
};

export type FollowUp = {
  id: string;
  personId: string;
  title: string;
  due?: string; // ISO
  status: 'open' | 'done' | 'snoozed';
  until?: string; // snoozed until, ISO
  origin: 'manual' | 'meeting' | 'email' | 'cadence' | 'ai';
  eventId?: string;
  threadId?: string;
  created: string;
  doneAt?: string;
  demo?: boolean;
};

/** Actions taken on generated demo items, keyed by demo id. */
export type DemoAct = { s: 'done' | 'snoozed' | 'dismissed' | 'captured'; until?: string };

export type AgendaPrefs = {
  demo?: boolean; // true: on, false: exited; unset: automatic (on in local mode)
  acts?: Record<string, DemoAct>;
  replyHours?: number;
  waitDays?: number;
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
  topic?: string; // set by the offline fallback, used to write its draft
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

export type Profile = { home: Place | null; circles?: Circle[]; agenda?: AgendaPrefs };

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
  saveAgendaPrefs(a: AgendaPrefs): Promise<void>;
  listNotes(limit?: number): Promise<Note[]>;
  saveNote(n: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  listFollowUps(): Promise<FollowUp[]>;
  saveFollowUp(f: FollowUp): Promise<void>;
  deleteFollowUp(id: string): Promise<void>;
}
