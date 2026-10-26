// Erzeugt supabase/seed_2027.sql aus src/data/season2027.ts.
// Aufruf: node scripts/season2027/build-sql.ts   (prüft die Daten vorher auf Widersprüche)
import { writeFileSync } from 'node:fs';
import { SEASON_2027, profilePoints, type SeasonStage, type SeasonTour } from '../../src/data/season2027.ts';

const q = (s: string | null | undefined) => (s === null || s === undefined ? 'null' : `'${s.replace(/'/g, "''")}'`);
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const num = (v: number | null | undefined) => (v === null || v === undefined ? 'null' : String(v));

// ---------- Prüfungen ----------
const problems: string[] = [];
for (const t of SEASON_2027) {
  const numbers = t.stages.map((s) => s.n);
  if (numbers.some((n, i) => n !== i + 1)) problems.push(`${t.id}: Etappennummern nicht lückenlos ab 1`);
  let lastDate = '';
  for (const s of t.stages) {
    const where = `${t.id} Etappe ${s.n}`;
    if (s.date <= lastDate) problems.push(`${where}: Datum ${s.date} nicht nach der Vorgängeretappe`);
    lastDate = s.date;
    const wps = s.waypoints ?? [];
    if (wps.length) {
      if (wps[0].km !== 0) problems.push(`${where}: Profil beginnt nicht bei km 0`);
      if (s.km !== null && wps[wps.length - 1].km !== s.km) problems.push(`${where}: Profil endet bei km ${wps[wps.length - 1].km}, Etappe hat ${s.km} km`);
      wps.forEach((w, i) => {
        if (i && w.km <= wps[i - 1].km) problems.push(`${where}: km ${w.km} (${w.name}) nicht aufsteigend`);
        if (w.alt < 0 || w.alt > 3000) problems.push(`${where}: Höhe ${w.alt} m bei ${w.name} unplausibel`);
      });
    }
    for (const c of s.climbs ?? []) {
      if (s.km !== null && (c.km <= 0 || c.km > s.km)) problems.push(`${where}: Anstieg ${c.name} bei km ${c.km} außerhalb der Etappe`);
      if (c.len !== undefined && c.grad !== undefined && c.alt !== undefined && c.len * c.grad * 10 > c.alt) {
        problems.push(`${where}: ${c.name} – Länge × Steigung ergibt mehr Höhenmeter als die Gipfelhöhe`);
      }
      if (c.max !== undefined && c.grad !== undefined && c.max < c.grad) problems.push(`${where}: ${c.name} – Maximalsteigung unter dem Schnitt`);
    }
  }
}
if (problems.length) {
  console.error(`Widersprüche in den Daten:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

// ---------- SQL ----------
const out: string[] = [];
const w = (line = '') => out.push(line);
const startsAt = (date: string) => `(('${date}'::date + time '12:00') at time zone 'Europe/Berlin')`;

w('-- =====================================================================');
w('-- Saison 2027 – alles, was bisher zu Giro, Tour und Vuelta feststeht');
w('-- Erzeugt von scripts/season2027/build-sql.ts aus src/data/season2027.ts –');
w('-- nicht von Hand bearbeiten, sondern dort ändern und neu erzeugen.');
w('--');
for (const t of SEASON_2027) w(`-- • ${t.name}: ${t.stages.length ? `${t.stages.length} Etappen` : 'noch keine Etappen'} – ${t.source}`);
w('--');
w('-- Wiederholbar. Aktualisiert Zeitraum, Reglement, Strecken und Höhenprofile.');
w('-- Bleibt unberührt: veröffentlichte Etappen, Ergebnisse, Tipps, per GPX hochgeladene');
w('-- Höhenprofile und ein von Hand geänderter Tippschluss am selben Tag.');
w('-- Tippschluss neuer Etappen: 12:00 Uhr deutscher Zeit.');
w('-- =====================================================================');
w();
w('begin;');
w();

const TOUR_META: Record<string, { short: string; theme: string; slug: string; start: string; end: string }> = {
  'giro-2027': { short: 'Giro', theme: 'giro', slug: 'giro-d-italia/2027', start: '2027-05-08', end: '2027-05-30' },
  'tour-2027': { short: 'Tour', theme: 'tour', slug: 'tour-de-france/2027', start: '2027-07-02', end: '2027-07-25' },
  'vuelta-2027': { short: 'Vuelta', theme: 'vuelta', slug: 'vuelta-a-espana/2027', start: '2027-09-04', end: '2027-09-26' },
};

w('-- Rundfahrten (legt sie an, falls schema.sql sie noch nicht eingetragen hat)');
w('insert into public.tours (id, name, short_name, theme, year, start_date, end_date, pcs_slug, info) values');
w(SEASON_2027.map((t) => {
  const m = TOUR_META[t.id];
  return `  (${q(t.id)}, ${q(t.name)}, ${q(m.short)}, ${q(m.theme)}, 2027, '${m.start}', '${m.end}', ${q(m.slug)}, ${json(t.info ?? {})})`;
}).join(',\n'));
w('on conflict (id) do update set');
w('  start_date = excluded.start_date,');
w('  end_date   = excluded.end_date,');
w('  pcs_slug   = coalesce(public.tours.pcs_slug, excluded.pcs_slug),');
w('  info       = public.tours.info || excluded.info;');
w();

function stageRow(t: SeasonTour, s: SeasonStage): string {
  const info: Record<string, unknown> = {};
  if (s.route) info.route = s.route;
  if (s.route && t.routeSource) info.source = t.routeSource;
  return `  (${q(t.id)}, ${s.n}, ${startsAt(s.date)}, ${q(s.kind)}, ${q(s.from)}, ${q(s.to)}, ${num(s.km)}, ${num(s.elevation)}, ${json(s.climbs ?? [])}, ${json(info)})`;
}

for (const t of SEASON_2027.filter((x) => x.stages.length)) {
  w(`-- ${t.name}: Etappen`);
  w('insert into public.stages (tour_id, number, starts_at, kind, departure, arrival, distance_km, elevation_m, climbs, info) values');
  w(t.stages.map((s) => stageRow(t, s)).join(',\n'));
  w('on conflict (tour_id, number) do update set');
  w("  starts_at   = case when (public.stages.starts_at at time zone 'Europe/Berlin')::date = (excluded.starts_at at time zone 'Europe/Berlin')::date");
  w('                     then public.stages.starts_at else excluded.starts_at end,');
  w('  kind        = excluded.kind,');
  w('  departure   = excluded.departure,');
  w('  arrival     = excluded.arrival,');
  w('  distance_km = excluded.distance_km,');
  w('  elevation_m = excluded.elevation_m,');
  w('  climbs      = excluded.climbs,');
  w('  info        = public.stages.info || excluded.info');
  w('  where not public.stages.results_published;');
  w();

  const withProfile = t.stages.filter((s) => (s.waypoints ?? []).length > 1);
  if (withProfile.length) {
    w(`-- ${t.name}: Höhenprofile aus den Durchfahrtsorten der offiziellen Profile`);
    w('insert into public.stage_profiles (stage_id, points, waypoints, source)');
    w(`select s.id, x.points::jsonb, x.waypoints::jsonb, ${q(t.source)} from (values`);
    w(withProfile.map((s) => `  (${s.n}, ${q(JSON.stringify(profilePoints(s)))}, ${q(JSON.stringify(s.waypoints))})`).join(',\n'));
    w(`) as x(number, points, waypoints) join public.stages s on s.tour_id = ${q(t.id)} and s.number = x.number`);
    w('on conflict (stage_id) do update set points = excluded.points, waypoints = excluded.waypoints, updated_at = now()');
    w('  where public.stage_profiles.source = excluded.source;');
    w();
  }
}

w('commit;');
w();
w('-- Kontrolle');
w("select t.id, t.start_date, t.end_date, count(s.id) as etappen, count(p.stage_id) as profile");
w('  from public.tours t left join public.stages s on s.tour_id = t.id left join public.stage_profiles p on p.stage_id = s.id');
w(` where t.id in (${SEASON_2027.map((t) => q(t.id)).join(', ')})`);
w(' group by t.id, t.start_date, t.end_date order by t.start_date;');

const file = new URL('../../supabase/seed_2027.sql', import.meta.url);
writeFileSync(file, `${out.join('\n')}\n`);
const count = SEASON_2027.reduce((n, t) => n + t.stages.length, 0);
console.log(`supabase/seed_2027.sql geschrieben: ${count} Etappen, ${SEASON_2027.flatMap((t) => t.stages).reduce((n, s) => n + (s.climbs?.length ?? 0), 0)} Anstiege.`);
