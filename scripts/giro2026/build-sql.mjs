// Erzeugt supabase/seed_giro2026.sql aus den echten Renndaten des Giro d'Italia 2026.
// Aufruf: node scripts/giro2026/build-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, RESULTS, GC, FINAL, EXCLUDED_FROM_REST, REGULATIONS } from './race.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const TOUR = 'giro-2026';

const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// ---------- Startliste einlesen und prüfen ----------
const lines = readFileSync(join(here, 'startlist.csv'), 'utf8').trim().split('\n').slice(1);
const riders = lines.map((line) => {
  const [bib, name, nat, team, age, young, final] = line.split(';');
  return { bib: Number(bib), name, nat: nat || null, team, age: Number(age), young: young === '1', final };
});
const byName = new Map(riders.map((r) => [r.name, r]));
const problems = [];
const need = (name, where) => { if (!byName.has(name)) problems.push(`${where}: unbekannter Fahrer „${name}“`); };

if (riders.length !== 184) problems.push(`Startliste: ${riders.length} statt 184 Fahrer`);
if (new Set(riders.map((r) => r.bib)).size !== riders.length) problems.push('Startliste: doppelte Startnummern');
const teams = [...new Set(riders.map((r) => r.team))];
if (teams.length !== 23) problems.push(`Startliste: ${teams.length} statt 23 Teams`);

// Ausstiege: DNF/OTL/DSQ-n → nach Etappe n raus, DNS-n → nach Etappe n-1 raus
const outAfter = new Map();
for (const r of riders) {
  const m = /^(DNF|DNS|OTL|DSQ)-(\d+)$/.exec(r.final);
  if (!m) { if (!/^\d+$/.test(r.final)) problems.push(`${r.name}: unbekannter Endstatus ${r.final}`); continue; }
  const n = Number(m[2]);
  outAfter.set(r.name, m[1] === 'DNS' ? n - 1 : n);
}

for (const s of STAGES) {
  const res = RESULTS[s.n];
  const gc = GC[s.n];
  if (!res || res.length !== 10) problems.push(`Etappe ${s.n}: Ergebnis hat ${res?.length ?? 0} Plätze`);
  if (!gc || gc.length !== 10) problems.push(`Etappe ${s.n}: Gesamtwertung hat ${gc?.length ?? 0} Plätze`);
  if (new Set(res).size !== res.length) problems.push(`Etappe ${s.n}: Fahrer doppelt im Ergebnis`);
  for (const n of res) {
    need(n, `Etappe ${s.n}`);
    const out = outAfter.get(n);
    if (out !== undefined && out < s.n) problems.push(`Etappe ${s.n}: ${n} ist laut Startliste schon nach Etappe ${out} raus`);
  }
  for (const n of gc) need(n, `Gesamtwertung ${s.n}`);
  for (const c of s.climbs) {
    if (c.km > s.km + 1) problems.push(`Etappe ${s.n}: ${c.name} bei km ${c.km} > ${s.km} km`);
    if (c.len && c.km - c.len < -0.5) problems.push(`Etappe ${s.n}: ${c.name} beginnt vor dem Start`);
    if (c.max && c.grad && c.max < c.grad) problems.push(`Etappe ${s.n}: ${c.name} Maximalsteigung < Ø`);
  }
}
for (const [cat, list] of Object.entries(FINAL)) {
  for (const n of list) (cat === 'team' ? (teams.includes(n) || problems.push(`Endwertung Team: ${n}`)) : need(n, `Endwertung ${cat}`));
}
// Endstand der Gesamtwertung muss zur Startliste passen
GC[21].forEach((n, i) => { if (byName.get(n)?.final !== String(i + 1)) problems.push(`GC-Endstand: ${n} ist laut Startliste ${byName.get(n)?.final}, nicht ${i + 1}`); });
FINAL.gc.forEach((n, i) => { if (GC[21][i] !== n) problems.push(`Endwertung gc ≠ Gesamtwertung nach Etappe 21 (${n})`); });

if (problems.length) {
  console.error('Datenfehler:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}

// ---------- SQL ----------
const parseDur = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const out = [];
const w = (s = '') => out.push(s);

w(`-- =====================================================================
-- Testrunde „Giro d'Italia 2026“ – echte Fahrer, Etappen und Ergebnisse
-- Erzeugt von scripts/giro2026/build-sql.mjs – nicht von Hand bearbeiten.
--
-- Voraussetzung: supabase/schema.sql ist in der aktuellen Version eingespielt.
-- Danach diese Datei komplett im SQL Editor ausführen.
--
-- • 184 Fahrer in 23 Teams mit Startnummer, Nation, Alter, Nachwuchs-Status
-- • 21 Etappen, ab morgen eine pro Tag, Start jeweils 12:00 Uhr
--   (mit echten Anstiegen, Kategorien, Zwischensprints, Höhenmetern)
-- • Das echte Ergebnis (Top 10) erscheint etwa zur echten Zielankunft:
--   Start + Siegerzeit + 15 Minuten (Zeitfahren: nach 4 Stunden)
-- • Ausstiege passieren wie im echten Rennen
-- • Bonuswertungen: Zwischenstand nach jeder Etappe (Gesamt, Best of the Rest,
--   Nachwuchs), nach Etappe 21 der echte Endstand aller Wertungen
--
-- Die alte Testrunde (Köln–Dortmund) wird dabei gelöscht.
-- Automatik beenden:  select cron.unschedule('giro2026-replay');
-- Sofort prüfen:      select public.replay_giro2026();
-- =====================================================================

begin;

-- Passt das Schema? (sonst zuerst supabase/schema.sql neu ausführen)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stages' and column_name = 'climbs')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'riders' and column_name = 'nationality')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tours' and column_name = 'tip_limit') then
    raise exception 'Bitte zuerst supabase/schema.sql (aktuelle Version) im SQL Editor ausführen.';
  end if;
end $$;

-- Alte Testrunde entfernen
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('testrunde-ergebnisse', 'giro2026-replay');
  end if;
end $$;
delete from public.tours where id in ('testrunde', ${q(TOUR)});

-- Rundfahrt: ab morgen, 21 Tage
insert into public.tours (id, name, short_name, theme, year, start_date, end_date, is_visible, pcs_slug, tip_limit, info)
values (${q(TOUR)}, 'Giro d''Italia 2026 · Testrunde', 'Giro 26', 'giro',
        extract(year from now())::int,
        (now() at time zone 'Europe/Berlin')::date + 1,
        (now() at time zone 'Europe/Berlin')::date + 21,
        true, 'giro-d-italia/2026', 3, ${q(JSON.stringify(REGULATIONS))}::jsonb);
`);

w('-- Etappen');
w('insert into public.stages (tour_id, number, starts_at, kind, departure, arrival, distance_km, elevation_m, climbs, sprints, info) values');
w(STAGES.map((s) => {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
  const climbs = JSON.stringify(s.climbs.map((c) => pick(c, ['name', 'cat', 'km', 'len', 'grad', 'max', 'alt'])));
  const info = JSON.stringify(pick({
    original_date: s.date, start_real: s.info?.start, finish_real: s.info?.finish,
    neutral_km: s.neutral, three_sec: s.threeSec,
  }, ['original_date', 'start_real', 'finish_real', 'neutral_km', 'three_sec']));
  const sprints = JSON.stringify((s.sprints ?? []).map((x) => ({ km: x.km, ...(x.name ? { name: x.name } : {}) })));
  const start = `((((now() at time zone 'Europe/Berlin')::date + ${s.n})::timestamp + time '12:00') at time zone 'Europe/Berlin')`;
  return `  (${q(TOUR)}, ${s.n}, ${start}, ${q(s.kind)}, ${q(s.from)}, ${q(s.to)}, ${s.km}, ${s.elevation ?? 'null'}, ${q(climbs)}::jsonb, ${q(sprints)}::jsonb, ${q(info)}::jsonb)`;
}).join(',\n') + ';');
w();

w('-- Startliste (184 Fahrer)');
w('insert into public.riders (tour_id, bib, name, team, nationality, age, young, excluded_from_rest) values');
w(riders.map((r) => `  (${q(TOUR)}, ${r.bib}, ${q(r.name)}, ${q(r.team)}, ${q(r.nat)}, ${r.age}, ${r.young}, ${EXCLUDED_FROM_REST.includes(r.name)})`).join(',\n') + ';');
w();

w(`-- ---------------------------------------------------------------------
-- Versteckte Daten für das Nachspielen (für die App nicht lesbar)
-- ---------------------------------------------------------------------
create table if not exists public.replay_stage (
  tour_id text not null, number int not null, reveal_after interval not null,
  primary key (tour_id, number));
create table if not exists public.replay_result (
  tour_id text not null, number int not null, kind text not null, position int not null, rider text not null,
  primary key (tour_id, number, kind, position));
create table if not exists public.replay_out (
  tour_id text not null, after_stage int not null, rider text not null);
create table if not exists public.replay_final (
  tour_id text not null, category text not null, position int not null, rider text, team text);
alter table public.replay_stage  enable row level security;
alter table public.replay_result enable row level security;
alter table public.replay_out    enable row level security;
alter table public.replay_final  enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.replay_stage, public.replay_result, public.replay_out, public.replay_final from anon, authenticated';
  end if;
end $$;
delete from public.replay_stage  where tour_id = ${q(TOUR)};
delete from public.replay_result where tour_id = ${q(TOUR)};
delete from public.replay_out    where tour_id = ${q(TOUR)};
delete from public.replay_final  where tour_id = ${q(TOUR)};
`);

w('insert into public.replay_stage (tour_id, number, reveal_after) values');
w(STAGES.map((s) => {
  const secs = s.reveal ? parseDur(s.reveal) : parseDur(s.time) + 15 * 60;
  return `  (${q(TOUR)}, ${s.n}, interval '${secs} seconds')`;
}).join(',\n') + ';');
w();
w('insert into public.replay_result (tour_id, number, kind, position, rider) values');
const rr = [];
for (const s of STAGES) {
  RESULTS[s.n].forEach((n, i) => rr.push(`  (${q(TOUR)}, ${s.n}, 'stage', ${i + 1}, ${q(n)})`));
  GC[s.n].forEach((n, i) => rr.push(`  (${q(TOUR)}, ${s.n}, 'gc', ${i + 1}, ${q(n)})`));
}
w(rr.join(',\n') + ';');
w();
w('insert into public.replay_out (tour_id, after_stage, rider) values');
w([...outAfter.entries()].sort((a, b) => a[1] - b[1]).map(([n, s]) => `  (${q(TOUR)}, ${s}, ${q(n)})`).join(',\n') + ';');
w();
w('insert into public.replay_final (tour_id, category, position, rider, team) values');
const fr = [];
for (const [cat, list] of Object.entries(FINAL)) {
  list.forEach((n, i) => fr.push(`  (${q(TOUR)}, ${q(cat)}, ${i + 1}, ${cat === 'team' ? 'null' : q(n)}, ${cat === 'team' ? q(n) : 'null'})`));
}
w(fr.join(',\n') + ';');
w();

w(`-- ---------------------------------------------------------------------
-- Nachspielen: veröffentlicht fällige Etappen mit dem echten Ergebnis
-- ---------------------------------------------------------------------
create or replace function public.replay_giro2026()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tour  text := ${q(TOUR)};
  v_stage record;
  v_count int := 0;
  v_last  int;
begin
  for v_stage in
    select s.id, s.number from stages s join replay_stage rs on rs.tour_id = s.tour_id and rs.number = s.number
     where s.tour_id = v_tour and not s.results_published and s.starts_at + rs.reveal_after <= now()
     order by s.number
  loop
    delete from stage_results where stage_id = v_stage.id;
    insert into stage_results (stage_id, position, rider_id)
    select v_stage.id, x.position, r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'stage';
    delete from stage_standings where stage_id = v_stage.id;
    insert into stage_standings (stage_id, category, position, rider_id)
    select v_stage.id, 'gc', x.position, r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc';
    update stages set results_published = true where id = v_stage.id;

    -- Ausstiege wie im echten Rennen
    update riders r set status = 'out'
      from replay_out o
     where o.tour_id = v_tour and o.after_stage = v_stage.number and r.tour_id = v_tour and r.name = o.rider;

    -- Zwischenstand der Bonuswertungen aus der Gesamtwertung nach dieser Etappe
    delete from bonus_results where tour_id = v_tour;
    insert into bonus_results (tour_id, category, position, rider_id)
    select v_tour, 'gc', x.position, r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc' and x.position <= 3;
    insert into bonus_results (tour_id, category, position, rider_id)
    select v_tour, 'rest', row_number() over (order by x.position), r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc' and not r.excluded_from_rest
     order by x.position limit 3;
    insert into bonus_results (tour_id, category, position, rider_id)
    select v_tour, 'youth', row_number() over (order by x.position), r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc' and r.young
     order by x.position limit 3;

    v_count := v_count + 1;
  end loop;

  -- Nach der letzten Etappe: echter Endstand aller Wertungen
  select max(number) into v_last from stages where tour_id = v_tour;
  if v_count > 0 and not exists (select 1 from stages where tour_id = v_tour and not results_published) then
    delete from bonus_results where tour_id = v_tour;
    insert into bonus_results (tour_id, category, position, rider_id, team)
    select v_tour, f.category, f.position, r.id, f.team
      from replay_final f left join riders r on r.tour_id = v_tour and r.name = f.rider
     where f.tour_id = v_tour;
    update tours set bonus_final = true where id = v_tour;
  end if;

  return v_count;
end;
$fn$;

revoke all on function public.replay_giro2026() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.replay_giro2026() from anon, authenticated';
  end if;
end $$;

commit;

-- Automatik: alle 5 Minuten prüfen (pg_cron ist bei Supabase dabei)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('giro2026-replay', '*/5 * * * *', 'select public.replay_giro2026()');
    raise notice 'Giro 2026 Testrunde angelegt – Ergebnisse kommen etwa zur echten Zielankunft.';
  else
    raise notice 'pg_cron nicht verfügbar – Ergebnisse mit select public.replay_giro2026(); auslösen.';
  end if;
end $$;
`);

writeFileSync(join(root, 'supabase', 'seed_giro2026.sql'), out.join('\n'));
const climbs = STAGES.reduce((n, s) => n + s.climbs.length, 0);
console.log(`seed_giro2026.sql: ${riders.length} Fahrer, ${teams.length} Teams, ${STAGES.length} Etappen, ${climbs} Bergwertungen, ${outAfter.size} Ausstiege`);
