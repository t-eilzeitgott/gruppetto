import { useMemo, useState } from 'react';
import { source } from '../../app/config';
import { invalidate } from '../../app/query';
import { useTourData } from '../../app/hooks';
import type { BonusResult, Tour, TourData } from '../../lib/types';
import { bonusStandings } from '../../lib/scoring';
import { CATEGORY_INFO, categoryTitle } from '../../lib/categories';
import { Button, ErrorBox, JerseyTile, Loading, Notice, toast, useAction, useTitle } from '../../ui/kit';
import { AdminPage, ExternalLink, pcsUrl } from './common';
import { riderName } from '../../ui/bits';

type EditableCategory = BonusResult['category'];
const EDITABLE: EditableCategory[] = ['gc', 'rest', 'points', 'mountains', 'youth', 'combative', 'team'];
const PCS_PATH: Partial<Record<EditableCategory, string>> = {
  gc: 'gc', rest: 'gc', points: 'points', mountains: 'kom', youth: 'youth', team: 'teams',
};

export function AdminBonus() {
  useTitle('Bonuswertungen');
  return <AdminPage title="Bonuswertungen">{(tour) => <BonusEditor tour={tour} />}</AdminPage>;
}

function BonusEditor({ tour }: { tour: Tour }) {
  const q = useTourData(tour);
  const final = useAction();
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  const data = q.data;

  const toggleFinal = () => final.run(async () => {
    await source.saveTour({ ...data.tour, bonus_final: !data.tour.bonus_final });
    invalidate('tours');
    invalidate(`tour:${tour.id}`);
    invalidate('season');
    toast(data.tour.bonus_final ? 'Endstand zurückgenommen' : 'Endstand gesetzt – Bonuspunkte zählen');
  });

  return (
    <>
      <Notice>
        Trag hier den Zwischenstand für die Hochrechnung ein und nach der letzten Etappe den Endstand. Erst mit „Endstand“ zählen die Bonuspunkte in der Rangliste.
      </Notice>
      <section className="card">
        <div className="account">
          <span className="account__main">
            <strong>{data.tour.bonus_final ? 'Endstand ist gesetzt' : 'Noch Zwischenstand'}</strong>
            <span className="muted">{data.tour.bonus_final ? 'Bonuspunkte zählen in der Rangliste.' : 'Bonuspunkte sind nur eine Hochrechnung.'}</span>
          </span>
          <Button variant={data.tour.bonus_final ? 'secondary' : 'primary'} size="sm" onClick={toggleFinal} busy={final.busy}>
            {data.tour.bonus_final ? 'Zurücknehmen' : 'Endstand setzen'}
          </Button>
        </div>
        {final.error ? <ErrorBox error={final.error} /> : null}
      </section>
      {EDITABLE.map((cat) => <CategoryEditor key={cat} data={data} category={cat} />)}
      <StageWins data={data} />
    </>
  );
}

function CategoryEditor({ data, category }: { data: TourData; category: EditableCategory }) {
  const isTeam = category === 'team';
  const current = data.bonusResults.filter((b) => b.category === category).sort((a, b) => a.position - b.position);
  const initial = [1, 2, 3].map((p) => {
    const e = current.find((c) => c.position === p);
    return e ? (isTeam ? e.team ?? '' : String(e.rider_id ?? '')) : '';
  });
  const [values, setValues] = useState<string[]>(initial);
  const save = useAction();
  const teams = useMemo(() => [...new Set(data.riders.map((r) => r.team))].sort((a, b) => a.localeCompare(b, 'de')), [data.riders]);
  const riders = useMemo(() => {
    const list = category === 'rest' ? data.riders.filter((r) => !r.excluded_from_rest) : data.riders;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [data.riders, category]);
  const dirty = values.join('|') !== initial.join('|');
  const url = PCS_PATH[category] ? pcsUrl(data.tour, PCS_PATH[category]) : null;

  const onSave = () => save.run(async () => {
    const entries = values
      .map((v, i) => ({ position: i + 1, v }))
      .filter((e) => e.v)
      .map((e) => ({ position: e.position, rider_id: isTeam ? null : Number(e.v), team: isTeam ? e.v : null }));
    await source.setBonusResults(data.tour.id, category, entries);
    invalidate(`tour:${data.tour.id}`);
    toast(`${CATEGORY_INFO[category].label} gespeichert`);
  });

  return (
    <section className="card">
      <div className="card__head">
        <JerseyTile category={category} theme={data.tour.theme} size={32} />
        <h2 className="card__h">{categoryTitle(category, data.tour.theme)}</h2>
      </div>
      {category === 'combative' ? <p className="hint">Meist gibt es nur einen Preisträger – dann nur Platz 1 eintragen.</p> : null}
      {category === 'rest' ? <p className="hint">Gesamtwertung ohne die ausgeklammerten Fahrer.</p> : null}
      {url ? <ExternalLink href={url}>Wertung auf procyclingstats.com</ExternalLink> : null}
      <ol className="slot-list">
        {values.map((v, i) => (
          <li key={i} className="slot">
            <label className="slot__pos" htmlFor={`b-${category}-${i}`}>{i + 1}.</label>
            <select id={`b-${category}-${i}`} value={v} onChange={(e) => {
              const nv = (e.target as HTMLSelectElement).value;
              setValues((prev) => prev.map((x, k) => (k === i ? nv : x)));
            }}>
              <option value="">– leer –</option>
              {isTeam
                ? teams.map((t) => <option key={t} value={t}>{t}</option>)
                : riders.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
            </select>
          </li>
        ))}
      </ol>
      {save.error ? <ErrorBox error={save.error} /> : null}
      <Button variant="secondary" full onClick={onSave} busy={save.busy} disabled={!dirty}>Speichern</Button>
    </section>
  );
}

function StageWins({ data }: { data: TourData }) {
  const wins = bonusStandings(data).filter((s) => s.category === 'stage_wins');
  return (
    <section className="card">
      <div className="card__head">
        <JerseyTile category="stage_wins" theme={data.tour.theme} size={32} />
        <h2 className="card__h">{CATEGORY_INFO.stage_wins.label}</h2>
      </div>
      <p className="muted">Wird automatisch aus den veröffentlichten Etappen berechnet.</p>
      {wins.length ? (
        <ol className="mini-board">
          {wins.map((w) => (
            <li key={w.riderId}>
              <span className="mini-board__rank">{w.position}.</span>
              <span className="mini-board__name">{riderName(data, w.riderId)}</span>
              <strong>{w.wins} {w.wins === 1 ? 'Sieg' : 'Siege'}</strong>
            </li>
          ))}
        </ol>
      ) : <p className="muted">Noch keine Etappe ausgewertet.</p>}
    </section>
  );
}
