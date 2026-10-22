-- Sparkles agenda: native notes and follow-ups, connected accounts, synced calendar
-- and email metadata, and suggested people. Run after 0001_sparkles.sql.
-- Every user table follows 0001: a user_id column, RLS limited to the member's own rows,
-- and person references through (user_id, person_id) -> people(user_id, id) on delete cascade.

create extension if not exists citext;

-- People: cadence and the computed "last interaction".
alter table public.people add column if not exists reconnect_days int check (reconnect_days is null or reconnect_days between 1 and 3650);
alter table public.people add column if not exists reconnect_off boolean not null default false;
alter table public.people add column if not exists last_interaction_at timestamptz;
alter table public.people add column if not exists last_interaction_kind text check (last_interaction_kind in ('talked','meeting','email','note'));
alter table public.people add column if not exists birthday date;

-- Profiles: dashboard preferences (reply thresholds, ignored domains, brief lead time,
-- visible modules) and demo-mode state (on/off plus actions on demo items, keyed by demo id).
alter table public.profiles add column if not exists agenda jsonb;

-- Several emails per person; the key for matching calendar attendees and email senders.
create table if not exists public.person_emails (
  user_id uuid not null references auth.users on delete cascade,
  person_id text not null,
  email citext not null,
  source text not null default 'manual' check (source in ('manual','import','match')),
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, email),
  foreign key (user_id, person_id) references public.people (user_id, id) on delete cascade
);
create index if not exists person_emails_person on public.person_emails (user_id, person_id);

-- Connected accounts hold encrypted OAuth tokens. Only the server (service role) reads them.
create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('google','microsoft','notion')),
  account_email citext,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','reauth','revoked')),
  token_ciphertext bytea,
  token_nonce bytea,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider, account_email)
);

-- What the Connections screen may show: no tokens.
create or replace view public.my_connected_accounts with (security_barrier = on) as
  select id, provider, account_email, scopes, status, expires_at, created_at
    from public.connected_accounts
   where user_id = auth.uid() and public.is_member();

-- Connectors the user turned on in the picker, and what they chose to share.
create table if not exists public.connectors (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('gcal','gmail','outlook_cal','outlook_mail','notion','gdocs','onenote','md_folder')),
  account_id uuid references public.connected_accounts on delete set null,
  enabled boolean not null default false,
  selection jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Incremental sync cursors (syncToken, historyId, deltaLink, last_edited_time). Server only.
create table if not exists public.sync_state (
  account_id uuid not null references public.connected_accounts on delete cascade,
  resource text not null,
  cursor text,
  last_synced_at timestamptz,
  last_error text,
  locked_until timestamptz,
  primary key (account_id, resource)
);

-- Calendar events that involve at least one person on the map.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references public.connected_accounts on delete cascade,
  provider_id text not null,
  ical_uid text,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  ck text,
  join_url text,
  status text,
  is_private boolean not null default false,
  description text check (description is null or length(description) <= 2000),
  description_links text[] not null default '{}',
  organizer_email citext,
  attendees jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (account_id, provider_id)
);
create index if not exists events_user_start on public.events (user_id, starts_at);

create table if not exists public.event_people (
  user_id uuid not null references auth.users on delete cascade,
  event_id uuid not null references public.events on delete cascade,
  person_id text not null,
  response text,
  primary key (event_id, person_id),
  foreign key (user_id, person_id) references public.people (user_id, id) on delete cascade
);
create index if not exists event_people_person on public.event_people (user_id, person_id);

-- Email thread metadata. No bodies, ever.
create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references public.connected_accounts on delete cascade,
  provider_thread_id text not null,
  subject text,
  participants citext[] not null default '{}',
  first_at timestamptz,
  last_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  awaiting text check (awaiting in ('me','them')),
  snoozed_until timestamptz,
  dismissed boolean not null default false,
  unique (account_id, provider_thread_id)
);
create index if not exists email_threads_user_last on public.email_threads (user_id, last_at desc);

create table if not exists public.thread_people (
  user_id uuid not null references auth.users on delete cascade,
  thread_id uuid not null references public.email_threads on delete cascade,
  person_id text not null,
  primary key (thread_id, person_id),
  foreign key (user_id, person_id) references public.people (user_id, id) on delete cascade
);
create index if not exists thread_people_person on public.thread_people (user_id, person_id);

-- Notes: native ('sparkles') and imported from connectors.
-- event_id is text so a note can point at a synced event (uuid) or a demo event id.
create table if not exists public.notes (
  user_id uuid not null references auth.users on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,60}$'),
  source text not null default 'sparkles' check (source in ('sparkles','notion','gdocs','onenote','md_folder')),
  external_id text,
  url text,
  title text,
  body_md text not null default '' check (length(body_md) <= 20000),
  event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists notes_user_created on public.notes (user_id, created_at desc);

create table if not exists public.note_people (
  user_id uuid not null references auth.users on delete cascade,
  note_id text not null,
  person_id text not null,
  primary key (user_id, note_id, person_id),
  foreign key (user_id, note_id) references public.notes (user_id, id) on delete cascade,
  foreign key (user_id, person_id) references public.people (user_id, id) on delete cascade
);
create index if not exists note_people_person on public.note_people (user_id, person_id);

create table if not exists public.follow_ups (
  user_id uuid not null references auth.users on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,60}$'),
  person_id text not null,
  title text not null check (length(title) <= 300),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','snoozed')),
  snoozed_until timestamptz,
  origin text not null default 'manual' check (origin in ('manual','meeting','email','cadence','ai')),
  event_id text,
  thread_id text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, person_id) references public.people (user_id, id) on delete cascade
);
create index if not exists follow_ups_user_due on public.follow_ups (user_id, status, due_at);

-- Frequent correspondents not on the map. Suggested for approval, never added automatically.
create table if not exists public.suggested_people (
  user_id uuid not null references auth.users on delete cascade,
  email citext not null,
  name text,
  evidence jsonb not null default '{}',
  status text not null default 'new' check (status in ('new','added','ignored')),
  updated_at timestamptz not null default now(),
  primary key (user_id, email)
);

-- Row level security.
alter table public.person_emails enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.connectors enable row level security;
alter table public.sync_state enable row level security;
alter table public.events enable row level security;
alter table public.event_people enable row level security;
alter table public.email_threads enable row level security;
alter table public.thread_people enable row level security;
alter table public.notes enable row level security;
alter table public.note_people enable row level security;
alter table public.follow_ups enable row level security;
alter table public.suggested_people enable row level security;

do $$
declare t text;
begin
  foreach t in array array['person_emails','connectors','events','event_people','email_threads','thread_people','notes','note_people','follow_ups','suggested_people'] loop
    execute format('drop policy if exists "own %1$s" on public.%1$I', t);
    execute format('create policy "own %1$s" on public.%1$I for all to authenticated using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member())', t);
  end loop;
end $$;

-- Tokens and sync cursors: service role only, like invites.
revoke all on table public.connected_accounts from anon, authenticated;
revoke all on table public.sync_state from anon, authenticated;
revoke all on table public.my_connected_accounts from anon;
grant select on public.my_connected_accounts to authenticated;

-- Everything known about each person's interactions, for the timeline and "last interaction".
create or replace view public.interactions with (security_invoker = on) as
  select ep.user_id, ep.person_id, 'meeting'::text as kind, e.id::text as item_id, e.title, coalesce(e.ends_at, e.starts_at) as at
    from public.event_people ep join public.events e on e.id = ep.event_id
   where coalesce(e.ends_at, e.starts_at) <= now()
  union all
  select tp.user_id, tp.person_id, 'email', t.id::text, t.subject, t.last_at
    from public.thread_people tp join public.email_threads t on t.id = tp.thread_id
  union all
  select np.user_id, np.person_id, 'note', n.id, coalesce(n.title, left(n.body_md, 80)), n.created_at
    from public.note_people np join public.notes n on n.user_id = np.user_id and n.id = np.note_id
  union all
  select p.user_id, p.id, 'talked', null, null, p.last_talked
    from public.people p where p.last_talked is not null;
