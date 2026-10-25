import { useMemo, useState, type FormEvent } from 'react';
import { source } from '../../app/config';
import { invalidate, useQuery } from '../../app/query';
import { parseGpx, stageNumberFromName, type ParsedGpx } from '../../lib/gpx';
import { Icon } from '../../ui/Icon';
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
      {stages.length === 0 ? <Generator tour={tour} /> : <GpxImport stages={stages} />}
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

interface GpxFile {
  file: string;
  parsed: ParsedGpx | null;
  stageId: number | null;
}

/** Höhenprofile aus GPX-Dateien für mehrere Etappen auf einmal hinterlegen */
function GpxImport({ stages }: { stages: Stage[] }) {
  const ids = stages.map((s) => s.id);
  const have = useQuery<number[]>(`profiles-list:${ids.join(',')}`, () => source.listStageProfiles(ids));
  const [files, setFiles] = useState<GpxFile[]>([]);
  const [takeElevation, setTakeElevation] = useState(true);
  const save = useAction();
  const withProfile = new Set(have.data ?? []);

  const onPick = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all([...list].map(async (f) => {
      const text = await f.text();
      const parsed = parseGpx(text);
      const n = stageNumberFromName(f.name);
      const stage = stages.find((s) => s.number === n) ?? null;
      return { file: f.name, parsed, stageId: stage?.id ?? null };
    }));
    setFiles(read.sort((a, b) => (stages.find((s) => s.id === a.stageId)?.number ?? 99) - (stages.find((s) => s.id === b.stageId)?.number ?? 99)));
  };

  const ready = files.filter((f) => f.parsed && f.stageId !== null);
  const onSave = () => save.run(async () => {
    for (const f of ready) {
      await source.saveStageProfile(f.stageId!, f.parsed!.points, f.file);
      const stage = stages.find((s) => s.id === f.stageId);
      if (takeElevation && stage && !stage.elevation_m) await source.updateStage(stage.id, { elevation_m: f.parsed!.gainM });
      invalidate(`profile:${f.stageId}`);
    }
    invalidate('profiles-list:');
    invalidate('tour:');
    toast(`${ready.length} ${ready.length === 1 ? 'Höhenprofil' : 'Höhenprofile'} gespeichert`);
    setFiles([]);
  });

  return (
    <section className="card">
      <span className="eyebrow">Höhenprofile (GPX)</span>
      <p className="muted">
        {withProfile.size} von {stages.length} Etappen haben ein echtes Höhenprofil. Lade die GPX-Strecken hoch, gern alle auf einmal –
        die Etappennummer wird aus dem Dateinamen erkannt (z.&nbsp;B. „stage-7.gpx“).
      </p>
      <label className="btn btn--secondary btn--full file-pick">
        <Icon name="plus" size={18} />
        <span>GPX-Dateien auswählen</span>
        <input type="file" accept=".gpx,application/gpx+xml" multiple onChange={(e) => onPick((e.target as HTMLInputElement).files)} />
      </label>
      {files.length ? (
        <>
          <ul className="gpx-list">
            {files.map((f, i) => {
              const stage = stages.find((s) => s.id === f.stageId);
              const off = f.parsed && stage?.distance_km ? Math.abs(f.parsed.distanceKm - stage.distance_km) / stage.distance_km : 0;
              return (
                <li key={i} className="gpx-row">
                  <span className="gpx-row__file">{f.file}</span>
                  <select aria-label={`Etappe für ${f.file}`} value={f.stageId ?? ''}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      setFiles(files.map((x, j) => (j === i ? { ...x, stageId: v ? Number(v) : null } : x)));
                    }}>
                    <option value="">–</option>
                    {stages.map((s) => <option key={s.id} value={s.id}>Etappe {s.number}</option>)}
                  </select>
                  <span className={cx('gpx-row__meta', (!f.parsed || off > 0.08) && 'gpx-row__warn')}>
                    {!f.parsed ? 'Keine Höhendaten gefunden – ist das eine GPX-Strecke mit Höhen?' : (
                      <>
                        {f.parsed.distanceKm.toLocaleString('de-DE')}&nbsp;km · {f.parsed.gainM.toLocaleString('de-DE')}&nbsp;Hm ·
                        {' '}{f.parsed.startM}&nbsp;m → {f.parsed.finishM}&nbsp;m · höchster Punkt {f.parsed.maxM}&nbsp;m
                        {stage?.distance_km && off > 0.08 ? ` · weicht ${Math.round(off * 100)} % von ${stage.distance_km} km ab` : ''}
                        {stage && withProfile.has(stage.id) ? ' · ersetzt das vorhandene Profil' : ''}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <label className="check">
            <input type="checkbox" checked={takeElevation} onChange={(e) => setTakeElevation((e.target as HTMLInputElement).checked)} />
            <span>Höhenmeter übernehmen, wo noch keine eingetragen sind</span>
          </label>
          {save.error ? <ErrorBox error={save.error} /> : null}
          <Button full onClick={onSave} busy={save.busy} disabled={!ready.length}>
            {ready.length} {ready.length === 1 ? 'Höhenprofil' : 'Höhenprofile'} speichern
          </Button>
        </>
      ) : null}
    </section>
  );
}
