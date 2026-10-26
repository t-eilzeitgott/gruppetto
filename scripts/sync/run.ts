// Kommandozeile für den Ergebnis-Sync (läuft im GitHub-Workflow „Ergebnisse“ oder lokal).
//
//   node scripts/sync/run.ts                  echter Lauf (SUPABASE_URL + SUPABASE_SECRET_KEY nötig)
//   node scripts/sync/run.ts --probelauf      alles lesen und planen, nichts speichern
//   node scripts/sync/run.ts --probelauf --tour giro-2027 --etappe 7 --sofort --modus auto
//   node scripts/sync/run.ts --pcs race/giro-d-italia/2026/stage-7     nur PCS abrufen und anzeigen (ohne Datenbank)
//   node scripts/sync/run.ts --datei seite.html                         gespeicherte Seite auslesen
//
// Weitere Schalter: --jetzt 2027-05-15T17:30 (Uhrzeit simulieren), --seiten-ordner pcs-seiten
// (abgerufene Seiten speichern), --max-abrufe 6, --stabil 10 (Minuten).
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchPcsPage, parseDuration, parseStagePage, type PcsRow, type PcsStage } from './pcs.ts';
import { SupabaseStore } from './store.ts';
import { DEFAULT_RUN, formatReport, runSync, type RunOptions } from './sync.ts';
import { berlinToDate } from './time.ts';

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [key, inline] = a.slice(2).split('=', 2);
    const next = argv[i + 1];
    if (inline !== undefined) flags.set(key, inline);
    else if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else flags.set(key, true);
  }
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = flags.get(k);
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  const bool = (...keys: string[]) => keys.some((k) => {
    const v = flags.get(k);
    return v === true || v === 'true' || v === '1' || v === 'ja';
  });
  return { str, bool };
}

function describeStage(st: PcsStage): string {
  const rows = (list: PcsRow[], n = 10) => list.filter((r) => r.rank !== null).slice(0, n)
    .map((r) => `  ${String(r.rank).padStart(2)}. ${r.name}${r.bib ? ` (${r.bib})` : ''}${r.team ? ` – ${r.team}` : ''}`).join('\n');
  const winner = parseDuration(st.stage.find((r) => r.rank === 1)?.time ?? null);
  const out = st.stage.filter((r) => r.rank === null && !r.removed);
  return [
    `${st.title}`,
    `Typ ${st.type} · ${st.date ?? '?'} · Start ${st.startTime ?? '?'} · ${st.distanceKm ?? '?'} km · ${st.departure ?? '?'} → ${st.arrival ?? '?'} · Profil ${st.profile ?? '?'}`,
    `Reiter: ${st.tabs.join(', ') || 'keine'} · ${st.stage.filter((r) => r.rank !== null).length} klassiert, ${out.length} ausgestiegen${winner ? ` · Siegerzeit ${st.stage[0].time}` : ''}`,
    '',
    'Etappe:', rows(st.stage) || '  (noch kein Ergebnis)',
    '', 'Gesamtwertung:', rows(st.gc, 5) || '  –',
    '', 'Punkte:', rows(st.points, 3) || '  –',
    '', 'Berg:', rows(st.kom, 3) || '  –',
    '', 'Nachwuchs:', rows(st.youth, 3) || '  –',
    '', 'Teams:', st.teams.slice(0, 3).map((t) => `  ${t.rank}. ${t.team}`).join('\n') || '  –',
    out.length ? `\nAusgestiegen: ${out.map((r) => `${r.name} (${r.status})`).join(', ')}` : '',
  ].join('\n');
}

async function summary(markdown: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, `${markdown}\n`);
}

async function main() {
  const { str, bool } = parseArgs(process.argv.slice(2));

  // Nur PCS: Erreichbarkeit und Parser prüfen
  const pcsPath = str('pcs', 'smoke');
  const file = str('datei', 'file');
  if (pcsPath || file) {
    const html = file ? await readFile(file, 'utf8') : await fetchPcsPage(pcsPath!);
    const st = parseStagePage(html);
    const text = describeStage(st);
    console.log(text);
    await summary(`## PCS-Test: ${pcsPath ?? file}\n\n\`\`\`\n${text}\n\`\`\``);
    const minRows = Number(str('mindestens') ?? 0);
    if (minRows && st.stage.filter((r) => r.rank !== null).length < minRows) {
      console.error(`\nFEHLER: weniger als ${minRows} klassierte Fahrer gelesen – hat PCS den Seitenaufbau geändert?`);
      process.exitCode = 1;
    }
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const msg = 'SUPABASE_URL und SUPABASE_SECRET_KEY fehlen – nichts zu tun. (Secret Key in GitHub unter Settings → Secrets and variables → Actions → Secrets anlegen.)';
    console.log(msg);
    await summary(`## Ergebnisse\n\n${msg}`);
    return;
  }

  const nowArg = str('jetzt', 'now');
  let now = new Date();
  if (nowArg) {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})$/.exec(nowArg);
    now = m ? berlinToDate(m[1], m[2]) : new Date(nowArg);
    if (Number.isNaN(now.getTime())) throw new Error(`Ungültige Zeit: ${nowArg}`);
  }
  const stageArg = str('etappe', 'stage');
  const modeArg = str('modus', 'mode');
  if (modeArg && modeArg !== 'auto' && modeArg !== 'draft') throw new Error('--modus muss auto oder draft sein');
  const opts: RunOptions = {
    ...DEFAULT_RUN,
    now,
    dryRun: bool('probelauf', 'dry-run'),
    tourId: str('tour', 'rundfahrt'),
    stage: stageArg ? Number(stageArg) : undefined,
    mode: modeArg as RunOptions['mode'],
    force: bool('sofort', 'force'),
    stableMinutes: Number(str('stabil') ?? DEFAULT_RUN.stableMinutes),
    maxFetch: Number(str('max-abrufe') ?? DEFAULT_RUN.maxFetch),
  };
  if (opts.mode && !opts.dryRun && !opts.tourId) throw new Error('--modus geht im echten Lauf nur zusammen mit --tour');
  if (opts.stage !== undefined && !opts.tourId) throw new Error('--etappe geht nur zusammen mit --tour');

  const pagesDir = str('seiten-ordner');
  if (pagesDir) await mkdir(pagesDir, { recursive: true });
  const report = await runSync(opts, {
    store: new SupabaseStore(url, key),
    fetchPage: (path) => fetchPcsPage(path),
    savePage: pagesDir ? (path, html) => writeFile(join(pagesDir, `${path.replace(/[^a-z0-9-]+/gi, '_')}.html`), html) : undefined,
  });
  const md = formatReport(report, opts);
  console.log(md);
  await summary(md);
  if (report.newErrors) {
    console.error(`\n${report.newErrors} neue(r) Fehler – siehe oben. Der Lauf wird als fehlgeschlagen markiert, damit GitHub benachrichtigt.`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FEHLER: ${msg}`);
  await summary(`## Ergebnisse\n\n❌ ${msg}`).catch(() => undefined);
  process.exitCode = 1;
});
