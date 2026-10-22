-- Sparkles schema: invite-only membership, and private per-user people, profiles and maps.
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- Members: who may use the app. Created by the server when an invite is redeemed.
create table if not exists public.members (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  name text,
  is_admin boolean not null default false,
  invited_by uuid references auth.users on delete set null,
  invite_code text,
  created_at timestamptz not null default now()
);

-- Invites: only the server (service role) reads or writes these.
create table if not exists public.invites (
  code text primary key,
  created_by uuid references auth.users on delete set null,
  email text,
  note text,
  max_uses int not null default 1 check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  revoked boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  home jsonb,
  circles jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.people (
  user_id uuid not null references auth.users on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  name text not null,
  mode text,
  city text, cc text, country text,
  lat double precision, lng double precision, tz text, ck text,
  role text, company text,
  tags text[] not null default '{}',
  doing text, note text,
  last_talked timestamptz,
  url text, email text,
  src text[] not null default '{}',
  next_step text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists people_user_created on public.people (user_id, created_at);

create table if not exists public.maps (
  user_id uuid not null references auth.users on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  prompt text not null,
  title text not null,
  chip text, mode text, sub text,
  plans jsonb not null default '[]',
  sec jsonb not null default '[]',
  disc jsonb not null default '[]',
  plan_state jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists maps_user_created on public.maps (user_id, created_at desc);

-- Row level security: each member sees and changes only their own rows.
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.maps enable row level security;

drop policy if exists "read own membership" on public.members;
create policy "read own membership" on public.members for select to authenticated using (user_id = auth.uid());

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "own people" on public.people;
create policy "own people" on public.people for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "own maps" on public.maps;
create policy "own maps" on public.maps for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());

-- Redeem an invite atomically: counts one use and creates the membership.
create or replace function public.redeem_invite(p_code text, p_user uuid, p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_by uuid;
begin
  if exists (select 1 from public.members where user_id = p_user) then return true; end if;
  update public.invites set uses = uses + 1
   where code = p_code and not revoked and uses < max_uses
     and (expires_at is null or expires_at > now())
     and (email is null or lower(email) = lower(p_email))
  returning created_by into v_by;
  if not found then return false; end if;
  insert into public.members (user_id, email, invited_by, invite_code)
  values (p_user, p_email, v_by, p_code) on conflict (user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.redeem_invite(text, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text, uuid, text) to service_role;
revoke all on table public.invites from anon, authenticated;
