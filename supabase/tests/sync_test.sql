-- Testet die automatische Ergebnis-Übernahme (sync_apply_stage, Pausieren, Rechte).
-- Ausführen: ./supabase/tests/run.sh  (nach rls_test.sql)
\set ON_ERROR_STOP on
\set QUIET on

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

create or replace function pg_temp.expect_eq(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FEHLGESCHLAGEN: % – erwartet %, bekommen %', p_label, p_expected, p_actual;
  end if;
end $$;

-- ---------- Setup als postgres ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dora@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'emil@example.com');
update public.profiles set display_name = 'Dora', is_member = true, is_admin = true where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set display_name = 'Emil', is_member = true where id = '00000000-0000-0000-0000-0000000000e1';

insert into public.tours (id, name, short_name, theme, year, start_date, end_date, pcs_slug)
values ('sync-test', 'Sync-Test', 'Sync', 'giro', 2027, current_date - 1, current_date + 5, 'giro-d-italia/2026'),
       ('andere', 'Andere', 'And', 'tour', 2027, current_date - 1, current_date + 5, null);
select pg_temp.expect_eq((select sync_mode from public.tours where id = 'sync-test'), 'off', 'Automatik ist standardmäßig aus');

insert into public.stages (tour_id, number, starts_at, distance_km) values
  ('sync-test', 1, now() - interval '5 hours', 150),
  ('sync-test', 2, now() + interval '1 day', 180),
  ('andere', 1, now() - interval '5 hours', 100);
insert into public.riders (tour_id, bib, name, team) values
  ('sync-test', 1, 'Kaden Groves', 'Alpecin'),
  ('sync-test', 2, 'Jonathan Milan', 'Lidl-Trek'),
  ('sync-test', 3, 'Mads Pedersen', 'Lidl-Trek'),
  ('sync-test', 4, 'Tadej Pogačar', 'UAE'),
  ('andere', 1, 'Fremder Fahrer', 'X');

create temporary table ids as
select (select id from public.stages where tour_id = 'sync-test' and number = 1) as s1,
       (select id from public.stages where tour_id = 'sync-test' and number = 2) as s2,
       (select id from public.riders where tour_id = 'sync-test' and name = 'Kaden Groves') as groves,
       (select id from public.riders where tour_id = 'sync-test' and name = 'Jonathan Milan') as milan,
       (select id from public.riders where tour_id = 'sync-test' and name = 'Mads Pedersen') as pedersen,
       (select id from public.riders where tour_id = 'sync-test' and name = 'Tadej Pogačar') as pogi,
       (select id from public.riders where name = 'Fremder Fahrer') as fremd;
grant select on ids to public;

-- ---------- Nur der Workflow (service_role) darf schreiben ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
select pg_temp.expect_error(format($q$ select public.sync_apply_stage(%s, '{}'::jsonb) $q$, (select s1 from ids)), 'permission denied');
commit;

begin;
set local role anon;
select pg_temp.expect_error(format($q$ select public.sync_apply_stage(%s, '{}'::jsonb) $q$, (select s1 from ids)), 'permission denied');
commit;

-- ---------- Ergebnis übernehmen und veröffentlichen ----------
begin;
set local role service_role;
select public.sync_apply_stage((select s1 from ids), jsonb_build_object(
  'state', jsonb_build_object('status', 'veröffentlicht', 'source_url', 'https://www.procyclingstats.com/race/giro-d-italia/2026/stage-1',
                              'candidate', jsonb_build_array((select groves from ids), (select milan from ids))),
  'results', jsonb_build_array(
     jsonb_build_object('position', 1, 'rider_id', (select groves from ids)),
     jsonb_build_object('position', 2, 'rider_id', (select milan from ids))),
  'standings', jsonb_build_object('gc', jsonb_build_array(
     jsonb_build_object('position', 1, 'rider_id', (select groves from ids)),
     jsonb_build_object('position', 2, 'rider_id', (select pogi from ids)))),
  'out', jsonb_build_array((select pedersen from ids)),
  'publish', true,
  'stage', jsonb_build_object('distance_km', 142.5),
  'bonus', jsonb_build_object(
     'gc', jsonb_build_array(jsonb_build_object('position', 1, 'rider_id', (select groves from ids))),
     'team', jsonb_build_array(jsonb_build_object('position', 1, 'team', 'Lidl-Trek'))),
  'logs', jsonb_build_array(jsonb_build_object('level', 'change', 'message', 'Ergebnis Etappe 1 übernommen'))));
commit;

select pg_temp.expect_eq((select string_agg(r.name, ', ' order by sr.position) from public.stage_results sr join public.riders r on r.id = sr.rider_id where sr.stage_id = (select s1 from ids)), 'Kaden Groves, Jonathan Milan', 'Ergebnis eingetragen');
select pg_temp.expect_eq((select results_published::text from public.stages where id = (select s1 from ids)), 'true', 'veröffentlicht');
select pg_temp.expect_eq((select count(*)::text from public.stage_standings where stage_id = (select s1 from ids) and category = 'gc'), '2', 'Gesamtwertung eingetragen');
select pg_temp.expect_eq((select status from public.riders where id = (select pedersen from ids)), 'out', 'Ausstieg übernommen');
select pg_temp.expect_eq((select distance_km::text from public.stages where id = (select s1 from ids)), '142.5', 'Distanz geändert');
select pg_temp.expect_eq((select team from public.bonus_results where tour_id = 'sync-test' and category = 'team'), 'Lidl-Trek', 'Bonus-Zwischenstand Team');
select pg_temp.expect_eq((select paused::text || ' ' || status from public.stage_sync where stage_id = (select s1 from ids)), 'false veröffentlicht', 'Workflow pausiert nicht');
select pg_temp.expect_eq((select count(*)::text from public.sync_log where tour_id = 'sync-test'), '1', 'Protokoll geschrieben');

-- ---------- Ungültige Daten ----------
begin;
set local role service_role;
select pg_temp.expect_error(format($q$ select public.sync_apply_stage(%s, '{"results":[{"position":1,"rider_id":%s}]}'::jsonb) $q$, (select s1 from ids), (select fremd from ids)), 'rider_not_in_tour');
select pg_temp.expect_error(format($q$ select public.sync_apply_stage(%s, '{"publish":true}'::jsonb) $q$, (select s2 from ids)), 'stage_not_started');
select pg_temp.expect_error(format($q$ select public.sync_apply_stage(%s, '{"bonus":{"combative":[]}}'::jsonb) $q$, (select s1 from ids)), 'invalid_category');
select pg_temp.expect_error($q$ select public.sync_apply_stage(-1, '{}'::jsonb) $q$, 'stage_not_found');
commit;

-- ---------- Sichtbarkeit: nur Admins sehen Status und Protokoll ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select pg_temp.expect_eq((select count(*)::text from public.stage_sync), '0', 'Mitglied sieht keinen Sync-Status');
select pg_temp.expect_eq((select count(*)::text from public.sync_log), '0', 'Mitglied sieht kein Protokoll');
select pg_temp.expect_error(format($q$ select public.admin_set_stage_sync_paused(%s, true) $q$, (select s1 from ids)), 'not_admin');
select pg_temp.expect_error($q$ insert into public.sync_log (level, message) values ('info', 'x') $q$, 'permission denied');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
select pg_temp.expect_eq((select count(*)::text from public.stage_sync where stage_id = (select s1 from ids)), '1', 'Admin sieht Sync-Status');
select pg_temp.expect_eq((select count(*)::text from public.sync_log where tour_id = 'sync-test'), '1', 'Admin sieht Protokoll');
-- Admin setzt den Modus über die normale Tabelle
update public.tours set sync_mode = 'auto' where id = 'sync-test';
select pg_temp.expect_error($q$ update public.tours set sync_mode = 'immer' where id = 'sync-test' $q$, 'tours_sync_mode_check');
commit;
select pg_temp.expect_eq((select sync_mode from public.tours where id = 'sync-test'), 'auto', 'Modus gesetzt');

-- ---------- Handeingriff pausiert die Etappe ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
update public.stage_results set rider_id = (select pogi from ids) where stage_id = (select s1 from ids) and position = 2;
commit;
select pg_temp.expect_eq((select paused::text || ' / ' || paused_reason from public.stage_sync where stage_id = (select s1 from ids)), 'true / Ergebnis von Hand geändert', 'Handeingriff pausiert');

begin;
set local role service_role;
create temporary table r1 on commit drop as
select public.sync_apply_stage((select s1 from ids), jsonb_build_object(
  'results', jsonb_build_array(jsonb_build_object('position', 1, 'rider_id', (select milan from ids))),
  'state', jsonb_build_object('status', 'veröffentlicht'),
  'logs', jsonb_build_array(jsonb_build_object('level', 'warning', 'message', 'pausiert')))) as res;
select pg_temp.expect_eq((select res->>'skipped' from r1), '["results"]', 'pausierte Etappe wird nicht überschrieben');
commit;
select pg_temp.expect_eq((select string_agg(r.name, ', ' order by sr.position) from public.stage_results sr join public.riders r on r.id = sr.rider_id where sr.stage_id = (select s1 from ids)), 'Kaden Groves, Tadej Pogačar', 'Handeintrag bleibt');
select pg_temp.expect_eq((select status from public.stage_sync where stage_id = (select s1 from ids)), 'pausiert', 'Status bleibt pausiert');

-- Admin setzt fort, Workflow darf wieder
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
select public.admin_set_stage_sync_paused((select s1 from ids), false);
commit;
select pg_temp.expect_eq((select paused::text from public.stage_sync where stage_id = (select s1 from ids)), 'false', 'fortgesetzt');

-- Zurückziehen der Veröffentlichung pausiert ebenfalls, Veröffentlichen nicht
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
update public.stages set results_published = false where id = (select s1 from ids);
commit;
select pg_temp.expect_eq((select paused_reason from public.stage_sync where stage_id = (select s1 from ids)), 'Veröffentlichung von Hand zurückgezogen', 'Zurückziehen pausiert');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
select public.admin_set_stage_sync_paused((select s1 from ids), false);
update public.stages set results_published = true where id = (select s1 from ids);
commit;
select pg_temp.expect_eq((select paused::text from public.stage_sync where stage_id = (select s1 from ids)), 'false', 'Veröffentlichen von Hand pausiert nicht');

-- ---------- Endstand gesetzt: Bonuswertungen bleiben unangetastet ----------
update public.tours set bonus_final = true where id = 'sync-test';
begin;
set local role service_role;
create temporary table r2 on commit drop as
select public.sync_apply_stage((select s1 from ids), jsonb_build_object(
  'bonus', jsonb_build_object('gc', jsonb_build_array(jsonb_build_object('position', 1, 'rider_id', (select pogi from ids)))))) as res;
select pg_temp.expect_eq((select res->>'skipped' from r2), '["bonus"]', 'Bonus nach Endstand übersprungen');
commit;
select pg_temp.expect_eq((select r.name from public.bonus_results b join public.riders r on r.id = b.rider_id where b.tour_id = 'sync-test' and b.category = 'gc'), 'Kaden Groves', 'Endstand bleibt');

-- Aufräumen
delete from public.tours where id in ('sync-test', 'andere');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1');
\echo 'Sync-Tests bestanden'
