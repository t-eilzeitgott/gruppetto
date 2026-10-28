-- =====================================================================
-- Gruppetto – Grand-Tour-Tippspiel
-- Datenbankschema für Supabase (PostgreSQL 15+)
--
-- Ausführen: Supabase → SQL Editor → New query → komplette Datei
-- einfügen → Run. Das Skript ist wiederholbar: Tabellen werden nur
-- angelegt, wenn sie fehlen; Funktionen, Trigger und Policies werden
-- jedes Mal neu gesetzt. Bestehende Daten bleiben erhalten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------------

create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_color text not null default '#6A3FB5',
  is_member    boolean not null default false,
  is_admin     boolean not null default false,
  is_pro       boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 2 and 20)
);
-- Pro-Anfrage (keine Zahlung, nur Vermerk; der Admin schaltet is_pro frei)
alter table public.profiles add column if not exists pro_requested_at timestamptz;

create unique index if not exists profiles_display_name_unique
  on public.profiles (lower(display_name));

create table if not exists public.tours (
  id          text primary key,                       -- z. B. 'giro-2027'
  name        text not null,                          -- 'Giro d''Italia 2027'
  short_name  text not null,                          -- 'Giro'
  theme       text not null default 'giro'
              check (theme in ('giro', 'tour', 'vuelta', 'neutral')),
  year        int  not null,
  start_date  date not null,
  end_date    date not null,
  is_visible  boolean not null default true,
  bonus_final boolean not null default false,         -- Bonuswertungen endgültig?
  pcs_slug    text,                                   -- z. B. 'giro-d-italia/2027'
  created_at  timestamptz not null default now(),
  constraint tours_dates check (end_date >= start_date)
);

-- Wie oft man denselben Fahrer pro Rundfahrt tippen darf (null = unbegrenzt)
alter table public.tours add column if not exists tip_limit int default 3 check (tip_limit is null or tip_limit >= 1);

create table if not exists public.riders (
  id                 bigint generated always as identity primary key,
  tour_id            text not null references public.tours (id) on delete cascade,
  bib                int,
  name               text not null,
  team               text not null,
  tip_limit          int check (tip_limit is null or tip_limit >= 0),  -- eigenes Limit, sonst das der Rundfahrt
  excluded_from_rest boolean not null default false,                  -- für "Best of the Rest"
  status             text not null default 'active' check (status in ('active', 'out')),
  constraint riders_unique_name unique (tour_id, name),
  constraint riders_unique_bib unique (tour_id, bib)
);
create index if not exists riders_tour_idx on public.riders (tour_id);

-- Fahrer-Stammdaten (über Rundfahrten hinweg): beim Import einer neuen Startliste
-- werden Nation usw. automatisch übernommen, wenn der Name schon bekannt ist.
create table if not exists public.cyclists (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  nationality text,                                   -- ISO-Code, z. B. 'DK'
  created_at  timestamptz not null default now()
);
alter table public.riders add column if not exists cyclist_id  bigint references public.cyclists (id) on delete set null;
alter table public.riders add column if not exists nationality text;
alter table public.riders add column if not exists age         int;
alter table public.riders add column if not exists young       boolean not null default false;  -- Nachwuchswertung


create table if not exists public.stages (
  id                bigint generated always as identity primary key,
  tour_id           text not null references public.tours (id) on delete cascade,
  number            int  not null check (number between 1 and 30),
  starts_at         timestamptz not null,               -- Etappenstart = Tippschluss
  kind              text not null default 'flat'
                    check (kind in ('flat', 'hilly', 'mountain', 'itt', 'ttt')),
  departure         text,
  arrival           text,
  distance_km       numeric(5, 1),
  results_published boolean not null default false,
  constraint stages_unique_number unique (tour_id, number)
);
create index if not exists stages_tour_idx on public.stages (tour_id);

-- Etappenprofil: Bergwertungen [{name, cat, km, len, grad}] und Zwischensprints [{name, km}]
alter table public.stages add column if not exists climbs      jsonb not null default '[]'::jsonb;
alter table public.stages add column if not exists sprints     jsonb not null default '[]'::jsonb;
alter table public.stages add column if not exists elevation_m int;
-- Zusatzinfos je Etappe (Originaldatum, Fahrplan, Neutralisation …) und je Rundfahrt (Reglement)
alter table public.stages add column if not exists info jsonb not null default '{}'::jsonb;
alter table public.tours  add column if not exists info jsonb not null default '{}'::jsonb;

-- Lieblingsfahrer je Mitglied (über Rundfahrten hinweg, daher an den Stammdaten)
create table if not exists public.favorite_cyclists (
  user_id    uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  cyclist_id bigint not null references public.cyclists (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, cyclist_id)
);

create table if not exists public.stage_tips (
  stage_id   bigint not null references public.stages (id) on delete cascade,
  user_id    uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  rider_id   bigint not null references public.riders (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (stage_id, user_id)
);
create index if not exists stage_tips_user_idx on public.stage_tips (user_id);

create table if not exists public.stage_results (
  stage_id bigint not null references public.stages (id) on delete cascade,
  position int    not null check (position between 1 and 50),
  rider_id bigint not null references public.riders (id) on delete cascade,
  primary key (stage_id, position),
  constraint stage_results_unique_rider unique (stage_id, rider_id)
);

-- Höhenprofil einer Etappe aus einer GPX-Datei: [[km, Höhe], …] (separat, wird nur bei Bedarf geladen)
create table if not exists public.stage_profiles (
  stage_id   bigint primary key references public.stages (id) on delete cascade,
  points     jsonb  not null,
  source     text,
  updated_at timestamptz not null default now()
);
alter table public.stage_profiles add column if not exists waypoints jsonb;  -- [{km, alt, name}] Durchfahrtsorte

-- Minispiele: jeder Lauf mit Punktzahl
create table if not exists public.game_scores (
  id         bigint generated always as identity primary key,
  user_id    uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  game       text   not null check (game in ('abfahrt', 'sprint', 'berg')),
  score      int    not null check (score >= 0 and score < 10000000),
  created_at timestamptz not null default now()
);
create index if not exists game_scores_game_idx on public.game_scores (game, score desc);
alter table public.game_scores add column if not exists meters int check (meters is null or (meters >= 0 and meters < 1000000));
create index if not exists game_scores_time_idx on public.game_scores (game, created_at);
-- Spiele nachträglich erweitern (Sprintfinale, Bergfinale, Zeitfahren – dort ist score = 1.000.000 − Millisekunden)
alter table public.game_scores drop constraint if exists game_scores_game_check;
alter table public.game_scores add constraint game_scores_game_check check (game in ('abfahrt', 'sprint', 'berg', 'zeitfahren'));

-- Zeitfahren: die beste Fahrt des Tages je Mitglied als Geist – Zeit, Zwischenzeiten, gewähltes Rad und die
-- Fahrspur (alle 0,25 s Rennzeit: Streckenmeter ×10, seitliche Lage in cm, Haltung), siehe src/game/tt.ts
create table if not exists public.tt_ghosts (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day        date not null,
  time_ms    int  not null check (time_ms > 0 and time_ms < 3600000),
  bike       text not null default 'allround',
  splits     int[] not null default '{}',
  trace      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint tt_ghosts_trace_size check (pg_column_size(trace) < 120000)
);
create index if not exists tt_ghosts_day_idx on public.tt_ghosts (day, time_ms);

-- Nur eine schnellere Fahrt ersetzt die gespeicherte (zwei Geräte, langsame Verbindung)
create or replace function public.tt_ghosts_keep_best()
returns trigger language plpgsql as $$
begin
  if new.time_ms >= old.time_ms then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists tt_ghosts_keep_best on public.tt_ghosts;
create trigger tt_ghosts_keep_best before update on public.tt_ghosts
  for each row execute function public.tt_ghosts_keep_best();

-- Wertungsstand nach einer Etappe (z. B. Gesamtwertung Top 10) – sichtbar mit dem Ergebnis
create table if not exists public.stage_standings (
  stage_id bigint not null references public.stages (id) on delete cascade,
  category text   not null check (category in ('gc', 'points', 'mountains', 'youth')),
  position int    not null check (position between 1 and 50),
  rider_id bigint not null references public.riders (id) on delete cascade,
  primary key (stage_id, category, position)
);

create table if not exists public.stage_point_scale (
  position int primary key check (position between 1 and 50),
  points   int not null check (points >= 0)
);

create table if not exists public.bonus_tips (
  tour_id    text   not null references public.tours (id) on delete cascade,
  user_id    uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  category   text   not null check (category in
               ('gc', 'rest', 'points', 'mountains', 'youth', 'combative', 'stage_wins', 'team')),
  rider_id   bigint references public.riders (id) on delete cascade,
  team       text,
  updated_at timestamptz not null default now(),
  primary key (tour_id, user_id, category),
  constraint bonus_tips_shape check (
    (category = 'team' and team is not null and rider_id is null) or
    (category <> 'team' and rider_id is not null and team is null))
);

-- Aktueller bzw. endgültiger Stand der Bonuswertungen (Platz 1–3).
-- "Meiste Etappensiege" wird automatisch aus den Etappenergebnissen berechnet.
create table if not exists public.bonus_results (
  id       bigint generated always as identity primary key,
  tour_id  text not null references public.tours (id) on delete cascade,
  category text not null check (category in
             ('gc', 'rest', 'points', 'mountains', 'youth', 'combative', 'team')),
  position int  not null check (position between 1 and 3),
  rider_id bigint references public.riders (id) on delete cascade,
  team     text,
  constraint bonus_results_shape check (
    (category = 'team' and team is not null and rider_id is null) or
    (category <> 'team' and rider_id is not null and team is null))
);
create unique index if not exists bonus_results_unique_entry
  on public.bonus_results (tour_id, category, coalesce(rider_id::text, team));

-- ---------------------------------------------------------------------
-- 2. Startwerte
-- ---------------------------------------------------------------------

insert into public.stage_point_scale (position, points) values
  (1, 20), (2, 15), (3, 10), (4, 7), (5, 6), (6, 5), (7, 4), (8, 3), (9, 2), (10, 1)
on conflict (position) do nothing;

insert into public.app_settings (key, value)
values ('invite_code', upper(substr(md5(random()::text), 1, 6)))
on conflict (key) do nothing;

insert into public.tours (id, name, short_name, theme, year, start_date, end_date, pcs_slug) values
  ('giro-2027',   'Giro d''Italia 2027',     'Giro',   'giro',   2027, '2027-05-08', '2027-05-30', 'giro-d-italia/2027'),
  ('tour-2027',   'Tour de France 2027',     'Tour',   'tour',   2027, '2027-07-02', '2027-07-25', 'tour-de-france/2027'),
  ('vuelta-2027', 'La Vuelta 2027',          'Vuelta', 'vuelta', 2027, '2027-09-04', '2027-09-26', 'vuelta-a-espana/2027')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Hilfsfunktionen (SECURITY DEFINER, damit Policies nicht rekursiv werden)
-- ---------------------------------------------------------------------

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_member from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.stage_started(p_stage bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.starts_at <= now() from public.stages s where s.id = p_stage), false);
$$;

-- Tippschluss der Bonustipps = Start von Etappe 1
-- (solange Etappe 1 fehlt: erster Tag der Rundfahrt, 12:00 Uhr deutscher Zeit).
create or replace function public.bonus_deadline(p_tour text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.starts_at from public.stages s where s.tour_id = p_tour and s.number = 1),
    ((select t.start_date from public.tours t where t.id = p_tour)::timestamp + time '12:00')
      at time zone 'Europe/Berlin');
$$;

-- ---------------------------------------------------------------------
-- 4. Trigger
-- ---------------------------------------------------------------------

-- Neues Auth-Konto → Profil anlegen
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, avatar_color)
  values (new.id, (array['#6A3FB5', '#1F6F8B', '#B23A6B', '#2E7D4F', '#A0522D', '#3D5AFE',
                         '#8E44AD', '#00796B', '#C0392B', '#455A64', '#6D4C41', '#5C6BC0'])
                  [1 + floor(random() * 12)::int])
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Konten, die schon vor dem Schema existierten, bekommen ebenfalls ein Profil
insert into public.profiles (id) select u.id from auth.users u on conflict (id) do nothing;

-- Etappentipp prüfen: Fahrer gehört zur Rundfahrt, ist noch im Rennen, Joker-Limit
create or replace function public.check_stage_tip()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tour        text;
  v_rider_tour  text;
  v_limit       int;
  v_status      text;
  v_used        int;
begin
  select s.tour_id into v_tour from public.stages s where s.id = new.stage_id;
  select r.tour_id, coalesce(r.tip_limit, t.tip_limit), r.status into v_rider_tour, v_limit, v_status
    from public.riders r join public.tours t on t.id = r.tour_id where r.id = new.rider_id;

  if v_rider_tour is distinct from v_tour then
    raise exception 'rider_not_in_tour' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'rider_not_active' using errcode = 'P0001';
  end if;
  if v_limit is not null then
    select count(*) into v_used
      from public.stage_tips t
      join public.stages s on s.id = t.stage_id
     where t.user_id = new.user_id
       and t.rider_id = new.rider_id
       and s.tour_id = v_tour
       and t.stage_id <> new.stage_id;
    if v_used >= v_limit then
      raise exception 'joker_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stage_tips_check on public.stage_tips;
create trigger stage_tips_check
  before insert or update on public.stage_tips
  for each row execute function public.check_stage_tip();

-- Fahrer mit Stammdaten verknüpfen (legt sie bei Bedarf an)
create or replace function public.link_cyclist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id  bigint;
  v_nat text;
begin
  select c.id, c.nationality into v_id, v_nat from public.cyclists c where c.name = new.name;
  if v_id is null then
    insert into public.cyclists (name, nationality) values (new.name, new.nationality)
    on conflict (name) do update set nationality = coalesce(public.cyclists.nationality, excluded.nationality)
    returning id, nationality into v_id, v_nat;
  elsif v_nat is null and new.nationality is not null then
    update public.cyclists set nationality = new.nationality where id = v_id;
  end if;
  new.cyclist_id := v_id;
  new.nationality := coalesce(new.nationality, v_nat);
  return new;
end;
$$;

drop trigger if exists riders_link_cyclist on public.riders;
create trigger riders_link_cyclist
  before insert or update of name, nationality on public.riders
  for each row execute function public.link_cyclist();

-- Bonustipp prüfen: Fahrer bzw. Team gehört zur Rundfahrt
create or replace function public.check_bonus_tip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rider_id is not null and not exists (
       select 1 from public.riders r where r.id = new.rider_id and r.tour_id = new.tour_id) then
    raise exception 'rider_not_in_tour' using errcode = 'P0001';
  end if;
  if new.team is not null and not exists (
       select 1 from public.riders r where r.tour_id = new.tour_id and r.team = new.team) then
    raise exception 'team_not_in_tour' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bonus_tips_check on public.bonus_tips;
create trigger bonus_tips_check
  before insert or update on public.bonus_tips
  for each row execute function public.check_bonus_tip();

-- Ergebnisse dürfen erst nach dem Etappenstart veröffentlicht werden
create or replace function public.check_stage_publish()
returns trigger language plpgsql as $$
begin
  if new.results_published
     and (tg_op = 'INSERT' or not old.results_published)
     and new.starts_at > now() then
    raise exception 'stage_not_started' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists stages_check_publish on public.stages;
create trigger stages_check_publish
  before insert or update on public.stages
  for each row execute function public.check_stage_publish();

-- ---------------------------------------------------------------------
-- 5. RPC-Funktionen für die App
-- ---------------------------------------------------------------------

-- Der Runde beitreten (Einladungscode + Anzeigename)
create or replace function public.join_group(p_code text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select s.value into v_code from public.app_settings s where s.key = 'invite_code';
  if v_code is null or upper(btrim(coalesce(p_code, ''))) <> upper(btrim(v_code)) then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 20 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p
              where lower(p.display_name) = lower(v_name) and p.id <> auth.uid()) then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;
  insert into public.profiles (id) values (auth.uid()) on conflict (id) do nothing;
  update public.profiles set display_name = v_name, is_member = true where id = auth.uid();
end;
$$;

-- Eigenen Anzeigenamen und Farbe ändern
create or replace function public.update_my_profile(p_name text, p_color text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 20 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid_color' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p
              where lower(p.display_name) = lower(v_name) and p.id <> auth.uid()) then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;
  update public.profiles set display_name = v_name, avatar_color = p_color where id = auth.uid();
end;
$$;

-- Eigenes Konto inkl. aller Tipps löschen
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Wer hat für eine Etappe schon getippt? (nur IDs, nie der Fahrer)
create or replace function public.stage_tippers(p_stage bigint)
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.user_id from public.stage_tips t where t.stage_id = p_stage and public.is_member();
$$;

-- Pro anfragen bzw. Anfrage zurückziehen (2,99 €/Monat, nur als Vermerk)
create or replace function public.request_pro(p_request boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  update public.profiles
     set pro_requested_at = case when p_request then coalesce(pro_requested_at, now()) else null end
   where id = auth.uid();
end;
$$;

-- Admin: alle Konten inkl. E-Mail
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (id uuid, email text, display_name text, avatar_color text,
               is_member boolean, is_admin boolean, is_pro boolean, pro_requested_at timestamptz,
               created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  return query
    select p.id, u.email::text, p.display_name, p.avatar_color,
           p.is_member, p.is_admin, p.is_pro, p.pro_requested_at, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by p.created_at;
end;
$$;

-- Admin: Mitgliedschaft, Admin- und Pro-Status setzen
create or replace function public.admin_set_flags(p_user uuid, p_member boolean, p_admin boolean, p_pro boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  if p_user = auth.uid() and not p_admin then
    raise exception 'cannot_remove_own_admin' using errcode = 'P0001';
  end if;
  update public.profiles
     set is_member = p_member, is_admin = p_admin, is_pro = p_pro
   where id = p_user;
end;
$$;

-- Keep-alive für den GitHub-Workflow
create or replace function public.ping()
returns text language sql stable as $$ select 'pong'::text; $$;

revoke execute on function public.join_group(text, text)                       from public, anon;
revoke execute on function public.update_my_profile(text, text)                from public, anon;
revoke execute on function public.delete_my_account()                          from public, anon;
revoke execute on function public.stage_tippers(bigint)                        from public, anon;
revoke execute on function public.request_pro(boolean)                         from public, anon;
grant  execute on function public.request_pro(boolean)                         to authenticated;
revoke execute on function public.admin_list_users()                           from public, anon;
revoke execute on function public.admin_set_flags(uuid, boolean, boolean, boolean) from public, anon;
grant  execute on function public.join_group(text, text)                       to authenticated;
grant  execute on function public.update_my_profile(text, text)                to authenticated;
grant  execute on function public.delete_my_account()                          to authenticated;
grant  execute on function public.stage_tippers(bigint)                        to authenticated;
grant  execute on function public.admin_list_users()                           to authenticated;
grant  execute on function public.admin_set_flags(uuid, boolean, boolean, boolean) to authenticated;
grant  execute on function public.ping()                                        to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------

alter table public.app_settings      enable row level security;
alter table public.profiles          enable row level security;
alter table public.tours             enable row level security;
alter table public.riders            enable row level security;
alter table public.cyclists          enable row level security;
alter table public.favorite_cyclists enable row level security;
alter table public.stage_standings   enable row level security;
alter table public.stage_profiles    enable row level security;
alter table public.game_scores       enable row level security;
alter table public.tt_ghosts         enable row level security;
alter table public.stages            enable row level security;
alter table public.stage_tips        enable row level security;
alter table public.stage_results     enable row level security;
alter table public.stage_point_scale enable row level security;
alter table public.bonus_tips        enable row level security;
alter table public.bonus_results     enable row level security;

-- Profile werden nur über die RPC-Funktionen geändert
revoke insert, update, delete on public.profiles from anon, authenticated;

-- app_settings: nur Admins (enthält den Einladungscode)
drop policy if exists settings_admin on public.app_settings;
create policy settings_admin on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: eigenes Profil immer, andere Mitglieder nur als Mitglied
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or (is_member and public.is_member()) or public.is_admin());

-- Stammdaten: Mitglieder lesen, Admins schreiben
drop policy if exists tours_select on public.tours;
create policy tours_select on public.tours
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists tours_admin on public.tours;
create policy tours_admin on public.tours
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists riders_select on public.riders;
create policy riders_select on public.riders
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists riders_admin on public.riders;
create policy riders_admin on public.riders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists game_scores_select on public.game_scores;
create policy game_scores_select on public.game_scores
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists game_scores_insert on public.game_scores;
create policy game_scores_insert on public.game_scores
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());

-- Geister: Mitglieder sehen alle, jeder schreibt nur seine eigene Fahrt
drop policy if exists tt_ghosts_select on public.tt_ghosts;
create policy tt_ghosts_select on public.tt_ghosts
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists tt_ghosts_write on public.tt_ghosts;
create policy tt_ghosts_write on public.tt_ghosts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

-- Bestenliste: beste Punktzahl, weiteste Strecke und Gesamtstrecke je Mitglied (optional ab einem Zeitpunkt)
drop function if exists public.game_leaderboard(text);
create or replace function public.game_leaderboard(p_game text, p_since timestamptz default null)
returns table (user_id uuid, best int, best_m int, runs bigint, total_m bigint, last_at timestamptz)
language sql stable set search_path = public as $$
  select g.user_id, max(g.score)::int, coalesce(max(g.meters), 0)::int, count(*), coalesce(sum(g.meters), 0)::bigint, max(g.created_at)
    from public.game_scores g
   where g.game = p_game
     and (p_since is null or g.created_at >= p_since)
   group by g.user_id
   order by max(g.score) desc
   limit 100;
$$;
revoke execute on function public.game_leaderboard(text, timestamptz) from public, anon;
grant  execute on function public.game_leaderboard(text, timestamptz) to authenticated;

drop policy if exists profiles_stage_select on public.stage_profiles;
create policy profiles_stage_select on public.stage_profiles
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists profiles_stage_admin on public.stage_profiles;
create policy profiles_stage_admin on public.stage_profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists standings_select on public.stage_standings;
create policy standings_select on public.stage_standings
  for select to authenticated using (
    public.is_admin() or (public.is_member() and exists (
      select 1 from public.stages s where s.id = stage_id and s.results_published)));
drop policy if exists standings_admin on public.stage_standings;
create policy standings_admin on public.stage_standings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists favorites_own on public.favorite_cyclists;
create policy favorites_own on public.favorite_cyclists
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists cyclists_select on public.cyclists;
create policy cyclists_select on public.cyclists
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists cyclists_admin on public.cyclists;
create policy cyclists_admin on public.cyclists
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists stages_select on public.stages;
create policy stages_select on public.stages
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists stages_admin on public.stages;
create policy stages_admin on public.stages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists scale_select on public.stage_point_scale;
create policy scale_select on public.stage_point_scale
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists scale_admin on public.stage_point_scale;
create policy scale_admin on public.stage_point_scale
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists bonus_results_select on public.bonus_results;
create policy bonus_results_select on public.bonus_results
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists bonus_results_admin on public.bonus_results;
create policy bonus_results_admin on public.bonus_results
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Etappenergebnisse: für Mitglieder erst nach Veröffentlichung sichtbar
drop policy if exists stage_results_select on public.stage_results;
create policy stage_results_select on public.stage_results
  for select to authenticated
  using (public.is_admin() or (public.is_member() and exists (
           select 1 from public.stages s where s.id = stage_id and s.results_published)));
drop policy if exists stage_results_admin on public.stage_results;
create policy stage_results_admin on public.stage_results
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Etappentipps: eigene immer, fremde erst ab Etappenstart (gilt auch für Admins)
drop policy if exists stage_tips_select on public.stage_tips;
create policy stage_tips_select on public.stage_tips
  for select to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.stage_started(stage_id)));
drop policy if exists stage_tips_insert on public.stage_tips;
create policy stage_tips_insert on public.stage_tips
  for insert to authenticated
  with check (public.is_member() and user_id = auth.uid() and not public.stage_started(stage_id));
drop policy if exists stage_tips_update on public.stage_tips;
create policy stage_tips_update on public.stage_tips
  for update to authenticated
  using (user_id = auth.uid() and not public.stage_started(stage_id))
  with check (public.is_member() and user_id = auth.uid() and not public.stage_started(stage_id));
drop policy if exists stage_tips_delete on public.stage_tips;
create policy stage_tips_delete on public.stage_tips
  for delete to authenticated
  using (user_id = auth.uid() and not public.stage_started(stage_id));

-- Bonustipps: eigene immer, fremde erst ab Start von Etappe 1
drop policy if exists bonus_tips_select on public.bonus_tips;
create policy bonus_tips_select on public.bonus_tips
  for select to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.bonus_deadline(tour_id) <= now()));
drop policy if exists bonus_tips_insert on public.bonus_tips;
create policy bonus_tips_insert on public.bonus_tips
  for insert to authenticated
  with check (public.is_member() and user_id = auth.uid() and public.bonus_deadline(tour_id) > now());
drop policy if exists bonus_tips_update on public.bonus_tips;
create policy bonus_tips_update on public.bonus_tips
  for update to authenticated
  using (user_id = auth.uid() and public.bonus_deadline(tour_id) > now())
  with check (public.is_member() and user_id = auth.uid() and public.bonus_deadline(tour_id) > now());
drop policy if exists bonus_tips_delete on public.bonus_tips;
create policy bonus_tips_delete on public.bonus_tips
  for delete to authenticated
  using (user_id = auth.uid() and public.bonus_deadline(tour_id) > now());

-- ---------------------------------------------------------------------
-- 7. Automatische Ergebnisse (GitHub-Workflow „Ergebnisse“ liest procyclingstats.com)
--
-- Der Workflow schreibt mit dem Secret Key (Rolle service_role) über sync_apply_stage().
-- Ändert ein Admin in der App ein Ergebnis von Hand oder zieht die Veröffentlichung
-- zurück, pausiert die Automatik für diese Etappe (Admin → Automatik → fortsetzen).
-- ---------------------------------------------------------------------

-- off = aus, draft = Ergebnis als Vorschlag eintragen (Admin veröffentlicht), auto = selbst veröffentlichen
alter table public.tours add column if not exists sync_mode text not null default 'off';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tours_sync_mode_check') then
    alter table public.tours add constraint tours_sync_mode_check check (sync_mode in ('off', 'draft', 'auto'));
  end if;
end $$;

create table if not exists public.stage_sync (
  stage_id      bigint primary key references public.stages (id) on delete cascade,
  paused        boolean not null default false,   -- von Hand geändert → Automatik lässt die Etappe in Ruhe
  paused_reason text,
  paused_at     timestamptz,
  checked_at    timestamptz,                      -- letzter Abruf bei procyclingstats.com
  candidate     jsonb,                            -- zuletzt gelesenes Ergebnis (Stabilitätsprüfung)
  candidate_at  timestamptz,                      -- seit wann es unverändert ist
  synced_at     timestamptz,                      -- Ergebnis zuletzt übernommen
  status        text,                             -- Kurzstand für die Admin-Seite
  source_url    text,
  last_error    text
);

create table if not exists public.sync_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  tour_id  text   references public.tours (id) on delete cascade,
  stage_id bigint references public.stages (id) on delete cascade,
  level    text   not null check (level in ('info', 'change', 'warning', 'error')),
  message  text   not null,
  details  jsonb
);
create index if not exists sync_log_tour_idx on public.sync_log (tour_id, at desc);

-- Handeingriff aus der App (Rolle authenticated) pausiert die Automatik für die Etappe.
-- Der Workflow (service_role), pg_cron und der SQL Editor pausieren nichts.
create or replace function public.pause_sync_on_manual_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage  bigint;
  v_reason text;
begin
  if coalesce(current_setting('role', true), '') <> 'authenticated' then
    return null;
  end if;
  if tg_table_name = 'stages' then
    v_stage := new.id;
    v_reason := 'Veröffentlichung von Hand zurückgezogen';
  else
    v_stage := coalesce(new.stage_id, old.stage_id);
    v_reason := 'Ergebnis von Hand geändert';
  end if;
  insert into public.stage_sync (stage_id, paused, paused_reason, paused_at, status)
  values (v_stage, true, v_reason, now(), 'pausiert')
  on conflict (stage_id) do update
    set paused = true, paused_reason = excluded.paused_reason, paused_at = now(), status = 'pausiert'
    where not public.stage_sync.paused;
  return null;
end;
$$;

drop trigger if exists stage_results_pause_sync on public.stage_results;
create trigger stage_results_pause_sync
  after insert or update or delete on public.stage_results
  for each row execute function public.pause_sync_on_manual_change();

drop trigger if exists stages_pause_sync on public.stages;
create trigger stages_pause_sync
  after update of results_published on public.stages
  for each row when (old.results_published and not new.results_published)
  execute function public.pause_sync_on_manual_change();

-- Schreibzugriff des Workflows: alles für eine Etappe in einer Transaktion.
-- p = { state, results, standings, publish, out, stage, bonus, logs } – jeder Teil ist optional.
create or replace function public.sync_apply_stage(p_stage bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tour    text;
  v_final   boolean;
  v_paused  boolean;
  v_done    text[] := '{}';
  v_skipped text[] := '{}';
  v_cat     text;
  v_rows    jsonb;
begin
  select s.tour_id, t.bonus_final into v_tour, v_final
    from public.stages s join public.tours t on t.id = s.tour_id where s.id = p_stage;
  if v_tour is null then
    raise exception 'stage_not_found' using errcode = 'P0001';
  end if;

  insert into public.stage_sync (stage_id) values (p_stage) on conflict (stage_id) do nothing;
  select ss.paused into v_paused from public.stage_sync ss where ss.stage_id = p_stage for update;

  -- Alle Fahrer müssen zu dieser Rundfahrt gehören
  if exists (
    with ids as (
      select (e->>'rider_id')::bigint as id from jsonb_array_elements(coalesce(p->'results', '[]')) e
      union all
      select (e->>'rider_id')::bigint from jsonb_each(coalesce(p->'standings', '{}')) c, jsonb_array_elements(c.value) e
      union all
      select x::bigint from jsonb_array_elements_text(coalesce(p->'out', '[]')) x
      union all
      select (e->>'rider_id')::bigint from jsonb_each(coalesce(p->'bonus', '{}')) c, jsonb_array_elements(c.value) e
       where e ? 'rider_id' and e->>'rider_id' is not null
    )
    select 1 from ids where not exists (select 1 from public.riders r where r.id = ids.id and r.tour_id = v_tour)
  ) then
    raise exception 'rider_not_in_tour' using errcode = 'P0001';
  end if;

  if p ? 'results' or p ? 'standings' or p ? 'out' or coalesce((p->>'publish')::boolean, false) then
    if v_paused then
      v_skipped := v_skipped || array['results'];
    else
      if p ? 'results' then
        delete from public.stage_results where stage_id = p_stage;
        insert into public.stage_results (stage_id, position, rider_id)
        select p_stage, (e->>'position')::int, (e->>'rider_id')::bigint from jsonb_array_elements(p->'results') e;
        v_done := v_done || array['results'];
      end if;
      if p ? 'standings' then
        for v_cat, v_rows in select key, value from jsonb_each(p->'standings') loop
          delete from public.stage_standings where stage_id = p_stage and category = v_cat;
          insert into public.stage_standings (stage_id, category, position, rider_id)
          select p_stage, v_cat, (e->>'position')::int, (e->>'rider_id')::bigint from jsonb_array_elements(v_rows) e;
        end loop;
        v_done := v_done || array['standings'];
      end if;
      if p ? 'out' then
        update public.riders set status = 'out'
         where tour_id = v_tour and status = 'active'
           and id in (select x::bigint from jsonb_array_elements_text(p->'out') x);
        v_done := v_done || array['out'];
      end if;
      if coalesce((p->>'publish')::boolean, false) then
        update public.stages set results_published = true where id = p_stage and not results_published;
        v_done := v_done || array['publish'];
      end if;
    end if;
  end if;

  if p ? 'stage' then
    update public.stages s set
      distance_km = coalesce((p->'stage'->>'distance_km')::numeric, s.distance_km),
      departure   = coalesce(p->'stage'->>'departure', s.departure),
      arrival     = coalesce(p->'stage'->>'arrival', s.arrival)
     where s.id = p_stage;
    v_done := v_done || array['stage'];
  end if;

  if p ? 'bonus' then
    if v_final then
      v_skipped := v_skipped || array['bonus'];
    else
      for v_cat, v_rows in select key, value from jsonb_each(p->'bonus') loop
        if v_cat not in ('gc', 'rest', 'points', 'mountains', 'youth', 'team') then
          raise exception 'invalid_category' using errcode = 'P0001';
        end if;
        delete from public.bonus_results where tour_id = v_tour and category = v_cat;
        insert into public.bonus_results (tour_id, category, position, rider_id, team)
        select v_tour, v_cat, (e->>'position')::int, nullif(e->>'rider_id', '')::bigint, e->>'team'
          from jsonb_array_elements(v_rows) e;
      end loop;
      v_done := v_done || array['bonus'];
    end if;
  end if;

  update public.stage_sync ss set
    checked_at   = coalesce((p->'state'->>'checked_at')::timestamptz, now()),
    candidate    = case when p->'state' ? 'candidate' then p->'state'->'candidate' else ss.candidate end,
    candidate_at = case when p->'state' ? 'candidate_at' then (p->'state'->>'candidate_at')::timestamptz else ss.candidate_at end,
    synced_at    = case when 'results' = any(v_done) or 'publish' = any(v_done) then now() else ss.synced_at end,
    status       = case when v_paused then 'pausiert' else coalesce(p->'state'->>'status', ss.status) end,
    source_url   = coalesce(p->'state'->>'source_url', ss.source_url),
    last_error   = case when p->'state' ? 'last_error' then p->'state'->>'last_error' else ss.last_error end
   where ss.stage_id = p_stage;

  insert into public.sync_log (tour_id, stage_id, level, message, details)
  select v_tour, p_stage, e->>'level', e->>'message', e->'details'
    from jsonb_array_elements(coalesce(p->'logs', '[]')) e;

  return jsonb_build_object('applied', to_jsonb(v_done), 'skipped', to_jsonb(v_skipped), 'paused', v_paused);
end;
$$;

-- Admin: Automatik für eine Etappe anhalten bzw. fortsetzen
create or replace function public.admin_set_stage_sync_paused(p_stage bigint, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  insert into public.stage_sync (stage_id) values (p_stage) on conflict (stage_id) do nothing;
  update public.stage_sync set
    paused        = p_paused,
    paused_reason = case when p_paused then 'von Hand angehalten' end,
    paused_at     = case when p_paused then now() end,
    candidate     = null,
    candidate_at  = null,
    status        = case when p_paused then 'pausiert' else 'wartet' end
   where stage_id = p_stage;
  insert into public.sync_log (tour_id, stage_id, level, message)
  select s.tour_id, s.id, 'info',
         'Automatik für Etappe ' || s.number || case when p_paused then ' angehalten' else ' fortgesetzt' end
    from public.stages s where s.id = p_stage;
end;
$$;

revoke execute on function public.sync_apply_stage(bigint, jsonb)              from public, anon, authenticated;
grant  execute on function public.sync_apply_stage(bigint, jsonb)              to service_role;
revoke execute on function public.pause_sync_on_manual_change()               from public, anon, authenticated;
revoke execute on function public.admin_set_stage_sync_paused(bigint, boolean) from public, anon;
grant  execute on function public.admin_set_stage_sync_paused(bigint, boolean) to authenticated;

alter table public.stage_sync enable row level security;
alter table public.sync_log   enable row level security;
revoke insert, update, delete on public.stage_sync, public.sync_log from anon, authenticated;

drop policy if exists stage_sync_admin on public.stage_sync;
create policy stage_sync_admin on public.stage_sync
  for select to authenticated using (public.is_admin());
drop policy if exists sync_log_admin on public.sync_log;
create policy sync_log_admin on public.sync_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 8. Welt-Editor (Admin → Welt): Änderungen an den 3D-Welten der Minispiele
-- key = „<spiel>:<tag>“ (eine Tagesstrecke) oder „global“ (verankerte Änderungen für alle Strecken),
-- data = JSON (siehe src/game/abfahrt/worldEdits.ts). Mitglieder lesen (die Spiele laden sie), Admins schreiben.
-- ---------------------------------------------------------------------
create table if not exists public.world_edits (
  key        text primary key,
  data       jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.world_edits enable row level security;
drop policy if exists world_edits_select on public.world_edits;
create policy world_edits_select on public.world_edits
  for select to authenticated using (public.is_member() or public.is_admin());
drop policy if exists world_edits_admin on public.world_edits;
create policy world_edits_admin on public.world_edits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
