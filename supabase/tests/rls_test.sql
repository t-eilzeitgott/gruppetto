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
update public.tours set tip_limit = 1 where id = 'open-test';  -- Standard-Limit der Rundfahrt
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
-- Limit der Rundfahrt gilt auch ohne eigenes Fahrer-Limit
select pg_temp.expect_error($q$
  insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and s.number = 3 and r.name = 'Jonathan Milan' $q$, 'joker_limit_reached');
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

-- ---------- Pro-Anfrage ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select public.request_pro(true);
select pg_temp.expect_error($q$ update public.profiles set is_pro = true where id = auth.uid() $q$, 'permission denied');
commit;
select pg_temp.expect_eq((select count(*) from public.profiles where pro_requested_at is not null and not is_pro), 1, 'Pro angefragt, aber nicht aktiv');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq((select count(*) from public.admin_list_users() where pro_requested_at is not null), 1, 'Admin sieht Pro-Anfrage');
commit;

-- ---------- Lieblingsfahrer + Stammdaten ----------
select pg_temp.expect_eq((select count(*) from public.riders where cyclist_id is null), 0, 'Alle Fahrer mit Stammdaten verknüpft');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.favorite_cyclists (cyclist_id) select id from public.cyclists where name = 'Jonathan Milan';
select pg_temp.expect_eq((select count(*) from public.favorite_cyclists), 1, 'Eigener Favorit sichtbar');
select pg_temp.expect_eq((select count(*) from public.cyclists), (select count(*) from public.cyclists), 'Stammdaten lesbar');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq((select count(*) from public.favorite_cyclists), 0, 'Fremde Favoriten unsichtbar');
select pg_temp.expect_error($q$ insert into public.favorite_cyclists (user_id, cyclist_id) select '00000000-0000-0000-0000-00000000000b', id from public.cyclists limit 1 $q$, 'row-level security');
commit;

-- ---------- Höhenprofile ----------
insert into public.stage_profiles (stage_id, points) select id, '[[0,100],[10,500]]'::jsonb from public.stages where tour_id = 'open-test' and number = 1;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_eq((select count(*) from public.stage_profiles), 1, 'Mitglied sieht Höhenprofil');
select pg_temp.expect_error($q$ insert into public.stage_profiles (stage_id, points) select id, '[]'::jsonb from public.stages where tour_id = 'open-test' and number = 2 $q$, 'row-level security');
commit;

-- ---------- Minispiel ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.game_scores (game, score, meters) values ('abfahrt', 1200, 800), ('abfahrt', 900, 1100);
select pg_temp.expect_error($q$ insert into public.game_scores (user_id, game, score) values ('00000000-0000-0000-0000-00000000000a', 'abfahrt', 5) $q$, 'row-level security');
select pg_temp.expect_eq((select best from public.game_leaderboard('abfahrt') limit 1), 1200, 'Bestenliste: beste Punktzahl');
select pg_temp.expect_eq((select runs from public.game_leaderboard('abfahrt') limit 1), 2, 'Bestenliste: Anzahl Läufe');
select pg_temp.expect_eq((select best_m from public.game_leaderboard('abfahrt') limit 1), 1100, 'Bestenliste: weiteste Strecke');
select pg_temp.expect_eq((select total_m from public.game_leaderboard('abfahrt') limit 1)::int, 1900, 'Bestenliste: Gesamtstrecke');
select pg_temp.expect_eq((select count(*) from public.game_leaderboard('abfahrt', now() + interval '1 hour'))::int, 0, 'Bestenliste: Zeitfilter');
select pg_temp.expect_error($q$ insert into public.game_scores (game, score, meters) values ('abfahrt', 10, -5) $q$, 'check');
-- Kennzahlen: die des besten Laufs (nicht des letzten)
insert into public.game_scores (game, score, meters, stats) values ('sprint', 700, 2400, '{"avg_kmh": 48.2, "reserve": 0.12}'), ('sprint', 500, 2400, '{"avg_kmh": 44.0, "reserve": 0.4}');
select pg_temp.expect_eq((select ((stats->>'avg_kmh')::numeric * 10)::bigint from public.game_leaderboard('sprint') limit 1), 482, 'Bestenliste: Kennzahlen des besten Laufs');
select pg_temp.expect_error($q$ insert into public.game_scores (game, score, stats) values ('sprint', 10, '[1,2]') $q$, 'check');
-- Zeitfahren: Zeit als Punktzahl (1.000.000 − ms), Geist je Tag – nur die schnellere Fahrt ersetzt die gespeicherte
insert into public.game_scores (game, score, meters) values ('zeitfahren', 1000000 - 224300, 3000);
insert into public.tt_ghosts (day, time_ms, bike, splits, trace) values (current_date, 224300, 'aero', '{77900,159300}', '[0,30,0,35,28,0]');
insert into public.tt_ghosts (day, time_ms, bike, splits, trace) values (current_date, 230000, 'zeit', '{}', '[0,0,0]')
  on conflict (user_id, day) do update set time_ms = excluded.time_ms, bike = excluded.bike, splits = excluded.splits, trace = excluded.trace;
select pg_temp.expect_eq((select time_ms from public.tt_ghosts where day = current_date), 224300, 'Geist: langsamere Fahrt ersetzt nicht');
select pg_temp.expect_eq((select count(*) from public.tt_ghosts where day = current_date and bike = 'aero'), 1, 'Geist: Rad bleibt');
insert into public.tt_ghosts (day, time_ms, bike, splits, trace) values (current_date, 221000, 'zeit', '{76000,157000}', '[0,0,0,36,10,1]')
  on conflict (user_id, day) do update set time_ms = excluded.time_ms, bike = excluded.bike, splits = excluded.splits, trace = excluded.trace;
select pg_temp.expect_eq((select time_ms from public.tt_ghosts where day = current_date), 221000, 'Geist: schnellere Fahrt ersetzt');
select pg_temp.expect_error($q$ insert into public.tt_ghosts (user_id, day, time_ms, trace) values ('00000000-0000-0000-0000-00000000000a', current_date, 100000, '[0,0,0]') $q$, 'row-level security');
select pg_temp.expect_error($q$ insert into public.tt_ghosts (day, time_ms, trace) values (current_date - 1, 0, '[0,0,0]') $q$, 'check');
-- Geister der anderen Spiele: höhere Punktzahl ersetzt, niedrigere nicht; der letzte je Spiel in der Sicht
insert into public.game_ghosts (game, day, score, meters, trace) values ('abfahrt', current_date - 2, 500, 900, '[0,0,0]');
insert into public.game_ghosts (game, day, score, meters, bike, trace) values ('abfahrt', current_date, 1200, 2000, 'aero', '[0,0,0,30,0,0]');
insert into public.game_ghosts (game, day, score, meters, trace) values ('abfahrt', current_date, 800, 1500, '[0,0,0]')
  on conflict (user_id, game, day) do update set score = excluded.score, meters = excluded.meters, trace = excluded.trace;
select pg_temp.expect_eq((select score from public.game_ghosts where game = 'abfahrt' and day = current_date), 1200, 'Geist: schlechterer Lauf ersetzt nicht');
insert into public.game_ghosts (game, day, score, meters, trace) values ('abfahrt', current_date, 1500, 2400, '[0,0,0]')
  on conflict (user_id, game, day) do update set score = excluded.score, meters = excluded.meters, trace = excluded.trace;
select pg_temp.expect_eq((select score from public.game_ghosts where game = 'abfahrt' and day = current_date), 1500, 'Geist: besserer Lauf ersetzt');
select pg_temp.expect_eq((select score from public.game_ghosts_latest where game = 'abfahrt' and user_id = auth.uid()), 1500, 'Geist: letzter je Spiel');
select pg_temp.expect_eq((select count(*) from public.tt_ghosts_latest where user_id = auth.uid() and day = current_date), 1, 'Geist Zeitfahren: letzter');
select pg_temp.expect_error($q$ insert into public.game_ghosts (user_id, game, day, score, trace) values ('00000000-0000-0000-0000-00000000000a', 'sprint', current_date, 1, '[0,0,0]') $q$, 'row-level security');
select pg_temp.expect_error($q$ insert into public.game_ghosts (game, day, score, trace) values ('zeitfahren', current_date, 1, '[0,0,0]') $q$, 'check');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq((select count(*) from public.tt_ghosts where day = current_date), 1, 'Geister: Mitglied sieht fremde Fahrten');
select pg_temp.expect_eq((select count(*) from public.game_ghosts_latest where game = 'abfahrt'), 1, 'Geister: Mitglied sieht fremde Läufe (letzte)');
update public.game_ghosts set score = 99999 where game = 'abfahrt';
select pg_temp.expect_eq((select max(score) from public.game_ghosts where game = 'abfahrt'), 1500, 'Geister: fremder Lauf nicht änderbar');
update public.tt_ghosts set time_ms = 1 where day = current_date;
select pg_temp.expect_eq((select time_ms from public.tt_ghosts where day = current_date), 221000, 'Geister: fremde Fahrt nicht änderbar');
commit;

-- ---------- Live in den Minispielen ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
-- Anna fährt Abfahrt (Rennen), sieht noch niemanden
select pg_temp.expect_eq(jsonb_array_length(public.game_live_ping('abfahrt', 'd1', 'race', 'r1', 4, array[0,0,0, 30,10,1, 60,20,1, 90,0,0], 'aero') -> 'peers'), 0, 'Live: allein');
select pg_temp.expect_error($q$ select * from public.game_live $q$, 'permission denied');
select pg_temp.expect_error($q$ select * from public.game_lobbies $q$, 'permission denied');
select pg_temp.expect_error($q$ select public.game_live_state('abfahrt', 'd1') $q$, 'permission denied');
select pg_temp.expect_error($q$ select public.game_live_ping('tetris', 'd1', 'race', 'r1', 0, '{}', '') $q$, 'check');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
-- Ben auf derselben Strecke: bekommt Annas Spur; auf einer anderen Strecke oder im Startblatt nur die letzte Probe
select pg_temp.expect_eq(jsonb_array_length(public.game_live_ping('abfahrt', 'd1', 'race', 'x', 0, '{}', '') -> 'peers' -> 0 -> 'tail'), 12, 'Live: Spur auf derselben Strecke');
select pg_temp.expect_eq(jsonb_array_length(public.game_live_ping('abfahrt', 'd2', 'race', 'x', 0, '{}', '') -> 'peers' -> 0 -> 'tail'), 3, 'Live: andere Strecke nur letzte Probe');
select pg_temp.expect_eq((public.game_live_ping('sprint', 'd1', 'menu', '', 0, '{}', '') -> 'peers' -> 0 ->> 'n')::int, 4, 'Live: anderes Spiel, Zahl der Proben');
select pg_temp.expect_eq((public.game_live_list() -> 'peers' -> 0 -> 'tail' ->> 0)::int, 90, 'Live: Liste mit letzter Probe');
select pg_temp.expect_eq(((public.game_live_list() ->> 'now')::bigint > 0)::int, 1, 'Live: Serverzeit');
select pg_temp.expect_eq((public.game_live_list() -> 'lobby' is null or public.game_live_list() -> 'lobby' = 'null'::jsonb)::int, 1, 'Live: ohne Lobby');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
-- Nicht-Mitglied: weder melden noch sehen, keine Lobby
select pg_temp.expect_eq((public.game_live_ping('abfahrt', 'd1', 'race', 'r', 0, '{}', '') is null)::int, 1, 'Live: Nicht-Mitglied sieht niemanden');
select pg_temp.expect_eq((public.game_live_list() is null)::int, 1, 'Live: Nicht-Mitglied ohne Liste');
select pg_temp.expect_error($q$ select public.lobby_create() $q$, 'not_member');
commit;
select pg_temp.expect_eq((select count(*) from public.game_live), 2, 'Live: Nicht-Mitglied nicht eingetragen');

-- Lobby: Anna eröffnet, Ben tritt mit dem Code bei (klein geschrieben, mit Leerzeichen), Ben startet ein Rennen
create temp table lobby_code (code text);
grant all on lobby_code to authenticated;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into lobby_code select public.lobby_create();
select pg_temp.expect_eq((select count(*) from lobby_code where code ~ '^[A-Z0-9]{4}$'), 1, 'Lobby: Code mit vier Zeichen');
select pg_temp.expect_eq(jsonb_array_length(public.game_live_list() -> 'lobby' -> 'members'), 1, 'Lobby: Anna drin');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_error($q$ select public.lobby_join('ZZZZ') $q$, 'lobby_not_found');
select pg_temp.expect_error($q$ select public.lobby_start('sprint') $q$, 'no_lobby');
select public.lobby_join(' ' || lower((select code from lobby_code)) || ' ');
select pg_temp.expect_eq(jsonb_array_length(public.game_live_list() -> 'lobby' -> 'members'), 2, 'Lobby: Ben drin');
select pg_temp.expect_eq((public.lobby_start('sprint') -> 'lobby' ->> 'seq')::int, 1, 'Lobby: Rennen gestartet');
select pg_temp.expect_error($q$ select public.lobby_start('tetris') $q$, 'invalid_game');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq(((public.game_live_list() -> 'lobby' ->> 'game') = 'sprint')::int, 1, 'Lobby: Anna sieht das Rennen');
select pg_temp.expect_eq(((public.game_live_list() -> 'lobby' ->> 'at')::bigint - (public.game_live_list() ->> 'now')::bigint between 10000 and 12500)::int, 1, 'Lobby: Start mit Vorlauf');
select public.lobby_leave();
select pg_temp.expect_eq((public.game_live_list() -> 'lobby' = 'null'::jsonb or public.game_live_list() -> 'lobby' is null)::int, 1, 'Lobby: Anna draußen');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_eq(jsonb_array_length(public.game_live_list() -> 'lobby' -> 'members'), 1, 'Lobby: Ben allein');
select public.lobby_leave();
commit;
select pg_temp.expect_eq((select count(*) from public.game_lobbies), 0, 'Lobby: leer gelöscht');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.game_live_leave();
commit;
select pg_temp.expect_eq((select count(*) from public.game_live), 1, 'Live: verlassen');
update public.game_live set updated_at = now() - interval '20 seconds';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq(jsonb_array_length(public.game_live_list() -> 'peers'), 0, 'Live: nach 15 s nicht mehr live');
commit;

-- ---------- Anonym ----------
begin;
set local role anon;
select pg_temp.expect_eq((select count(*) from public.tours), 0, 'Anonym sieht nichts');
select pg_temp.expect_error($q$ select public.game_live_list() $q$, 'permission denied');
select pg_temp.expect_error($q$ select public.lobby_join('ABCD') $q$, 'permission denied');
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
