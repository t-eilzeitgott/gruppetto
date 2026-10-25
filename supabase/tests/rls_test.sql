-- Testet Rechte, Sichtbarkeit und Tipp-Regeln des Schemas.
-- Ausführen: ./supabase/tests/run.sh  (lokales PostgreSQL, nicht Supabase)
\set ON_ERROR_STOP on
\set QUIET on

-- Erwarteten Fehler prüfen
create or replace function pg_temp.expect_error(p_sql text, p_msg text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ERWARTETER FEHLER BLIEB AUS: % (%)', p_msg, p_sql;
exception when others then
  if sqlerrm like 'ERWARTETER FEHLER BLIEB AUS%' then raise; end if;
  if p_msg is not null and position(p_msg in sqlerrm) = 0 then
    raise exception 'FALSCHER FEHLER: erwartet %, bekommen %', p_msg, sqlerrm;
  end if;
end $$;

create or replace function pg_temp.expect_eq(p_actual bigint, p_expected bigint, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FEHLGESCHLAGEN: % – erwartet %, bekommen %', p_label, p_expected, p_actual;
  end if;
end $$;

-- ---------- Setup als postgres ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carl@example.com');
update public.app_settings set value = 'TEST27' where key = 'invite_code';
select pg_temp.expect_eq((select count(*) from public.profiles), 3, 'Profile per Trigger angelegt');

-- ---------- Beitreten ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.join_group('test27', 'Anna');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select public.join_group(' TEST27 ', 'Ben');
select pg_temp.expect_error($q$ select public.join_group('TEST27', 'anna') $q$, 'name_taken');
select pg_temp.expect_error($q$ select public.update_my_profile('ANNA', '#123456') $q$, 'name_taken');
select pg_temp.expect_error($q$ select public.update_my_profile('Ben', 'red') $q$, 'invalid_color');
select public.update_my_profile('Benny', '#123456');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
select pg_temp.expect_error($q$ select public.join_group('FALSCH', 'Carl') $q$, 'invalid_code');
select pg_temp.expect_eq((select count(*) from public.tours), 0, 'Nicht-Mitglied sieht keine Rundfahrten');
select pg_temp.expect_eq((select count(*) from public.profiles), 1, 'Nicht-Mitglied sieht nur eigenes Profil');
commit;

update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';

-- ---------- Admin legt Daten an ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.tours (id, name, short_name, theme, year, start_date, end_date)
values ('open-test', 'Offene Testtour', 'Offen', 'giro', 2026, current_date + 1, current_date + 5),
       ('past-test', 'Laufende Testtour', 'Läuft', 'tour', 2026, current_date - 1, current_date + 5);
insert into public.stages (tour_id, number, starts_at) values
  ('open-test', 1, now() + interval '1 day'),
  ('open-test', 2, now() + interval '2 days'),
  ('open-test', 3, now() + interval '3 days'),
  ('past-test', 1, now() - interval '1 hour'),
  ('past-test', 2, now() + interval '1 day');
insert into public.riders (tour_id, bib, name, team, tip_limit, status) values
  ('open-test', 1, 'Tadej Pogačar', 'UAE', 1, 'active'),
  ('open-test', 2, 'Jonathan Milan', 'Lidl-Trek', null, 'active'),
  ('open-test', 3, 'Raus Fahrer', 'Lidl-Trek', null, 'out'),
  ('past-test', 1, 'Kaden Groves', 'Alpecin', null, 'active'),
  ('past-test', 2, 'Mads Pedersen', 'Lidl-Trek', null, 'active');
select pg_temp.expect_eq((select count(*) from public.app_settings), 1, 'Admin liest Einstellungen');
select pg_temp.expect_eq((select count(*) from public.admin_list_users()), 3, 'Admin listet Konten');
select pg_temp.expect_error($q$ select public.admin_set_flags('00000000-0000-0000-0000-00000000000a', true, false, false) $q$, 'cannot_remove_own_admin');
commit;

-- ---------- Etappentipps ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 1 and r.name = 'Tadej Pogačar';
select pg_temp.expect_error($q$
  insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 2 and r.name = 'Tadej Pogačar' $q$, 'joker_limit_reached');
insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 2 and r.name = 'Jonathan Milan';
select pg_temp.expect_error($q$
  update public.stage_tips set rider_id = (select id from public.riders where name = 'Tadej Pogačar')
   where stage_id = (select id from public.stages where tour_id = 'open-test' and number = 2) $q$, 'joker_limit_reached');
select pg_temp.expect_error($q$
  insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 3 and r.name = 'Raus Fahrer' $q$, 'rider_not_active');
select pg_temp.expect_error($q$
  insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 3 and r.name = 'Kaden Groves' $q$, 'rider_not_in_tour');
select pg_temp.expect_error($q$
  insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'past-test' and s.number = 1 and r.name = 'Kaden Groves' $q$, 'row-level security');
-- Upsert wie aus der App (insert … on conflict do update)
insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 2 and r.name = 'Jonathan Milan'
on conflict (stage_id, user_id) do update set rider_id = excluded.rider_id;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 1 and r.name = 'Jonathan Milan';
select pg_temp.expect_eq((select count(*) from public.stage_tips), 1, 'Fremde Tipps vor Start verdeckt (auch für Admin)');
select pg_temp.expect_eq(
  (select count(*) from public.stage_tippers((select id from public.stages where tour_id = 'open-test' and number = 1))),
  2, 'Anzahl Tippender sichtbar');
select pg_temp.expect_error($q$
  update public.stages set results_published = true where tour_id = 'open-test' and number = 1 $q$, 'stage_not_started');
commit;

-- Tipps für eine gestartete Etappe (direkt als postgres eingetragen)
insert into public.stage_tips (stage_id, user_id, rider_id)
  select s.id, u.id, r.id
    from public.stages s, public.riders r,
         (values ('00000000-0000-0000-0000-00000000000a'::uuid), ('00000000-0000-0000-0000-00000000000b'::uuid)) u(id)
   where s.tour_id = 'past-test' and s.number = 1 and r.name = 'Kaden Groves';

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq(
  (select count(*) from public.stage_tips where stage_id = (select id from public.stages where tour_id = 'past-test' and number = 1)),
  2, 'Nach Start alle Tipps sichtbar');
insert into public.stage_results (stage_id, position, rider_id)
  select s.id, 1, r.id from public.stages s, public.riders r
   where s.tour_id = 'past-test' and s.number = 1 and r.name = 'Kaden Groves';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_eq((select count(*) from public.stage_results), 0, 'Unveröffentlichte Ergebnisse verdeckt');
update public.stages set results_published = true where tour_id = 'past-test' and number = 1;  -- wirkt nicht (kein Admin)
select pg_temp.expect_error($q$ select * from public.admin_list_users() $q$, 'not_admin');
select pg_temp.expect_eq((select count(*) from public.app_settings), 0, 'Einladungscode nur für Admins');
select pg_temp.expect_eq((select count(*) from public.profiles), 2, 'Mitglied sieht alle Mitglieder');
commit;

select pg_temp.expect_eq((select count(*) from public.stages where results_published), 0, 'Nur Admins veröffentlichen');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.stages set results_published = true where tour_id = 'past-test' and number = 1;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_eq((select count(*) from public.stage_results), 1, 'Veröffentlichte Ergebnisse sichtbar');
commit;

-- ---------- Bonustipps ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.bonus_tips (tour_id, category, rider_id)
  select 'open-test', 'gc', r.id from public.riders r where r.name = 'Tadej Pogačar';
insert into public.bonus_tips (tour_id, category, team) values ('open-test', 'team', 'UAE');
select pg_temp.expect_error($q$ insert into public.bonus_tips (tour_id, category, team) values ('open-test', 'team', 'Gibt es nicht') $q$, 'team_not_in_tour');
select pg_temp.expect_error($q$ insert into public.bonus_tips (tour_id, category, team) values ('open-test', 'gc', 'UAE') $q$, 'bonus_tips_shape');
select pg_temp.expect_error($q$
  insert into public.bonus_tips (tour_id, category, rider_id)
  select 'past-test', 'gc', r.id from public.riders r where r.name = 'Kaden Groves' $q$, 'row-level security');
commit;

insert into public.bonus_tips (tour_id, user_id, category, rider_id)
  select 'past-test', '00000000-0000-0000-0000-00000000000b', 'gc', r.id from public.riders r where r.name = 'Kaden Groves';

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq((select count(*) from public.bonus_tips where tour_id = 'open-test'), 0, 'Fremde Bonustipps vor Start verdeckt');
select pg_temp.expect_eq((select count(*) from public.bonus_tips where tour_id = 'past-test'), 1, 'Fremde Bonustipps nach Start sichtbar');
commit;

-- ---------- Anonym ----------
begin;
set local role anon;
select pg_temp.expect_eq((select count(*) from public.tours), 0, 'Anonym sieht nichts');
select pg_temp.expect_error($q$ select public.join_group('TEST27', 'Hacker') $q$, 'permission denied');
select pg_temp.expect_eq((select count(*) from (select public.ping()) x), 1, 'Ping für anon');
commit;

-- ---------- Konto löschen ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
select public.delete_my_account();
commit;
select pg_temp.expect_eq((select count(*) from auth.users), 2, 'Konto gelöscht');
select pg_temp.expect_eq((select count(*) from public.profiles), 2, 'Profil mitgelöscht');

\echo 'Alle Schema-Tests bestanden.'
