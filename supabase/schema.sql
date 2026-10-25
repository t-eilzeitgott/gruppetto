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

create table if not exists public.riders (
  id                 bigint generated always as identity primary key,
  tour_id            text not null references public.tours (id) on delete cascade,
  bib                int,
  name               text not null,
  team               text not null,
  tip_limit          int check (tip_limit is null or tip_limit >= 0),  -- Joker-Limit, z. B. 3
  excluded_from_rest boolean not null default false,                  -- für "Best of the Rest"
  status             text not null default 'active' check (status in ('active', 'out')),
  constraint riders_unique_name unique (tour_id, name),
  constraint riders_unique_bib unique (tour_id, bib)
);
create index if not exists riders_tour_idx on public.riders (tour_id);

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
  select r.tour_id, r.tip_limit, r.status into v_rider_tour, v_limit, v_status
    from public.riders r where r.id = new.rider_id;

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
