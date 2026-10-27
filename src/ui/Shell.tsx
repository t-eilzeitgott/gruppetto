import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { DemoBanner, ShellFrame, navFor } from './frame';

export { DemoBanner, Wordmark } from './frame';
import { useRoute } from '../app/router';
import { source, LIVE_CONFIGURED } from '../app/config';
import { setSelectedTour } from '../app/hooks';
import type { Tour } from '../lib/types';
import { fmtRange } from '../lib/time';

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



/** Auswahl der Rundfahrt als kompakter Chip (native Auswahlliste). */
export function TourPicker({ tour, tours }: { tour: Tour; tours: Tour[] }) {
  if (tours.length <= 1) {
    return <span className="tour-chip tour-chip--static">{tour.name} · {fmtRange(tour.start_date, tour.end_date)}</span>;
  }
  return (
    <label className="tour-chip">
      <span className="sr-only">Rundfahrt wählen</span>
      <select value={tour.id} onChange={(e) => setSelectedTour((e.target as HTMLSelectElement).value)}>
        {tours.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <span className="tour-chip__label" aria-hidden="true">{tour.name}</span>
      <Icon name="chevronDown" size={16} />
    </label>
  );
}
