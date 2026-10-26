import { source } from '../../app/config';
import { invalidate, useQuery } from '../../app/query';
import { useNow, useTourData } from '../../app/hooks';
import type { Stage, StageSyncInfo, SyncLogEntry, SyncMode, Tour } from '../../lib/types';
import { fmtDay, fmtTime, sortStages } from '../../lib/time';
import { Icon, type IconName } from '../../ui/Icon';
import { Button, ErrorBox, Link, Loading, Notice, Segmented, cx, toast, useAction, useTitle } from '../../ui/kit';
import { AdminPage, ExternalLink, pcsUrl } from './common';

const MODES: { value: SyncMode; label: string }[] = [
  { value: 'off', label: 'Aus' },
  { value: 'draft', label: 'Vorschlag' },
  { value: 'auto', label: 'Automatisch' },
];

const MODE_HINT: Record<SyncMode, string> = {
  off: 'Ergebnisse trägst du unter „Etappenergebnis“ selbst ein.',
  draft: 'Das Ergebnis wird eingetragen, du prüfst es unter „Etappenergebnis“ und veröffentlichst es selbst. Ausstiege, Wertungsstände und Streckenänderungen kommen automatisch.',
  auto: 'Etwa 10 bis 20 Minuten nach der Zielankunft ist das Ergebnis veröffentlicht – samt Ausstiegen, Wertungsständen und Bonus-Zwischenstand. Korrekturen der Jury bis zum nächsten Tag werden nachgezogen.',
};

export const SYNC_MODE_LABEL: Record<SyncMode, string> = { off: 'aus', draft: 'als Vorschlag', auto: 'automatisch' };

const LEVEL_ICON: Record<SyncLogEntry['level'], IconName> = { info: 'clock', change: 'check', warning: 'info', error: 'x' };

export function AdminSync() {
  useTitle('Automatische Ergebnisse');
  return <AdminPage title="Automatische Ergebnisse">{(tour) => <SyncEditor tour={tour} />}</AdminPage>;
}

function SyncEditor({ tour }: { tour: Tour }) {
  const q = useTourData(tour);
  const now = useNow(30000);
  const stages = q.data ? sortStages(q.data.stages) : [];
  const ids = stages.map((s) => s.id);
  const status = useQuery(q.data ? `sync:${tour.id}:${ids.join(',')}` : null, () => source.loadSyncStatus(tour.id, ids));
  const change = useAction();
  const mode: SyncMode = tour.sync_mode ?? 'off';

  const setMode = (next: SyncMode) => change.run(async () => {
    if (next === mode) return;
    await source.setSyncMode(tour.id, next);
    invalidate('tours');
    invalidate(`tour:${tour.id}`);
    invalidate(`sync:${tour.id}`);
    toast(next === 'off' ? 'Automatik ausgeschaltet' : `Automatik: ${SYNC_MODE_LABEL[next]}`);
  });

  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  const url = pcsUrl(tour);
  const byStage = new Map((status.data?.stages ?? []).map((s) => [s.stage_id, s]));
  // neueste zuerst: was gerade läuft oder bevorsteht, steht oben
  const listed = stages.filter((s) => byStage.has(s.id)).reverse();

  return (
    <>
      <section className="card">
        <h2 className="card__h">Ergebnisse von procyclingstats.com</h2>
        <Segmented label="Automatik" options={MODES} value={mode} onChange={setMode} />
        <p className="hint">{MODE_HINT[mode]}</p>
        {change.error ? <ErrorBox error={change.error} /> : null}
        {!tour.pcs_slug ? (
          <Notice tone="error">Ohne PCS-Kürzel kann die Automatik nichts abrufen. Trag es unter <Link to="/admin/rundfahrten">Rundfahrten</Link> ein, z.&nbsp;B. <code>giro-d-italia/2027</code>.</Notice>
        ) : url ? (
          <ExternalLink href={url}>Rundfahrt auf procyclingstats.com</ExternalLink>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card__h">Etappen</h2>
        {status.error ? <ErrorBox error={status.error} onRetry={status.reload} /> : status.loading ? <Loading /> : listed.length ? (
          <ul className="list">
            {listed.map((s) => <SyncStageRow key={s.id} tour={tour} stage={s} info={byStage.get(s.id)!} now={now} />)}
          </ul>
        ) : (
          <p className="muted">
            {mode === 'off'
              ? 'Die Automatik ist aus.'
              : 'Noch nichts abgerufen. Los geht es ab zwei Tage vor dem Start: bevorstehende Etappen werden auf Änderungen geprüft, gestartete auf das Ergebnis.'}
          </p>
        )}
      </section>

      {status.data?.log.length ? (
        <section className="card">
          <h2 className="card__h">Protokoll</h2>
          <ul className="list sync-log">
            {status.data.log.map((l) => (
              <li key={l.id} className={cx('sync-log__item', `sync-log__item--${l.level}`)}>
                <Icon name={LEVEL_ICON[l.level]} size={18} />
                <span className="sync-log__main">
                  <span>{l.message}</span>
                  <span className="muted">{fmtDay(l.at)}, {fmtTime(l.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Notice>
        Der GitHub-Workflow „Ergebnisse“ schaut an Renntagen zwischen 13 und 22 Uhr alle 10 Minuten nach, dazu morgens und vor dem Tippschluss.
        Ein Ergebnis wird erst übernommen, wenn es nach der Zielankunft vollständig ist und 10 Minuten unverändert bleibt.
        Änderst du ein Ergebnis von Hand oder ziehst die Veröffentlichung zurück, pausiert die Automatik für diese Etappe.
      </Notice>
    </>
  );
}

/** Uhrzeit, mit Tag davor wenn nicht heute */
function when(iso: string, now: number): string {
  return fmtDay(iso) === fmtDay(new Date(now)) ? fmtTime(iso) : `${fmtDay(iso)} ${fmtTime(iso)}`;
}

/** Bis so lange nach dem Start kontrolliert die Automatik eine veröffentlichte Etappe nach */
const RECHECK_MS = 36 * 3_600_000;

function SyncStageRow({ tour, stage, info, now }: { tour: Tour; stage: Stage; info: StageSyncInfo; now: number }) {
  const act = useAction();
  const toggle = () => act.run(async () => {
    await source.setStageSyncPaused(stage.id, !info.paused);
    invalidate(`sync:${tour.id}`);
    toast(info.paused ? `Etappe\u00a0${stage.number}: Automatik fortgesetzt` : `Etappe\u00a0${stage.number}: Automatik angehalten`);
  });
  const start = new Date(stage.starts_at).getTime();
  // abgeschlossen: veröffentlicht und die Nachkontrolle ist vorbei – dann gibt es nichts mehr anzuhalten
  const finished = stage.results_published && now - start > RECHECK_MS;
  const details = [
    info.paused ? info.paused_reason : info.status ?? (start <= now ? 'gestartet' : 'bevorstehend'),
    info.synced_at ? `übernommen ${when(info.synced_at, now)}` : null,
    info.checked_at && !finished ? `geprüft ${when(info.checked_at, now)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="sync-stage">
      <span className="admin-stage__num">{stage.number}</span>
      <span className="admin-stage__main">
        <strong>Etappe&nbsp;{stage.number} · {fmtDay(stage.starts_at)}{info.paused ? ' · pausiert' : ''}</strong>
        <span className="muted">{details}</span>
        {info.last_error && !info.paused ? <span className="sync-stage__error">{info.last_error}</span> : null}
        {act.error ? <ErrorBox error={act.error} /> : null}
      </span>
      {finished && !info.paused ? null : (
        <Button variant={info.paused ? 'primary' : 'ghost'} size="sm" onClick={toggle} busy={act.busy}>
          {info.paused ? 'Fortsetzen' : 'Anhalten'}
        </Button>
      )}
    </li>
  );
}
