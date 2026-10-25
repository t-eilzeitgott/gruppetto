import { useEffect, useMemo, useState } from 'react';
import { source } from '../../app/config';
import { invalidate } from '../../app/query';
import { useNow, useTourData } from '../../app/hooks';
import type { Rider, Tour, TourData } from '../../lib/types';
import { parseResults } from '../../lib/pcsParse';
import { fmtDay, sortStages, stageState, fmtClock } from '../../lib/time';
import { Button, ErrorBox, Loading, Notice, toast, useAction, useTitle } from '../../ui/kit';
import { AdminPage, ExternalLink, pcsUrl } from './common';

const SLOTS = 10;

export function AdminResults() {
  useTitle('Etappenergebnis');
  return <AdminPage title="Etappenergebnis">{(tour) => <ResultsEditor tour={tour} />}</AdminPage>;
}

function ResultsEditor({ tour }: { tour: Tour }) {
  const q = useTourData(tour);
  const now = useNow(30000);
  const [stageId, setStageId] = useState<number | null>(null);
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  const stages = sortStages(q.data.stages);
  if (!stages.length) return <Notice>Diese Rundfahrt hat noch keine Etappen.</Notice>;
  const started = stages.filter((s) => stageState(s, now) !== 'open');
  const suggested = started.find((s) => !s.results_published) ?? started[started.length - 1] ?? stages[0];
  const current = stages.find((s) => s.id === stageId) ?? suggested;

  return (
    <>
      <div className="field">
        <label htmlFor="res-stage">Etappe</label>
        <select id="res-stage" value={current.id} onChange={(e) => setStageId(Number((e.target as HTMLSelectElement).value))}>
          {stages.map((s) => {
            const st = stageState(s, now);
            return (
              <option key={s.id} value={s.id}>
                Etappe&nbsp;{s.number} · {fmtDay(s.starts_at)} · {st === 'done' ? 'ausgewertet' : st === 'running' ? 'wartet auf Ergebnis' : 'noch nicht gestartet'}
              </option>
            );
          })}
        </select>
      </div>
      <ResultForm key={current.id} data={q.data} stageId={current.id} now={now} />
    </>
  );
}

function ResultForm({ data, stageId, now }: { data: TourData; stageId: number; now: number }) {
  const stage = data.stages.find((s) => s.id === stageId)!;
  const saved = useMemo(
    () => data.results.filter((r) => r.stage_id === stageId).sort((a, b) => a.position - b.position).map((r) => r.rider_id),
    [data.results, stageId],
  );
  const [slots, setSlots] = useState<(number | null)[]>(() => Array.from({ length: SLOTS }, (_, i) => saved[i] ?? null));
  const [text, setText] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const save = useAction();
  const pub = useAction();
  const st = stageState(stage, now);
  const url = pcsUrl(data.tour, `stage-${stage.number}`);
  const sortedRiders = useMemo(() => [...data.riders].sort((a, b) => a.name.localeCompare(b.name, 'de')), [data.riders]);

  const savedKey = saved.join(',');
  useEffect(() => {
    setSlots(Array.from({ length: SLOTS }, (_, i) => saved[i] ?? null));
    // nur wenn sich das gespeicherte Ergebnis wirklich ändert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const filled = slots.filter((s): s is number => s !== null);
  const duplicates = filled.length !== new Set(filled).size;
  const gaps = slots.findIndex((s) => s === null) !== -1 && slots.slice(slots.findIndex((s) => s === null)).some((s) => s !== null);
  const dirty = JSON.stringify(filled) !== JSON.stringify(saved);

  const recognize = () => {
    const res = parseResults(text, data.riders, SLOTS);
    setSlots(Array.from({ length: SLOTS }, (_, i) => res.riderIds[i] ?? null));
    setUnmatched(res.unmatched.slice(0, 5));
  };

  const onSave = () => save.run(async () => {
    await source.setStageResults(stage.id, filled);
    invalidate(`tour:${data.tour.id}`);
    toast(`Ergebnis Etappe\u00a0${stage.number} gespeichert`);
  });

  const onPublish = (value: boolean) => pub.run(async () => {
    if (value && dirty) await source.setStageResults(stage.id, filled);
    await source.setStagePublished(stage.id, value);
    invalidate(`tour:${data.tour.id}`);
    invalidate('season');
    toast(value ? `Etappe\u00a0${stage.number} veröffentlicht` : 'Veröffentlichung zurückgezogen');
  });

  return (
    <>
      {st === 'open' ? (
        <Notice icon="clock">Die Etappe startet erst {fmtDay(stage.starts_at)} um {fmtClock(stage.starts_at)}. Veröffentlichen geht erst danach.</Notice>
      ) : stage.results_published ? (
        <Notice icon="check" tone="accent">Veröffentlicht – alle sehen die Punkte. Änderungen wirken sofort.</Notice>
      ) : null}

      <section className="card">
        <h2 className="card__title">Ergebnis einfügen</h2>
        <p className="muted">Top 10 von der Ergebnisseite markieren, kopieren und einfügen. Die Fahrer werden über die Namen aus der Startliste erkannt.</p>
        {url ? <ExternalLink href={url}>Etappe&nbsp;{stage.number} auf procyclingstats.com</ExternalLink> : null}
        <div className="field">
          <label htmlFor="res-text">Text einfügen</label>
          <textarea id="res-text" rows={5} value={text} onChange={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder={'1  GROVES Kaden  Alpecin\n2  MILAN Jonathan  Lidl-Trek'} />
        </div>
        <Button variant="secondary" full onClick={recognize} disabled={!text.trim()}>Fahrer erkennen</Button>
        {unmatched.length ? <p className="hint">Nicht erkannt: {unmatched.join(' · ')}</p> : null}
      </section>

      <section className="card">
        <h2 className="card__title">Top {SLOTS}</h2>
        <ol className="slot-list">
          {slots.map((riderId, i) => (
            <li key={i} className="slot">
              <label className="slot__pos" htmlFor={`slot-${i}`}>{i + 1}.</label>
              <select id={`slot-${i}`} value={riderId ?? ''} onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                setSlots((prev) => prev.map((x, k) => (k === i ? (v ? Number(v) : null) : x)));
              }}>
                <option value="">– leer –</option>
                {sortedRiders.map((r: Rider) => <option key={r.id} value={r.id}>{r.name} ({r.team})</option>)}
              </select>
            </li>
          ))}
        </ol>
        {duplicates ? <Notice tone="error">Ein Fahrer steht doppelt in der Liste.</Notice> : null}
        {gaps ? <Notice tone="error">Bitte ohne Lücken von Platz 1 an ausfüllen.</Notice> : null}
        {save.error ? <ErrorBox error={save.error} /> : null}
        {pub.error ? <ErrorBox error={pub.error} /> : null}
        <div className="form__actions">
          <Button variant="secondary" onClick={onSave} busy={save.busy} disabled={!dirty || duplicates || gaps}>Speichern</Button>
          {stage.results_published ? (
            <Button variant="ghost" onClick={() => onPublish(false)} busy={pub.busy}>Zurückziehen</Button>
          ) : (
            <Button onClick={() => onPublish(true)} busy={pub.busy} disabled={st === 'open' || !filled.length || duplicates || gaps}>Veröffentlichen</Button>
          )}
        </div>
      </section>
    </>
  );
}
