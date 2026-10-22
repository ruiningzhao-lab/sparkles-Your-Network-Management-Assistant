import type { FollowUp, Note, Person, Place } from '@/lib/store/types';

/** Someone on an event or thread who isn't on the map (or a demo name with no record). */
export type Guest = { name: string; email?: string };

export type AgendaEvent = {
  id: string;
  title: string;
  start: string; // ISO
  end: string;
  allDay?: boolean;
  location?: string;
  ck?: string; // city key, when the location resolves to a city
  city?: string;
  joinUrl?: string;
  description?: string; // cleaned plain text, at most 2,000 characters
  links?: string[];
  people: string[]; // person ids on the map
  guests?: Guest[];
  demo?: boolean;
  captured?: boolean; // the after-meeting prompt was answered or dismissed
};

/** Email thread metadata only: never bodies. */
export type Thread = {
  id: string;
  subject: string;
  people: string[];
  guests?: Guest[];
  lastAt: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  awaiting: 'me' | 'them';
  demo?: boolean;
};

export type Suggested = { email: string; name: string; meetings: number; threads: number; lastAt: string; demo?: boolean };

/** What a source returns. Times are ISO strings. */
export type AgendaData = {
  events: AgendaEvent[];
  threads: Thread[];
  notes: Note[];
  followUps: FollowUp[];
  suggested: Suggested[];
};

export type SourceContext = { people: Person[]; home: Place | null; now: Date; tzOffset: number };

export interface AgendaSource {
  kind: 'demo' | 'none';
  fetch(ctx: SourceContext): Promise<AgendaData>;
}

/** The /api/agenda response. */
export type AgendaPayload = AgendaData & {
  updatedAt: string;
  demo: boolean;
  canDemo: boolean;
  connected: boolean;
  defaultEvery: number;
  replyHours: number;
  waitDays: number;
};
