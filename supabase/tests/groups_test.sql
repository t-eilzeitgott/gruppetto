-- Testet mehrere Gruppen nebeneinander: eigene Codes, eigene Regeln, gegenseitig unsichtbar.
-- Läuft nach rls_test.sql (Gruppe „Testrunde“ mit Anna als Leitung/Admin und Ben).
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

create or replace function pg_temp.expect_eq(p_actual bigint, p_expected bigint, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FEHLGESCHLAGEN: % – erwartet %, bekommen %', p_label, p_expected, p_actual;
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000d', 'dora@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'emil@example.com'),
  ('00000000-0000-0000-0000-00000000000f', 'finn@example.com');

create temp table group_code (code text);
grant all on group_code to authenticated;

-- ---------- Dora gründet eine zweite Gruppe ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
select pg_temp.expect_eq((public.my_group() is null)::int, 1, 'Ohne Gruppe: keine Gruppendaten');
-- derselbe Anzeigename wie in der ersten Gruppe ist erlaubt
insert into group_code select public.create_group('Zweite Runde', 'Anna');
select pg_temp.expect_eq((select count(*) from group_code where code ~ '^[A-HJ-NP-Z2-9]{6}$' and code <> 'TEST27'), 1, 'Zweite Gruppe: eigener Code');
select pg_temp.expect_eq((public.my_group() ->> 'invite_code' = (select code from group_code))::int, 1, 'Gründerin sieht ihren Code');
select pg_temp.expect_eq((public.my_group() -> 'stage_points' = '[20,15,10,7,6,5,4,3,2,1]'::jsonb and public.my_group() -> 'bonus_points' = '[15,10,5]'::jsonb
                          and (public.my_group() ->> 'tip_limit')::int = 3 and (public.my_group() ->> 'underdog_bonus')::boolean)::int, 1, 'Neue Gruppe: Standardregeln');
select pg_temp.expect_error($q$ select public.join_group('TEST27', 'Dora') $q$, 'already_in_group');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
select pg_temp.expect_error($q$ select public.join_group((select code from group_code), 'anna') $q$, 'name_taken');
select public.join_group(lower((select code from group_code)), 'Ben');  -- „Ben“ gibt es auch in der ersten Gruppe
select pg_temp.expect_eq((public.my_group() ->> 'invite_code' is null and not (public.my_group() ->> 'can_manage')::boolean)::int, 1, 'Mitglied: kein Code, keine Verwaltung');
select pg_temp.expect_error($q$ select public.group_update('Meins', '{1}', '{1,1,1}', null, true) $q$, 'not_group_owner');
select pg_temp.expect_error($q$ select public.group_transfer('00000000-0000-0000-0000-00000000000e') $q$, 'not_group_owner');
commit;

-- ---------- Gruppen sehen einander nicht ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
select pg_temp.expect_eq((select count(*) from public.profiles), 2, 'Nur die Mitglieder der eigenen Gruppe');
select pg_temp.expect_eq((select count(*) from public.tours where id like '%-test'), 2, 'Rundfahrten für alle Gruppen');
select pg_temp.expect_eq((select count(*) from public.stage_results), 1, 'Ergebnisse für alle Gruppen');
select pg_temp.expect_eq((select count(*) from public.stage_tips), 0, 'Tipps der anderen Gruppe unsichtbar (auch nach Etappenstart)');
select pg_temp.expect_eq((select count(*) from public.bonus_tips), 0, 'Bonustipps der anderen Gruppe unsichtbar');
select pg_temp.expect_eq(
  (select count(*) from public.stage_tippers((select id from public.stages where tour_id = 'open-test' and number = 1))),
  0, 'Tippende der anderen Gruppe zählen nicht');
select pg_temp.expect_eq((select count(*) from public.game_leaderboard('abfahrt')), 0, 'Bestenliste nur der eigenen Gruppe');
select pg_temp.expect_eq((select count(*) from public.game_scores), 0, 'Läufe der anderen Gruppe unsichtbar');
select pg_temp.expect_eq((select count(*) from public.tt_ghosts), 0, 'Geister der anderen Gruppe unsichtbar');
select pg_temp.expect_eq((select count(*) from public.game_ghosts_latest), 0, 'Geister (letzte) der anderen Gruppe unsichtbar');
-- eigene Regeln: in dieser Gruppe 3× je Fahrer (in der ersten nur 1×), ein eigenes Fahrer-Limit gilt weiter
insert into public.stage_tips (stage_id, rider_id)
  select s.id, r.id from public.stages s, public.riders r
   where s.tour_id = 'open-test' and r.name = 'Jonathan Milan';
select pg_temp.expect_eq((select count(*) from public.stage_tips), 3, 'Limit der eigenen Gruppe (3×)');
select pg_temp.expect_error($q$
  update public.stage_tips set rider_id = (select id from public.riders where name = 'Tadej Pogačar')
   where stage_id in (select id from public.stages where tour_id = 'open-test' and number <= 2) $q$, 'joker_limit_reached');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_eq((select count(*) from public.profiles), 2, 'Erste Gruppe sieht die zweite nicht');
select pg_temp.expect_eq(
  (select count(*) from public.stage_tippers((select id from public.stages where tour_id = 'open-test' and number = 1))),
  2, 'Erste Gruppe: weiter zwei Tippende');
commit;

-- ---------- Regeln ändern ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
select pg_temp.expect_error($q$ select public.group_update('Zweite Runde', '{1,2,3,4,5,6,7,8,9,10,11}', '{15,10,5}', 3, true) $q$, 'invalid_rules');
select pg_temp.expect_error($q$ select public.group_update('Zweite Runde', '{20,-1}', '{15,10,5}', 3, true) $q$, 'invalid_rules');
select pg_temp.expect_error($q$ select public.group_update('Zweite Runde', '{20,null}', '{15,10,5}', 3, true) $q$, 'invalid_rules');
select pg_temp.expect_error($q$ select public.group_update('Zweite Runde', '{}', '{15,10,5}', 3, true) $q$, 'invalid_rules');
select pg_temp.expect_error($q$ select public.group_update('Zweite Runde', '{20}', '{15,10}', 3, true) $q$, 'invalid_rules');
select pg_temp.expect_error($q$ select public.group_update('Zweite Runde', '{20}', '{15,10,5}', 0, true) $q$, 'invalid_rules');
select pg_temp.expect_error($q$ select public.group_update(' ', '{20}', '{15,10,5}', 3, true) $q$, 'invalid_group_name');
select public.group_update(' Bergziegen ', '{10,5}', '{9,6,3}', null, false);
select pg_temp.expect_eq((public.my_group() ->> 'name' = 'Bergziegen' and public.my_group() -> 'stage_points' = '[10,5]'::jsonb
                          and public.my_group() -> 'bonus_points' = '[9,6,3]'::jsonb and public.my_group() ->> 'tip_limit' is null
                          and not (public.my_group() ->> 'underdog_bonus')::boolean)::int, 1, 'Regeln geändert');
commit;
select pg_temp.expect_eq((select count(*) from public.groups where name = 'Testrunde' and tip_limit = 1 and stage_points[1] = 20), 1, 'Regeln der anderen Gruppe unberührt');

-- ---------- Neuer Code, Mitglied entfernen, Leitung übergeben ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
select pg_temp.expect_eq((public.group_new_code() <> (select code from group_code))::int, 1, 'Neuer Einladungscode');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
select pg_temp.expect_error($q$ select public.join_group((select code from group_code), 'Finn') $q$, 'invalid_code');
commit;
truncate group_code;
insert into group_code select invite_code from public.groups where name = 'Bergziegen';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
select public.join_group((select code from group_code), 'Finn');
select pg_temp.expect_eq((select count(*) from public.profiles), 3, 'Finn sieht seine Gruppe');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
select pg_temp.expect_error($q$ select public.group_remove_member('00000000-0000-0000-0000-00000000000d') $q$, 'cannot_remove_self');
select public.group_remove_member('00000000-0000-0000-0000-00000000000b');  -- anderes Gruppenmitglied: wirkt nicht
select public.group_remove_member('00000000-0000-0000-0000-00000000000f');
select pg_temp.expect_eq((select count(*) from public.profiles), 2, 'Finn entfernt');
select pg_temp.expect_error($q$ select public.group_transfer('00000000-0000-0000-0000-00000000000b') $q$, 'not_in_group');
select public.group_transfer('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_eq((not (public.my_group() ->> 'can_manage')::boolean and public.my_group() ->> 'invite_code' is null)::int, 1, 'Leitung abgegeben');
commit;
select pg_temp.expect_eq((select count(*) from public.profiles where is_member and group_id is not null), 4, 'Fremde Gruppe unberührt');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
select pg_temp.expect_eq((select count(*) from public.tours), 0, 'Entfernt: sieht nichts mehr');
select pg_temp.expect_eq((public.my_group() is null)::int, 1, 'Entfernt: keine Gruppe');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
select pg_temp.expect_eq(((public.my_group() ->> 'can_manage')::boolean and public.my_group() ->> 'owner_id' = '00000000-0000-0000-0000-00000000000e')::int, 1, 'Emil leitet jetzt');
select pg_temp.expect_error($q$ select public.group_remove_member('00000000-0000-0000-0000-00000000000e') $q$, 'cannot_remove_self');
commit;

-- ---------- Rundfahrt nur für eine Gruppe ----------
update public.tours set group_id = (select id from public.groups where name = 'Testrunde') where id = 'past-test';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
select pg_temp.expect_eq((select count(*) from public.tours where id like '%-test'), 1, 'Rundfahrt einer anderen Gruppe unsichtbar');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect_eq((select count(*) from public.tours where id like '%-test'), 2, 'Eigene Gruppen-Rundfahrt sichtbar');
commit;
update public.tours set group_id = null where id = 'past-test';

-- ---------- Live und Lobbys je Gruppe ----------
create temp table lobby_code2 (code text);
grant all on lobby_code2 to authenticated;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select public.game_live_ping('abfahrt', 'd1', 'race', 'r1', 1, array[0,0,0], 'aero');
insert into lobby_code2 select public.lobby_create();
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
select pg_temp.expect_eq(jsonb_array_length(public.game_live_ping('abfahrt', 'd1', 'race', 'x', 0, '{}', '') -> 'peers'), 0, 'Live: andere Gruppe unsichtbar');
select pg_temp.expect_error($q$ select public.lobby_join((select code from lobby_code2)) $q$, 'lobby_not_found');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect_eq(jsonb_array_length(public.game_live_list() -> 'peers'), 1, 'Live: eigene Gruppe sichtbar');
select public.lobby_join((select code from lobby_code2));
select public.lobby_leave();
-- Admin der App: sieht alle Konten mit Gruppe, nimmt Finn in die eigene Gruppe auf
select pg_temp.expect_eq((select count(*) from public.admin_list_users() where group_name = 'Bergziegen'), 2, 'Admin sieht Gruppen der Konten');
select pg_temp.expect_eq((select count(*) from public.admin_list_users() where is_owner), 2, 'Admin sieht die Leitungen');
select public.admin_set_flags('00000000-0000-0000-0000-00000000000f', true, false, false);
select pg_temp.expect_eq((select count(*) from public.profiles), 3, 'Admin nimmt Konto in die eigene Gruppe auf');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select public.lobby_leave();
select public.game_live_leave();
commit;

-- ---------- Leitung löscht ihr Konto: das dienstälteste Mitglied übernimmt; die letzte nimmt die Gruppe mit ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
select public.delete_my_account();
commit;
select pg_temp.expect_eq((select count(*) from public.groups where name = 'Bergziegen' and owner_id = '00000000-0000-0000-0000-00000000000d'), 1, 'Leitung rückt nach');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
select public.delete_my_account();
commit;
select pg_temp.expect_eq((select count(*) from public.groups), 1, 'Leere Gruppe gelöscht');
select pg_temp.expect_eq((select count(*) from public.stage_tips t where not exists (select 1 from public.profiles p where p.id = t.user_id)), 0, 'Tipps gelöschter Konten weg');

-- Admin entzieht der Leitung die Mitgliedschaft: jemand rückt nach
update public.groups set owner_id = '00000000-0000-0000-0000-00000000000b' where name = 'Testrunde';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.admin_set_flags('00000000-0000-0000-0000-00000000000b', false, false, false);
commit;
select pg_temp.expect_eq((select count(*) from public.groups where name = 'Testrunde' and owner_id = '00000000-0000-0000-0000-00000000000a'), 1, 'Leitung ohne Mitgliedschaft: Nachfolge');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.admin_set_flags('00000000-0000-0000-0000-00000000000b', true, false, false);
select public.admin_set_flags('00000000-0000-0000-0000-00000000000f', false, false, false);
commit;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000f';

\echo 'Alle Gruppen-Tests bestanden.'
