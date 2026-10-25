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
