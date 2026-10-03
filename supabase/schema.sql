-- Baby Tracker — Supabase schema (run once in SQL Editor: Dashboard → SQL → New query)
-- Two-axis feed model: delivery (breast|bottle) × substance (breast_milk|formula).
-- NEVER collapse these — every KPI depends on the separation.
--
-- Safe to re-run: every statement below is idempotent (IF NOT EXISTS / CREATE
-- OR REPLACE / DROP ... IF EXISTS before CREATE), so pasting the whole file
-- into an existing project's SQL Editor only adds whatever's missing — useful
-- after pulling updates from a fork that added new tables/functions. It will
-- never drop or alter data in a destructive way.

do $$ begin
  create type feed_delivery as enum ('breast', 'bottle');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feed_substance as enum ('breast_milk', 'formula');
exception when duplicate_object then null; end $$;
do $$ begin
  create type breast_side as enum ('L', 'R', 'both');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- children --
create table if not exists children (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dob date not null,
  birth_weight_g int,
  created_at timestamptz not null default now()
);

-- Multi-caregiver access: membership junction against Supabase auth users.
create table if not exists caregivers (
  child_id uuid not null references children (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (child_id, user_id)
);

-- ------------------------------------------------------------------ events --
create table if not exists feeds (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  delivery feed_delivery not null,
  substance feed_substance not null,
  volume_ml int check (volume_ml is null or volume_ml between 0 and 500),
  duration_min int check (duration_min is null or duration_min between 0 and 240),
  side breast_side,
  note text,
  -- natural key for idempotent CSV import; app rows get a random one
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- direct feeds are always breast milk and never have a measured volume
  constraint direct_is_breast_milk
    check (delivery = 'bottle' or substance = 'breast_milk'),
  constraint direct_has_no_volume
    check (delivery = 'bottle' or volume_ml is null)
);

create table if not exists pumps (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  left_ml int check (left_ml is null or left_ml between 0 and 500),
  right_ml int check (right_ml is null or right_ml between 0 and 500),
  total_ml int not null check (total_ml between 0 and 1000),
  duration_min int,
  note text,
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists diapers (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  wet boolean not null default false,
  dirty boolean not null default false,
  stool_colour text,
  note text,
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists sleeps (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  start_ts timestamptz not null,
  end_ts timestamptz,                   -- null while the sleep timer is running
  note text,
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint sleep_ends_after_start check (end_ts is null or end_ts >= start_ts)
);

create table if not exists growth (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  measured_at date not null,
  weight_g int check (weight_g is null or weight_g between 1000 and 30000),
  length_cm numeric(5, 1),
  head_cm numeric(5, 1),
  note text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- idempotent CSV re-imports: same source row can never duplicate
create unique index if not exists feeds_source_key on feeds (child_id, source_key);
create unique index if not exists pumps_source_key on pumps (child_id, source_key);
create unique index if not exists diapers_source_key on diapers (child_id, source_key);
create unique index if not exists sleeps_source_key on sleeps (child_id, source_key);

create index if not exists feeds_child_ts on feeds (child_id, ts desc);
create index if not exists pumps_child_ts on pumps (child_id, ts desc);
create index if not exists diapers_child_ts on diapers (child_id, ts desc);
create index if not exists sleeps_child_ts on sleeps (child_id, start_ts desc);
create index if not exists growth_child_ts on growth (child_id, measured_at desc);

-- ------------------------------------------------------- helper + policies --
-- true when the signed-in user is a caregiver of the child
create or replace function is_caregiver(child uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from caregivers
                  where child_id = child and user_id = auth.uid()) $$;

-- whoever creates a child automatically becomes its first caregiver
create or replace function add_creator_as_caregiver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into caregivers (child_id, user_id) values (new.id, auth.uid());
  return new;
end $$;

drop trigger if exists children_creator_caregiver on children;
create trigger children_creator_caregiver
  after insert on children
  for each row execute function add_creator_as_caregiver();

-- an existing caregiver invites another (the invitee must have signed up already)
create or replace function add_caregiver_by_email(child uuid, caregiver_email text)
returns void language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if not is_caregiver(child) then
    raise exception 'only an existing caregiver can invite';
  end if;
  select id into target from auth.users where lower(email) = lower(caregiver_email);
  if target is null then
    raise exception 'no account with that email — they need to sign up first';
  end if;
  insert into caregivers (child_id, user_id)
  values (child, target) on conflict do nothing;
end $$;

alter table children enable row level security;
alter table caregivers enable row level security;
alter table feeds enable row level security;
alter table pumps enable row level security;
alter table diapers enable row level security;
alter table sleeps enable row level security;
alter table growth enable row level security;

-- Security model: every policy below gates on is_caregiver(child_id) (or the
-- caregivers junction itself) — a signed-in stranger may create their OWN
-- child record (and becomes its sole caregiver), but can never read or write
-- a record they weren't explicitly invited to. There is no "public" or
-- "anon" read path to any family's data.
drop policy if exists "caregivers read child" on children;
create policy "caregivers read child" on children
  for select using (is_caregiver(id));
drop policy if exists "caregivers update child" on children;
create policy "caregivers update child" on children
  for update using (is_caregiver(id));
drop policy if exists "any signed-in user may create a child" on children;
create policy "any signed-in user may create a child" on children
  for insert with check (auth.uid() is not null);

drop policy if exists "see own memberships" on caregivers;
create policy "see own memberships" on caregivers
  for select using (user_id = auth.uid() or is_caregiver(child_id));

-- one uniform policy set per event table
drop policy if exists "caregiver all" on feeds;
create policy "caregiver all" on feeds   for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
drop policy if exists "caregiver all" on pumps;
create policy "caregiver all" on pumps   for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
drop policy if exists "caregiver all" on diapers;
create policy "caregiver all" on diapers for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
drop policy if exists "caregiver all" on sleeps;
create policy "caregiver all" on sleeps  for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
drop policy if exists "caregiver all" on growth;
create policy "caregiver all" on growth  for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));

-- realtime: every caregiver's phone sees everyone else's edits instantly
alter publication supabase_realtime
  add table feeds, pumps, diapers, sleeps, growth;

-- ---------------------------------------------------------------- provenance --
-- Where each event came from: logged in-app, or imported from a CSV.
alter table feeds   add column if not exists source text not null default 'app'
  check (source in ('app', 'csv'));
alter table pumps   add column if not exists source text not null default 'app'
  check (source in ('app', 'csv'));
alter table diapers add column if not exists source text not null default 'app'
  check (source in ('app', 'csv'));
alter table sleeps  add column if not exists source text not null default 'app'
  check (source in ('app', 'csv'));

-- ============================================================ Part 1: Settings --
-- Per-baby (not per-user) configuration: log-item order/visibility, bottle
-- defaults, next-feed window, paracetamol daily limit, dashboard visibility.
-- One shared row per baby — either caregiver edits it, changes sync to both
-- via Realtime.
create table if not exists baby_settings (
  child_id uuid primary key references children (id) on delete cascade,

  -- Section 1: Log tab item order + visibility (everything except caregivers,
  -- which is fixed at the bottom and not configurable). Array of
  -- {"key": "...", "visible": bool}, in display order.
  log_items jsonb not null default '[
    {"key":"bottle","visible":true},
    {"key":"next_feed","visible":true},
    {"key":"vitamin_d","visible":true},
    {"key":"paracetamol","visible":true},
    {"key":"next_paracetamol","visible":true},
    {"key":"sleep","visible":true},
    {"key":"last_sleep","visible":true},
    {"key":"diaper","visible":true},
    {"key":"weigh_in","visible":true},
    {"key":"pump","visible":true},
    {"key":"direct_breastfeed","visible":false},
    {"key":"daily_remarks","visible":true},
    {"key":"daycare_import","visible":true}
  ]'::jsonb,

  -- Section 2: bottle feeding config
  bottle_default_substance feed_substance not null default 'formula',
  bottle_presets_ml int[] not null default '{120,150,180,210,240}',

  -- Section 3: next-feed card config
  day_start_hour int not null default 7 check (day_start_hour between 0 and 23),
  day_end_hour int not null default 23 check (day_end_hour between 0 and 23),
  feed_min_interval_h numeric not null default 3 check (feed_min_interval_h > 0),
  feed_max_interval_h numeric not null default 4
    check (feed_max_interval_h > feed_min_interval_h),

  -- Section 4: dashboard card/chart visibility + manual intake-target override
  dashboard_visible jsonb not null default '{
    "intake_today": true,
    "formula_pct": true,
    "diapers_today": true,
    "pumped_24h": true,
    "sleep_24h": true,
    "chart_intake": true,
    "chart_supply": true,
    "chart_sleep": true
  }'::jsonb,
  target_intake_ml_override int check (target_intake_ml_override is null or target_intake_ml_override > 0),

  -- Section 5: paracetamol config (the minimum-gap safety floor is a fixed
  -- 4h constant in the app code, not stored here — see README's "Design
  -- decisions & known limitations")
  paracetamol_doses_per_day int not null default 4 check (paracetamol_doses_per_day > 0),

  updated_at timestamptz not null default now()
);

-- in case this column was added to an existing baby_settings table by an
-- earlier ad-hoc migration rather than this file
alter table baby_settings
  add column if not exists paracetamol_doses_per_day int not null default 4
  check (paracetamol_doses_per_day > 0);

alter table baby_settings enable row level security;
drop policy if exists "caregivers read settings" on baby_settings;
create policy "caregivers read settings" on baby_settings
  for select using (is_caregiver(child_id));
drop policy if exists "caregivers write settings" on baby_settings;
create policy "caregivers write settings" on baby_settings
  for all using (is_caregiver(child_id)) with check (is_caregiver(child_id));

alter publication supabase_realtime add table baby_settings;

-- Explicit, in case this project's ALTER DEFAULT PRIVILEGES (set once while
-- fixing an earlier "permission denied" issue) doesn't cover a table created
-- in a fresh SQL Editor session — cheap insurance against that exact bug.
grant all on baby_settings to anon, authenticated, service_role;

create or replace function list_caregivers(child uuid)
returns table(email text) language sql stable security definer set search_path = public as
$$
  select u.email::text
  from caregivers c
  join auth.users u on u.id = c.user_id
  where c.child_id = child and is_caregiver(child)
$$;

grant execute on function list_caregivers(uuid) to anon, authenticated;

-- ==================================================== Part 2: Daily remarks --
-- A freestanding shared journal (NOT notes on individual log entries) — any
-- caregiver can add short remarks to a given date, chronological, shows who
-- wrote what.
create table if not exists daily_remarks (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  remark_date date not null default (now()::date),
  text text not null check (char_length(trim(text)) > 0),
  caregiver_id uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table daily_remarks enable row level security;
drop policy if exists "caregiver all" on daily_remarks;
create policy "caregiver all" on daily_remarks for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));

alter publication supabase_realtime add table daily_remarks;
grant all on daily_remarks to anon, authenticated, service_role;

-- Same security-definer pattern as list_caregivers: exposes the writer's
-- email (not otherwise readable by anon/authenticated) but only for a child
-- the caller is already a caregiver of.
create or replace function list_remarks(child uuid)
returns table(id uuid, remark_date date, text text, created_at timestamptz, email text)
language sql stable security definer set search_path = public as
$$
  select r.id, r.remark_date, r.text, r.created_at, u.email::text
  from daily_remarks r
  join auth.users u on u.id = r.caregiver_id
  where r.child_id = child and is_caregiver(child)
  order by r.remark_date desc, r.created_at desc
$$;

grant execute on function list_remarks(uuid) to anon, authenticated;

-- ================================================== Part 3: Vitamin D checkbox --
-- Shared per-baby, per-day dose flag — whichever caregiver ticks it, both see
-- it. "Resets" for free at the device's local midnight (the app computes the
-- local date and that's simply a fresh, not-yet-existing row — no scheduled
-- job needed).
create table if not exists vitamin_d_doses (
  child_id uuid not null references children (id) on delete cascade,
  dose_date date not null default (now()::date),
  given boolean not null default true,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (child_id, dose_date)
);

alter table vitamin_d_doses enable row level security;
drop policy if exists "caregiver all" on vitamin_d_doses;
create policy "caregiver all" on vitamin_d_doses for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));

alter publication supabase_realtime add table vitamin_d_doses;
grant all on vitamin_d_doses to anon, authenticated, service_role;

-- ================================================= Part 4: Paracetamol dosing --
-- One row per dose given (unlike Vitamin D's one-flag-per-day, paracetamol
-- can be given multiple times a day), so "next dose" can be computed from
-- the most recent row's timestamp plus the configured interval. The app
-- additionally enforces a fixed 4h minimum gap in code regardless of the
-- doses_per_day setting above — see README.
create table if not exists paracetamol_doses (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table paracetamol_doses enable row level security;
drop policy if exists "caregiver all" on paracetamol_doses;
create policy "caregiver all" on paracetamol_doses for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));

alter publication supabase_realtime add table paracetamol_doses;
grant all on paracetamol_doses to anon, authenticated, service_role;

-- ======================================== Part 5: duplicate-baby maintenance --
-- For the rare case where two records exist for one baby (most often: two
-- caregivers each tapped "create" before inviting each other, so each is
-- only a caregiver of their own record). Moves every row from `from_child`
-- onto `into_child`, carries over any caregiver who'd otherwise lose access,
-- and deletes the now-empty duplicate. Run from the SQL Editor:
--   select merge_duplicate_child('KEEP-uuid', 'DROP-uuid');
-- Requires the caller to be a caregiver of both records.
create or replace function merge_duplicate_child(into_child uuid, from_child uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if into_child = from_child then
    raise exception 'into_child and from_child must be different';
  end if;
  if not (is_caregiver(into_child) and is_caregiver(from_child)) then
    raise exception 'must be a caregiver of both records to merge them';
  end if;

  -- carry over any caregiver who's on the duplicate but not the kept record
  insert into caregivers (child_id, user_id)
  select into_child, user_id from caregivers
  where child_id = from_child
  on conflict do nothing;

  update feeds              set child_id = into_child where child_id = from_child;
  update pumps              set child_id = into_child where child_id = from_child;
  update diapers            set child_id = into_child where child_id = from_child;
  update sleeps             set child_id = into_child where child_id = from_child;
  update growth             set child_id = into_child where child_id = from_child;
  update daily_remarks      set child_id = into_child where child_id = from_child;
  update paracetamol_doses  set child_id = into_child where child_id = from_child;

  -- vitamin_d_doses is keyed on (child_id, dose_date) — drop the duplicate's
  -- row for any date the kept record already has one, then move the rest
  delete from vitamin_d_doses where child_id = from_child
    and dose_date in (select dose_date from vitamin_d_doses where child_id = into_child);
  update vitamin_d_doses set child_id = into_child where child_id = from_child;

  -- baby_settings is one row per baby (child_id is its primary key) — the
  -- kept record already has its own, so just drop the duplicate's
  delete from baby_settings where child_id = from_child;

  -- cascades caregivers (now redundant with the carry-over above) and itself
  delete from children where id = from_child;
end $$;

grant execute on function merge_duplicate_child(uuid, uuid) to authenticated;
