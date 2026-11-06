import { useState, type FormEvent } from 'react';
import { source } from '../../app/config';
import { invalidate } from '../../app/query';
import { useTours } from '../../app/hooks';
import type { Tour, TourTheme } from '../../lib/types';
import type { TourInput } from '../../data/source';
import { Button, ErrorBox, Loading, TopBar, toast, useAction, useTitle } from '../../ui/kit';
import { fmtRange } from '../../lib/time';
import { setAdminTour } from './common';

const THEMES: { value: TourTheme; label: string }[] = [
  { value: 'giro', label: 'Giro (rosa)' },
  { value: 'tour', label: 'Tour (gelb)' },
  { value: 'vuelta', label: 'Vuelta (rot)' },
  { value: 'neutral', label: 'Neutral (blau)' },
];

const empty = (): TourInput => ({
  id: '', name: '', short_name: '', theme: 'neutral', year: new Date().getFullYear() + 1,
  start_date: '', end_date: '', is_visible: true, bonus_final: false, pcs_slug: null,
});

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function AdminTours() {
  useTitle('Rundfahrten');
  const q = useTours();
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <>
      <TopBar title="Rundfahrten" back="/admin" />
      <div className="stack">
        {q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : !q.data ? <Loading /> : (
          <>
            <ul className="list">
              {q.data.map((t) => (
                <li key={t.id} className="card">
                  {editing === t.id ? (
                    <TourForm initial={t} onDone={() => setEditing(null)} />
                  ) : (
                    <div className="account">
                      <span className="account__main">
                        <strong>{t.name}</strong>
                        <span className="muted">{fmtRange(t.start_date, t.end_date)} · {t.is_visible ? 'sichtbar' : 'ausgeblendet'}{t.bonus_final ? ' · Endstand' : ''}</span>
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(t.id)}>Bearbeiten</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {editing === 'new' ? (
              <section className="card"><TourForm initial={null} onDone={() => setEditing(null)} /></section>
            ) : (
              <Button variant="secondary" icon="plus" full onClick={() => setEditing('new')}>Neue Rundfahrt</Button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function TourForm({ initial, onDone }: { initial: Tour | null; onDone: () => void }) {
  const [t, setT] = useState<TourInput>(initial ? { ...initial } : empty());
  const save = useAction();
  const del = useAction();
  const set = <K extends keyof TourInput>(key: K, value: TourInput[K]) => setT((prev) => ({ ...prev, [key]: value }));
  const id = initial ? initial.id : t.id || slugify(`${t.short_name || t.name}-${t.year}`);
  const valid = t.name.trim() && t.short_name.trim() && t.start_date && t.end_date && t.end_date >= t.start_date && id;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      await source.saveTour({ ...t, id, pcs_slug: t.pcs_slug?.trim() || null });
      invalidate('tours');
      invalidate('tour:');
      setAdminTour(id);
      toast('Rundfahrt gespeichert');
      onDone();
    });
  };

  const remove = () => {
    if (!initial) return;
    if (!window.confirm(`„${initial.name}“ mit allen Etappen, Fahrern und Tipps löschen?`)) return;
    del.run(async () => {
      await source.deleteTour(initial.id);
      invalidate('tours');
      invalidate('tour:');
      toast('Rundfahrt gelöscht');
      onDone();
    });
  };

  const input = (key: 'name' | 'short_name' | 'start_date' | 'end_date', label: string, type = 'text', placeholder?: string) => (
    <div className="field">
      <label htmlFor={`tour-${key}`}>{label}</label>
      <input id={`tour-${key}`} type={type} value={t[key]} placeholder={placeholder}
        onChange={(e) => set(key, (e.target as HTMLInputElement).value)} />
    </div>
  );

  return (
    <form className="form" onSubmit={submit}>
      {input('name', 'Name', 'text', "z. B. Giro d'Italia 2028")}
      <div className="form__grid">
        {input('short_name', 'Kurzname', 'text', 'Giro')}
        <div className="field">
          <label htmlFor="tour-year">Jahr</label>
          <input id="tour-year" type="number" inputMode="numeric" value={t.year} onChange={(e) => set('year', Number((e.target as HTMLInputElement).value))} />
        </div>
        {input('start_date', 'Erster Tag', 'date')}
        {input('end_date', 'Letzter Tag', 'date')}
      </div>
      <div className="field">
        <label htmlFor="tour-theme">Farbe</label>
        <select id="tour-theme" value={t.theme} onChange={(e) => set('theme', (e.target as HTMLSelectElement).value as TourTheme)}>
          {THEMES.map((th) => <option key={th.value} value={th.value}>{th.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tour-pcs">ProCyclingStats-Kürzel</label>
        <input id="tour-pcs" type="text" value={t.pcs_slug ?? ''} placeholder="giro-d-italia/2028"
          onChange={(e) => set('pcs_slug', (e.target as HTMLInputElement).value)} />
        <span className="field__hint">Teil der PCS-Adresse nach /race/ – für Direktlinks zu Startliste und Ergebnissen.</span>
      </div>
      <label className="check">
        <input type="checkbox" checked={t.is_visible} onChange={(e) => set('is_visible', (e.target as HTMLInputElement).checked)} />
        <span>Für Spieler sichtbar</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={t.bonus_final} onChange={(e) => set('bonus_final', (e.target as HTMLInputElement).checked)} />
        <span>Bonuswertungen sind Endstand (zählen in der Rangliste)</span>
      </label>
      {!initial ? <p className="hint">Kennung: <code>{id || '–'}</code></p> : null}
      {save.error ? <ErrorBox error={save.error} /> : null}
      {del.error ? <ErrorBox error={del.error} /> : null}
      <div className="form__actions">
        {initial ? <Button variant="ghost" onClick={remove} busy={del.busy}>Löschen</Button> : null}
        <Button variant="secondary" onClick={onDone}>Abbrechen</Button>
        <Button type="submit" busy={save.busy} disabled={!valid}>Speichern</Button>
      </div>
    </form>
  );
}
