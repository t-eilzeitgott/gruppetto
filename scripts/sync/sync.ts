// Ablauf eines Sync-Laufs: aktive Rundfahrten finden, fällige Etappenseiten bei PCS abrufen,
// je Etappe planen (plan.ts) und – außer im Probelauf – in die Datenbank schreiben.
import { PcsError, parseStagePage, stagePath, PCS_BASE, type PcsStage } from './pcs.ts';
import {
  planBonus, planStartedStage, planUpcomingStage, DEFAULT_OPTIONS,
  type LogEntry, type StagePlan, type SyncMode, type SyncStage, type SyncTour,
} from './plan.ts';
import type { SyncStore, TourState } from './store.ts';
import { berlinDate, fmtWhen, hours, minutes } from './time.ts';

export interface RunOptions {
  now: Date;
  dryRun: boolean;
  /** nur diese Rundfahrt (dann auch außerhalb ihres Zeitraums und mit Modus „aus“, siehe mode) */
  tourId?: string;
  /** nur diese Etappe (wird immer abgerufen) */
  stage?: number;
  /** Modus für diesen Lauf überschreiben (z. B. Probelauf einer Rundfahrt mit Automatik „aus“) */
  mode?: Exclude<SyncMode, 'off'>;
  force: boolean;
  stableMinutes: number;
  /** Anteil der Starter, die im Ergebnis stehen müssen */
  completeness: number;
  /** höchstens so viele PCS-Seiten pro Lauf */
  maxFetch: number;
  /** so lange nach dem Start werden veröffentlichte Etappen nachkontrolliert */
  recheckHours: number;
  /** veröffentlichte Etappen höchstens so oft abrufen */
  recheckEveryMinutes: number;
  /** so weit im Voraus werden Etappen auf Änderungen geprüft */
  upcomingHours: number;
  upcomingEveryHours: number;
  /** Pause zwischen zwei Abrufen bei PCS */
  delayMs: number;
}

export const DEFAULT_RUN: Omit<RunOptions, 'now' | 'dryRun'> = {
  force: false,
  stableMinutes: DEFAULT_OPTIONS.stableMinutes,
  completeness: DEFAULT_OPTIONS.completeness,
  maxFetch: 6,
  recheckHours: 36,
  recheckEveryMinutes: 30,
  upcomingHours: 36,
  upcomingEveryHours: 3,
  delayMs: 1500,
};

export interface StageReport {
  number: number;
  status: string;
  actions: string[];
  url?: string;
}

export interface TourReport {
  tour: SyncTour;
  mode: SyncMode;
  skipped?: string;
  stages: StageReport[];
  logs: LogEntry[];
}

export interface RunReport {
  tours: TourReport[];
  newErrors: number;
  fetched: number;
}

export interface Deps {
  store: SyncStore;
  fetchPage: (path: string) => Promise<string>;
  /** abgerufene Seiten aufbewahren (Workflow-Artefakt, neue Test-Fixtures) */
  savePage?: (path: string, html: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function dueStages(state: TourState, opts: RunOptions): { stage: SyncStage; kind: 'started' | 'upcoming'; prio: number }[] {
  const now = opts.now.getTime();
  const out: { stage: SyncStage; kind: 'started' | 'upcoming'; prio: number }[] = [];
  for (const stage of state.stages) {
    if (opts.stage !== undefined && stage.number !== opts.stage) continue;
    const sync = state.sync.find((s) => s.stage_id === stage.id);
    if (sync?.paused) continue;
    const starts = new Date(stage.starts_at).getTime();
    const checked = sync?.checked_at ? new Date(sync.checked_at).getTime() : 0;
    const explicit = opts.stage !== undefined;
    if (starts <= now) {
      if (!stage.results_published) out.push({ stage, kind: 'started', prio: 0 });
      else if (explicit || (now - starts <= hours(opts.recheckHours) && now - checked >= minutes(opts.recheckEveryMinutes))) {
        out.push({ stage, kind: 'started', prio: 1 });
      }
    } else if (explicit || (starts - now <= hours(opts.upcomingHours) && now - checked >= hours(opts.upcomingEveryHours))) {
      out.push({ stage, kind: 'upcoming', prio: 2 });
    }
  }
  return out.sort((a, b) => a.prio - b.prio || a.stage.number - b.stage.number);
}

export async function runSync(opts: RunOptions, deps: Deps): Promise<RunReport> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const report: RunReport = { tours: [], newErrors: 0, fetched: 0 };
  const today = berlinDate(opts.now);
  const tours = await deps.store.listTours({ tourId: opts.tourId });
  if (opts.tourId && !tours.length) throw new Error(`Rundfahrt „${opts.tourId}“ nicht gefunden`);

  for (const tour of tours) {
    const mode: SyncMode = opts.mode ?? tour.sync_mode;
    const tr: TourReport = { tour, mode, stages: [], logs: [] };
    report.tours.push(tr);
    if (mode === 'off') {
      tr.skipped = 'Automatik ist aus';
      continue;
    }
    if (!opts.tourId && (today < addDays(tour.start_date, -2) || today > addDays(tour.end_date, 2))) {
      tr.skipped = `außerhalb des Zeitraums (${tour.start_date} bis ${tour.end_date})`;
      continue;
    }
    const state = await deps.store.loadTourState(tour, new Date(opts.now.getTime() - hours(12)));
    const recentTour = new Set(state.recentLogs.filter((l) => l.stage_id === null).map((l) => l.message));
    const tourLog = async (entry: LogEntry) => {
      if ((entry.level === 'warning' || entry.level === 'error') && recentTour.has(entry.message)) return;
      recentTour.add(entry.message);
      tr.logs.push(entry);
      if (entry.level === 'error') report.newErrors += 1;
      if (!opts.dryRun) await deps.store.logTour(tour.id, entry);
    };
    if (!tour.pcs_slug) {
      await tourLog({ level: 'warning', message: `${tour.name}: Kein PCS-Kürzel hinterlegt (Admin → Rundfahrten), Automatik kann nichts abrufen.` });
      tr.skipped = 'kein PCS-Kürzel';
      continue;
    }

    const due = dueStages(state, opts);
    for (const s of state.stages) {
      const sync = state.sync.find((x) => x.stage_id === s.id);
      if (sync?.paused && (opts.stage === undefined || opts.stage === s.number)) {
        tr.stages.push({ number: s.number, status: 'pausiert', actions: [`pausiert (${sync.paused_reason ?? 'von Hand'})`] });
      }
    }
    if (due.length > opts.maxFetch) {
      tr.logs.push({ level: 'info', message: `${due.length - opts.maxFetch} Etappe(n) erst im nächsten Lauf (höchstens ${opts.maxFetch} Abrufe pro Lauf)` });
    }

    const plans: { stage: SyncStage; plan: StagePlan; pcs: PcsStage | null }[] = [];
    let blocked = false;
    for (const { stage, kind } of due.slice(0, opts.maxFetch)) {
      const recent = new Set(state.recentLogs.filter((l) => l.stage_id === stage.id).map((l) => l.message));
      const sync = state.sync.find((x) => x.stage_id === stage.id) ?? null;
      const path = stagePath(tour.pcs_slug, stage.number, stage.info?.pcs_path);
      const url = `${PCS_BASE}/${path}`;
      if (blocked) break;
      if (report.fetched) await sleep(opts.delayMs);
      let pcs: PcsStage;
      try {
        report.fetched += 1;
        const html = await deps.fetchPage(path);
        await deps.savePage?.(path, html);
        pcs = parseStagePage(html);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof PcsError && err.blocked) {
          blocked = true;
          await tourLog({ level: 'error', message: `${message}. Ergebnisse bitte vorerst von Hand eintragen.` });
          tr.stages.push({ number: stage.number, status: 'PCS blockiert', actions: [message], url });
          break;
        }
        const upcoming404 = kind === 'upcoming' && err instanceof PcsError && err.status === 404;
        const msg = `Etappe ${stage.number}: ${message}`;
        const isNew = !upcoming404 && !recent.has(msg);
        const plan: StagePlan = {
          payload: {
            state: { checked_at: opts.now.toISOString(), status: upcoming404 ? 'PCS-Seite gibt es noch nicht' : 'Abruf fehlgeschlagen', source_url: url, last_error: upcoming404 ? null : msg },
            logs: isNew ? [{ level: 'warning', message: msg }] : [],
          },
          actions: [upcoming404 ? 'PCS-Seite gibt es noch nicht' : `Abruf fehlgeschlagen: ${message}`],
          newErrors: 0,
          published: stage.results_published,
        };
        plans.push({ stage, plan, pcs: null });
        continue;
      }

      const plan = kind === 'started'
        ? planStartedStage({
          now: opts.now,
          tour: { ...tour, sync_mode: mode },
          stage,
          riders: state.riders,
          results: state.results.filter((r) => r.stage_id === stage.id),
          standings: state.standings.filter((r) => r.stage_id === stage.id),
          sync,
          pcs,
          url,
          recent,
          options: { force: opts.force, stableMinutes: opts.stableMinutes, completeness: opts.completeness },
        })
        : planUpcomingStage({ now: opts.now, tour, stage, pcs, url, recent });
      plans.push({ stage, plan, pcs });
    }

    // Bonus-Zwischenstand aus der letzten veröffentlichten Etappe, wenn sie in diesem Lauf gelesen wurde
    const publishedNumbers = state.stages
      .filter((s) => new Date(s.starts_at) <= opts.now)
      .filter((s) => (plans.find((p) => p.stage.id === s.id)?.plan.published ?? s.results_published))
      .map((s) => s.number);
    const latest = publishedNumbers.length ? Math.max(...publishedNumbers) : null;
    const latestPlan = plans.find((p) => p.stage.number === latest && p.pcs);
    if (latestPlan?.pcs && latestPlan.plan.payload.state.status !== 'pausiert') {
      const recent = new Set(state.recentLogs.filter((l) => l.stage_id === latestPlan.stage.id).map((l) => l.message));
      const b = planBonus({ tour, stageNumber: latestPlan.stage.number, riders: state.riders, current: state.bonus, pcs: latestPlan.pcs, recent });
      if (b.bonus) latestPlan.plan.payload.bonus = b.bonus;
      latestPlan.plan.payload.logs.push(...b.logs);
      latestPlan.plan.actions.push(...b.actions);
      const last = Math.max(...state.stages.map((s) => s.number));
      if (latest === last && !latestPlan.stage.results_published && latestPlan.plan.published) {
        latestPlan.plan.payload.logs.push({
          level: 'info',
          message: 'Letzte Etappe übernommen – bitte unter Bonuswertungen den Kämpferischsten Fahrer eintragen, alles prüfen und den Endstand setzen.',
        });
        latestPlan.plan.actions.push('Letzte Etappe: Endstand bitte von Hand setzen');
      }
    }

    for (const { stage, plan } of plans) {
      report.newErrors += plan.newErrors;
      tr.logs.push(...plan.payload.logs);
      const entry: StageReport = { number: stage.number, status: plan.payload.state.status, actions: [...plan.actions], url: plan.payload.state.source_url };
      if (!opts.dryRun) {
        const res = await deps.store.applyStage(stage.id, plan.payload);
        if (res.paused && res.skipped.includes('results')) entry.actions.push('inzwischen von Hand pausiert – nichts überschrieben');
      }
      tr.stages.push(entry);
    }
    tr.stages.sort((a, b) => a.number - b.number);
  }
  return report;
}

/** Zusammenfassung als Markdown (GitHub-Job-Zusammenfassung und Konsole). */
export function formatReport(report: RunReport, opts: Pick<RunOptions, 'now' | 'dryRun'>): string {
  const lines: string[] = [];
  lines.push(`## Ergebnisse ${opts.dryRun ? '– Probelauf (nichts gespeichert)' : ''}`.trim());
  lines.push('');
  lines.push(`Stand ${fmtWhen(opts.now, opts.now)} Uhr (${berlinDate(opts.now)}) · ${report.fetched} Seite(n) bei procyclingstats.com abgerufen`);
  if (!report.tours.length) lines.push('', 'Keine Rundfahrt mit eingeschalteter Automatik.');
  for (const t of report.tours) {
    const mode = t.mode === 'auto' ? 'automatisch veröffentlichen' : t.mode === 'draft' ? 'als Vorschlag eintragen' : 'aus';
    lines.push('', `### ${t.tour.name} (${mode})`);
    if (t.skipped) {
      lines.push('', `Übersprungen: ${t.skipped}`);
    } else if (!t.stages.length) {
      lines.push('', 'Gerade nichts zu tun.');
    } else {
      lines.push('', '| Etappe | Stand | Was passiert |', '| --- | --- | --- |');
      for (const s of t.stages) {
        const nr = s.url ? `[${s.number}](${s.url})` : String(s.number);
        lines.push(`| ${nr} | ${s.status.replace(/\|/g, '/')} | ${s.actions.join('<br>').replace(/\|/g, '/')} |`);
      }
    }
    const notable = t.logs.filter((l) => l.level !== 'info');
    if (notable.length) {
      lines.push('');
      for (const l of notable) lines.push(`- ${l.level === 'error' ? '❌' : l.level === 'warning' ? '⚠️' : '✅'} ${l.message}`);
    }
  }
  return lines.join('\n');
}
