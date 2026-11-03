import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { DemoBanner, ShellFrame, navFor } from './frame';

export { DemoBanner, Wordmark } from './frame';
import { useRoute } from '../app/router';
import { source, LIVE_CONFIGURED } from '../app/config';
import { setSelectedTour } from '../app/hooks';
import type { Tour } from '../lib/types';
import { fmtRange } from '../lib/time';
import { cx } from './kit';

function useActive(): string {
  const { parts } = useRoute();
  return navFor(parts[0] ?? '');
}

export function Shell({ children, hideTabBar, isAdmin }: { children: ReactNode; hideTabBar?: boolean; isAdmin?: boolean }) {
  const active = useActive();
  const route = useRoute();
  const sideActive = isAdmin && route.parts[0] === 'admin' ? '/admin' : active;
  return (
    <ShellFrame active={active} sideActive={sideActive} adminActive={route.parts[0] === 'admin'} hideTabBar={hideTabBar} isAdmin={isAdmin} banner={source.mode === 'demo' ? <DemoBanner live={LIVE_CONFIGURED} /> : null}>
      {children}
    </ShellFrame>
  );
}



/**
 * Neues zu einer kommenden Rundfahrt (z. B. die Strecke ist präsentiert): oben im Auswahlfeld markiert – ein „Neu“
 * am Chip und in der Liste –, bis man die Rundfahrt einmal angesehen hat; nur bis zu ihrem Start (echtes Datum,
 * auch in der Demo).
 */
const TOUR_NEWS: Record<string, { key: string; short: string; option: string }> = {
  'giro-2027': { key: 'gruppetto.neu.giro-2027-strecke', short: 'Giro 2027', option: 'neu: Strecke & alle Etappen' },
};

function newsSeen(id: string): boolean {
  const n = TOUR_NEWS[id];
  if (!n) return true;
  try {
    return localStorage.getItem(n.key) === '1';
  } catch {
    // ohne Speicher ginge die Markierung nie weg – dann lieber keine
    return true;
  }
}

function markNewsSeen(id: string) {
  const n = TOUR_NEWS[id];
  if (!n) return;
  try {
    localStorage.setItem(n.key, '1');
  } catch {
    /* ignorieren */
  }
}

/** ungesehene Neuigkeiten (beim Öffnen gelesen: die Markierung bleibt stehen, solange die Seite offen ist) */
function useTourNews(tour: Tour, tours: Tour[]): Set<string> {
  const [fresh] = useState(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return new Set(tours.filter((t) => TOUR_NEWS[t.id] && t.start_date > today && !newsSeen(t.id)).map((t) => t.id));
  });
  // angesehen = gesehen (beim nächsten Öffnen ist die Markierung weg)
  useEffect(() => { if (fresh.has(tour.id)) markNewsSeen(tour.id); }, [tour.id, fresh]);
  return fresh;
}

/** Auswahl der Rundfahrt als kompakter Chip (native Auswahlliste). */
export function TourPicker({ tour, tours }: { tour: Tour; tours: Tour[] }) {
  const fresh = useTourNews(tour, tours);
  if (tours.length <= 1) {
    return <span className="tour-chip tour-chip--static">{tour.name} · {fmtRange(tour.start_date, tour.end_date)}</span>;
  }
  // Markierung: die eigene Rundfahrt („Neu“) oder eine andere („Neu: Giro 2027“)
  const other = tours.find((t) => t.id !== tour.id && fresh.has(t.id));
  const news = fresh.has(tour.id) ? 'Neu' : other ? `Neu: ${TOUR_NEWS[other.id].short}` : null;
  return (
    <label className={cx('tour-chip', news && 'has-news')}>
      <span className="sr-only">Rundfahrt wählen{other ? ` – neu: ${TOUR_NEWS[other.id].option} für ${other.name}` : ''}</span>
      <select value={tour.id} onChange={(e) => setSelectedTour((e.target as HTMLSelectElement).value)}>
        {tours.map((t) => (
          <option key={t.id} value={t.id}>{fresh.has(t.id) && t.id !== tour.id ? `${t.name} – ${TOUR_NEWS[t.id].option}` : t.name}</option>
        ))}
      </select>
      <span className="tour-chip__label" aria-hidden="true">{tour.name}</span>
      {news ? <span className="tour-chip__new" aria-hidden="true"><i />{news}</span> : null}
      <Icon name="chevronDown" size={16} />
    </label>
  );
}
