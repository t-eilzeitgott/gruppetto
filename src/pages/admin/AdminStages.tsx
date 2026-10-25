import { useMemo, useState, type FormEvent } from 'react';
import { source } from '../../app/config';
import { invalidate } from '../../app/query';
import { useTourData } from '../../app/hooks';
import type { Stage, StageKind, Tour } from '../../lib/types';
import type { StageInput } from '../../data/source';
import { KIND_LABEL, addDays, fmtDay, fromLocalInput, sortStages, toLocalInput, weekdayOf, fmtClock, fmtKm } from '../../lib/time';
import { Button, ErrorBox, Loading, Notice, cx, toast, useAction, useTitle } from '../../ui/kit';
import { AdminPage } from './common';
import { stageRoute } from '../../ui/bits';

const KINDS: StageKind[] = ['flat', 'hilly', 'mountain', 'itt', 'ttt'];

export function AdminStages() {
  useTitle('Etappen verwalten');
  return <AdminPage title="Etappen">{(tour) => <StagesEditor tour={tour} />}</AdminPage>;
}

function StagesEditor({ tour }: { tour: Tour }) {
  const q = useTourData(tour);
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  const stages = sortStages(q.data.stages);

  return (
    <>
      <Notice icon="clock">Tippschluss ist die Startzeit der Etappe. Trag sie ein, sobald der Zeitplan feststeht.</Notice>
      {stages.length === 0 ? <Generator tour={tour} /> : null}
      <ul className="list">
        {stages.map((s) => (
          <li key={s.id} className="card">
            {openId === s.id ? (
              <StageForm tour={tour} stage={s} onDone={() => setOpenId(null)} />
            ) : (
              <button type="button" className="admin-stage" onClick={() => setOpenId(s.id)}>
                <span className="admin-stage__num">{s.number}</span>
                <span className="admin-stage__main">
                  <strong>{fmtDay(s.starts_at)} · {fmtClock(s.starts_at)}</strong>
                  <span className="muted">{KIND_LABEL[s.kind]}{s.distance_km ? ` · ${fmtKm(s.distance_km)}` : ''}{stageRoute(s) ? ` · ${stageRoute(s)}` : ''}</span>
                </span>
                <span className={cx('chip', s.results_published && 'chip--accent')}>{s.results_published ? 'ausgewertet' : 'bearbeiten'}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {stages.length > 0 ? (
        openId === 'new' ? (
          <section className="card"><StageForm tour={tour} stage={null} nextNumber={(stages[stages.length - 1]?.number ?? 0) + 1} onDone={() => setOpenId(null)} /></section>
        ) : (
          <Button variant="secondary" icon="plus" full onClick={() => setOpenId('new')}>Etappe hinzufügen</Button>
        )
      ) : null}
    </>
  );
}

function Generator({ tour }: { tour: Tour }) {
  const days = useMemo(() => {
    const list: string[] = [];
    for (let d = tour.start_date; d <= tour.end_date && list.length < 40; d = addDays(d, 1)) list.push(d);
    return list;
  }, [tour.start_date, tour.end_date]);
  const [count, setCount] = useState(21);
  const [time, setTime] = useState('12:00');
  const [rest, setRest] = useState<Set<string>>(() => new Set());
  const gen = useAction();

  const plan = useMemo(() => days.filter((d) => !rest.has(d)).slice(0, count), [days, rest, count]);
  const enough = plan.length === count;

  const toggle = (d: string) => setRest((prev) => {
    const next = new Set(prev);
    if (next.has(d)) next.delete(d); else next.add(d);
    return next;
  });

  const create = () => gen.run(async () => {
    const stages: StageInput[] = plan.map((d, i) => ({
      number: i + 1,
      starts_at: fromLocalInput(`${d}T${time}`),
      kind: 'flat',
      departure: null,
      arrival: null,
      distance_km: null,
    }));
    await source.saveStages(tour.id, stages);
    invalidate(`tour:${tour.id}`);
    toast(`${stages.length} Etappen angelegt`);
  });

  return (
    <section className="card">
      <h2 className="card__title">Etappen anlegen</h2>
      <p className="muted">Wähle die Ruhetage. Alle anderen Tage werden der Reihe nach Etappen – danach kannst du jede einzeln anpassen.</p>
      <div className="form__grid">
        <div className="field">
          <label htmlFor="gen-count">Anzahl Etappen</label>
          <input id="gen-count" type="number" inputMode="numeric" min={1} max={30} value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(30, Number((e.target as HTMLInputElement).value) || 1)))} />
        </div>
        <div className="field">
          <label htmlFor="gen-time">Startzeit</label>
          <input id="gen-time" type="time" value={time} onChange={(e) => setTime((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <fieldset className="day-grid">
        <legend>Ruhetage antippen</legend>
        {days.map((d) => {
          const isRest = rest.has(d);
          const num = plan.indexOf(d) + 1;
          return (
            <button key={d} type="button" className={cx('day', isRest && 'day--rest', !isRest && num === 0 && 'day--unused')}
              aria-pressed={isRest} onClick={() => toggle(d)}>
              <span className="day__date">{weekdayOf(d)} {d.slice(8, 10)}.{d.slice(5, 7)}.</span>
              <span className="day__label">{isRest ? 'Ruhetag' : num ? `Etappe\u00a0${num}` : '–'}</span>
            </button>
          );
        })}
      </fieldset>
      {!enough ? <Notice tone="error">Im Zeitraum sind nur {plan.length} Tage frei – weniger Ruhetage wählen oder Zeitraum der Rundfahrt anpassen.</Notice> : null}
      {gen.error ? <ErrorBox error={gen.error} /> : null}
      <Button full onClick={create} busy={gen.busy} disabled={!enough}>{count} Etappen anlegen</Button>
    </section>
  );
}

function StageForm({ tour, stage, nextNumber, onDone }: { tour: Tour; stage: Stage | null; nextNumber?: number; onDone: () => void }) {
  const [number, setNumber] = useState(stage?.number ?? nextNumber ?? 1);
  const [start, setStart] = useState(stage ? toLocalInput(stage.starts_at) : `${tour.end_date}T12:00`);
  const [kind, setKind] = useState<StageKind>(stage?.kind ?? 'flat');
  const [departure, setDeparture] = useState(stage?.departure ?? '');
  const [arrival, setArrival] = useState(stage?.arrival ?? '');
  const [km, setKm] = useState(stage?.distance_km ? String(stage.distance_km).replace('.', ',') : '');
  const save = useAction();
  const del = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const input: StageInput = {
        number,
        starts_at: fromLocalInput(start),
        kind,
        departure: departure.trim() || null,
        arrival: arrival.trim() || null,
        distance_km: km.trim() ? Number(km.replace(',', '.')) : null,
      };
      if (stage) await source.updateStage(stage.id, input);
      else await source.saveStages(tour.id, [input]);
      invalidate(`tour:${tour.id}`);
      toast(`Etappe\u00a0${number} gespeichert`);
      onDone();
    });
  };

  const remove = () => {
    if (!stage || !window.confirm(`Etappe\u00a0${stage.number} inklusive aller Tipps löschen?`)) return;
    del.run(async () => {
      await source.deleteStage(stage.id);
      invalidate(`tour:${tour.id}`);
      toast('Etappe gelöscht');
      onDone();
    });
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="form__grid">
        <div className="field">
          <label htmlFor="st-num">Etappe</label>
          <input id="st-num" type="number" inputMode="numeric" min={1} max={30} value={number}
            onChange={(e) => setNumber(Number((e.target as HTMLInputElement).value))} />
        </div>
        <div className="field">
          <label htmlFor="st-kind">Profil</label>
          <select id="st-kind" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as StageKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="st-start">Start = Tippschluss</label>
        <input id="st-start" type="datetime-local" value={start} onChange={(e) => setStart((e.target as HTMLInputElement).value)} />
      </div>
      <div className="form__grid">
        <div className="field">
          <label htmlFor="st-from">Start</label>
          <input id="st-from" type="text" value={departure} placeholder="Ort" onChange={(e) => setDeparture((e.target as HTMLInputElement).value)} />
        </div>
        <div className="field">
          <label htmlFor="st-to">Ziel</label>
          <input id="st-to" type="text" value={arrival} placeholder="Ort" onChange={(e) => setArrival((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="st-km">Länge in km</label>
        <input id="st-km" type="text" inputMode="decimal" value={km} placeholder="z. B. 172" onChange={(e) => setKm((e.target as HTMLInputElement).value)} />
      </div>
      {save.error ? <ErrorBox error={save.error} /> : null}
      {del.error ? <ErrorBox error={del.error} /> : null}
      <div className="form__actions">
        {stage ? <Button variant="ghost" onClick={remove} busy={del.busy}>Löschen</Button> : null}
        <Button variant="secondary" onClick={onDone}>Abbrechen</Button>
        <Button type="submit" busy={save.busy} disabled={!start}>Speichern</Button>
      </div>
    </form>
  );
}
