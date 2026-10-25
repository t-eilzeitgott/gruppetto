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
