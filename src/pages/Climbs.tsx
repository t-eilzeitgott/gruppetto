import { useState } from 'react';
import { useTourContext } from '../app/context';
import { sortStages } from '../lib/time';
import type { Climb, Stage } from '../lib/types';
import { Empty, ErrorBox, Link, Loading, TopBar, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { CAT_SHORT, ClimbSheet, catClass, climbMetrics } from '../ui/StageProfile';

type Sort = 'route' | 'difficulty' | 'gain' | 'max' | 'alt';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'route', label: 'Reihenfolge im Rennen' },
  { value: 'difficulty', label: 'Härte (FIETS)' },
  { value: 'gain', label: 'Höhenmeter' },
  { value: 'max', label: 'Maximalsteigung' },
  { value: 'alt', label: 'Gipfelhöhe' },
];
const CAT_ORDER: Record<string, number> = { CC: 0, HC: 1, '1': 2, '2': 3, '3': 4, '4': 5 };

/** Alle Bergwertungen der Rundfahrt mit Steckbrief. */
export function ClimbsPage() {
  useTitle('Anstiege');
  const { data, loading, error, reload } = useTourContext();
  const [sort, setSort] = useState<Sort>('route');
  const [cat, setCat] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);

  if (error) return <><TopBar title="Anstiege" back="/etappen" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data) return <><TopBar title="Anstiege" back="/etappen" /><Loading /></>;

  const all: { c: Climb; s: Stage; key: string }[] = sortStages(data.stages)
    .flatMap((s) => (s.climbs ?? []).map((c, i) => ({ c, s, key: `${s.id}-${i}` })));
  if (!all.length) return <><TopBar title="Anstiege" back="/etappen" /><Empty icon="mountain" title="Keine Bergwertungen eingetragen" /></>;

  const val = (x: { c: Climb; s: Stage }) => {
    const m = climbMetrics(x.c, x.s);
    if (sort === 'difficulty') return m.difficulty ?? -1;
    if (sort === 'gain') return m.gain ?? -1;
    if (sort === 'max') return x.c.max ?? -1;
    if (sort === 'alt') return x.c.alt ?? -1;
    return 0;
  };
  let list = cat === 'all' ? all : all.filter((x) => x.c.cat === cat);
  if (sort !== 'route') list = [...list].sort((a, b) => val(b) - val(a));
  const cats = [...new Set(all.map((x) => x.c.cat))].sort((a, b) => (CAT_ORDER[a] ?? 9) - (CAT_ORDER[b] ?? 9));
  const totalGain = all.reduce((s, x) => s + (climbMetrics(x.c).gain ?? 0), 0);
  const totalLen = all.reduce((s, x) => s + (x.c.len ?? 0), 0);
  const summitFinishes = all.filter((x) => climbMetrics(x.c, x.s).finish).length;

  return (
    <>
      <TopBar title="Anstiege" subtitle={data.tour.name} back="/etappen" />
      <div className="stack">
        <div className="stat-grid">
          <div className="stat"><strong>{all.length}</strong><span>Anstiege</span></div>
          <div className="stat"><strong>{Math.round(totalLen)}</strong><span>Kletter-km</span></div>
          <div className="stat"><strong>{summitFinishes}</strong><span>Bergziele</span></div>
        </div>
        <p className="muted small">Zusammen ≈ {totalGain.toLocaleString('de-DE')} Höhenmeter allein in den gewerteten Anstiegen.</p>

        <div className="filter-row" role="group" aria-label="Kategorie">
          <button type="button" className={cx('toggle', cat === 'all' && 'is-on')} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>Alle</button>
          {cats.map((c) => (
            <button key={c} type="button" className={cx('toggle', cat === c && 'is-on')} aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c === 'CC' ? 'Cima Coppi' : c === 'HC' ? 'HC' : `${c}. Kat.`}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="climb-sort">Sortierung</label>
          <select id="climb-sort" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <ol className="card profile-points climb-dir">
          {list.map(({ c, s, key }) => {
            const m = climbMetrics(c, s);
            return (
              <li key={key}>
                <button type="button" className="profile-points__btn" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                  <span className="profile-points__km">E{s.number}</span>
                  <span className={`badge ${catClass(c.cat)}`}>{CAT_SHORT[c.cat] ?? c.cat}</span>
                  <span className="profile-points__main">
                    <strong>{c.name}</strong>
                    <span className="muted">
                      {[c.len ? `${c.len.toLocaleString('de-DE')}\u00a0km` : null, c.grad ? `Ø\u00a0${c.grad.toLocaleString('de-DE')}\u00a0%` : null,
                        c.max ? `max.\u00a0${c.max}\u00a0%` : null, c.alt ? `${c.alt.toLocaleString('de-DE')}\u00a0m` : null,
                        m.difficulty !== null ? `Härte\u00a0${m.difficulty.toLocaleString('de-DE', { maximumFractionDigits: 1 })}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className={cx('profile-points__chev', open === key && 'is-open')} />
                </button>
                {open === key ? (
                  <>
                    <ClimbSheet c={c} stage={s} tour={data.tour} />
                    <Link to={`/etappe/${s.id}`} className="text-link climb-dir__stage">Etappe&nbsp;{s.number}: {s.departure} → {s.arrival}</Link>
                  </>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="hint">Härte nach dem FIETS-Index: Höhenmeter² / (Länge × 10) plus Höhenbonus über 1.000 m. Ab etwa 8 gilt ein Anstieg als schwer.</p>
      </div>
    </>
  );
}
