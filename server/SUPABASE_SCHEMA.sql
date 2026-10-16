-- SUPABASE_SCHEMA.sql — Phase 5 production shape (Postgres).
-- The Node server's db.json mirrors these tables 1:1 so it can be swapped out.
-- Apply in Supabase SQL editor, then set SUPABASE_URL + SUPABASE_ANON_KEY.

create table if not exists accounts (
  id text primary key,
  name text not null default 'Racer',
  skin text not null default 'default',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists profiles (
  account_id text primary key references accounts(id) on delete cascade,
  money integer not null default 80,
  gems integer not null default 14,
  xp integer not null default 0,
  unlocked_skins text[] not null default array['default'],
  equipped_skin text not null default 'default',
  races integer not null default 0,
  wins integer not null default 0,
  kills integer not null default 0,
  best_pos integer not null default 6,
  season_id text not null default 'S1',
  season_points integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists matches (
  id bigint generated always as identity primary key,
  account_id text not null references accounts(id) on delete cascade,
  rank integer not null check (rank between 1 and 6),
  money integer not null default 0,
  xp integer not null default 0,
  season text not null default 'S1',
  created_at timestamptz not null default now()
);
create index if not exists matches_account_idx on matches(account_id, created_at desc);

-- Fast leaderboard: top XP. (Upstash Redis sorted set mirrors this in production.)
create or replace view leaderboard as
  select a.name, p.xp, p.wins, p.races, p.season_points
  from profiles p join accounts a on a.id = p.account_id
  order by p.xp desc
  limit 100;

-- Row Level Security: authenticated users read the board, service role writes.
alter table accounts enable row level security;
alter table profiles enable row level security;
alter table matches enable row level security;
create policy "board readable" on profiles for select using (true);

-- Phase 9/11/12 migration: shop inventory, banner stats (24h window enforced
-- in app code — a nightly job or partial index keeps the table small).
alter table profiles
  add column if not exists vehicles text[] not null default array['falcon_s'],
  add column if not exists equipped_vehicle text not null default 'falcon_s',
  add column if not exists weapons text[] not null default array['mg'],
  add column if not exists mounts jsonb not null default '{"slot1":"mg","slot2":null}',
  add column if not exists upgrades jsonb not null default '{}';

create table if not exists banner_events (
  id bigint generated always as identity primary key,
  banner_id text not null,
  account_id text not null references accounts(id) on delete cascade,
  action text not null check (action in ('view','bump','like')),
  created_at timestamptz not null default now()
);
create index if not exists banner_events_recent_idx on banner_events(banner_id, created_at desc);
alter table banner_events enable row level security;
