#!/usr/bin/env bash
# Lokaler Schema-Test gegen ein normales PostgreSQL (nicht Supabase).
# Nutzung: PGHOST=/tmp/pgtest PGPORT=54329 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=gruppetto_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/supabase_shim.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/schema.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/schema.sql   # zweiter Lauf: wiederholbar?
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/rls_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/sync_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/seed_testrunde.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/seed_testrunde.sql   # wiederholbar?
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Testrunde: ' || (select count(*) from public.stages where tour_id = 'testrunde') || ' Etappen, ' || (select count(*) from public.riders where tour_id = 'testrunde') || ' Fahrer'"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/simulate_testrunde.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "update public.stages set starts_at = now() - interval '1 day' * (6 - number) where tour_id = 'testrunde' and number <= 2"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Simuliert: ' || public.simulate_testrunde() || ' Etappen'"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Bonus-Einträge: ' || (select count(*) from public.bonus_results where tour_id = 'testrunde') || ', final: ' || (select bonus_final from public.tours where id = 'testrunde')"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "update public.stages set starts_at = now() - interval '5 hours' where tour_id = 'testrunde'"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Simuliert: ' || public.simulate_testrunde() || ' Etappen'"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Ergebnisse: ' || (select count(*) from public.stage_results sr join public.stages s on s.id = sr.stage_id where s.tour_id = 'testrunde') || ', Bonus-Einträge: ' || (select count(*) from public.bonus_results where tour_id = 'testrunde') || ', final: ' || (select bonus_final from public.tours where id = 'testrunde')"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select s.number || '. ' || s.kind || ': ' || string_agg(r.name, ', ' order by sr.position) from public.stage_results sr join public.stages s on s.id = sr.stage_id join public.riders r on r.id = sr.rider_id where s.tour_id = 'testrunde' and sr.position <= 3 group by s.number, s.kind order by s.number"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select b.category || ' ' || b.position || ': ' || coalesce(r.name, b.team) from public.bonus_results b left join public.riders r on r.id = b.rider_id where b.tour_id = 'testrunde' order by b.category, b.position"
# Giro-2026-Testrunde: Seed + Nachspielen
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/seed_giro2026.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Giro 2026: ' || (select count(*) from public.stages where tour_id = 'giro-2026') || ' Etappen, ' || (select count(*) from public.riders where tour_id = 'giro-2026') || ' Fahrer, ' || (select count(*) from public.cyclists) || ' Stammdaten, testrunde weg: ' || (not exists (select 1 from public.tours where id = 'testrunde'))"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "update public.stages set starts_at = now() - interval '1 day' * (8 - number) where tour_id = 'giro-2026' and number <= 7"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Nachgespielt: ' || public.replay_giro2026() || ' Etappen'"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Nach Etappe 7: ' || (select count(*) from public.riders where tour_id = 'giro-2026' and status = 'out') || ' ausgestiegen, Rosa: ' || (select r.name from public.bonus_results b join public.riders r on r.id = b.rider_id where b.tour_id = 'giro-2026' and b.category = 'gc' and b.position = 1) || ', Sieger E7: ' || (select r.name from public.stage_results sr join public.stages s on s.id = sr.stage_id join public.riders r on r.id = sr.rider_id where s.tour_id = 'giro-2026' and s.number = 7 and sr.position = 1)"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "update public.stages set starts_at = now() - interval '7 hours' where tour_id = 'giro-2026'"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Nachgespielt: ' || public.replay_giro2026() || ' Etappen'"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Ende: ' || (select count(*) from public.stage_results sr join public.stages s on s.id = sr.stage_id where s.tour_id = 'giro-2026') || ' Ergebnisse, ' || (select count(*) from public.riders where tour_id = 'giro-2026' and status = 'out') || ' ausgestiegen, Bonus-Einträge ' || (select count(*) from public.bonus_results where tour_id = 'giro-2026') || ', final ' || (select bonus_final from public.tours where id = 'giro-2026')"
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Giro-Wertungsstände: ' || count(*) from public.stage_standings"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/seed_giro2026.sql   # wiederholbar?
# Generalprobe der Automatik: schaltet die Testrunde auf den Workflow um
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/sync_generalprobe.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -tAc "select 'Generalprobe: Automatik ' || sync_mode from public.tours where id = 'giro-2026'"
