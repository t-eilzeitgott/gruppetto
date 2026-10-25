import { useSyncExternalStore, type ReactNode } from 'react';
import { useTours } from '../../app/hooks';
import { useApp } from '../../app/context';
import type { Tour } from '../../lib/types';
import { Empty, ErrorBox, Loading, TopBar } from '../../ui/kit';

const KEY = 'gruppetto.adminTour';
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminTour(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignorieren */
  }
  listeners.forEach((cb) => cb());
}

/** Rundfahrt, die im Admin-Bereich bearbeitet wird (inkl. ausgeblendeter). */
export function useAdminTour() {
  const { tour: appTour } = useApp();
  const q = useTours();
  const stored = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readStored,
  );
  const tours = q.data ?? [];
  const tour = tours.find((t) => t.id === stored) ?? tours.find((t) => t.id === appTour?.id) ?? tours[0] ?? null;
  return { tour, tours, loading: q.loading, error: q.error, reload: q.reload };
}

export function AdminTourSelect({ tour, tours }: { tour: Tour; tours: Tour[] }) {
  return (
    <div className="field">
      <label htmlFor="admin-tour">Rundfahrt</label>
      <select id="admin-tour" value={tour.id} onChange={(e) => setAdminTour((e.target as HTMLSelectElement).value)}>
        {tours.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_visible ? '' : ' (ausgeblendet)'}</option>)}
      </select>
    </div>
  );
}

/** Rahmen für Admin-Seiten mit Rundfahrt-Auswahl. */
export function AdminPage({ title, back = '/admin', children, needsTour = true }: {
  title: string;
  back?: string;
  needsTour?: boolean;
  children: (tour: Tour) => ReactNode;
}) {
  const { tour, tours, loading, error, reload } = useAdminTour();
  return (
    <>
      <TopBar title={title} back={back} />
      <div className="stack">
        {error ? <ErrorBox error={error} onRetry={reload} /> : loading ? <Loading /> : !tour && needsTour ? (
          <Empty title="Keine Rundfahrt">Lege zuerst unter „Rundfahrten“ eine an.</Empty>
        ) : (
          <>
            {tour && needsTour ? <AdminTourSelect tour={tour} tours={tours} /> : null}
            {children(tour as Tour)}
          </>
        )}
      </div>
    </>
  );
}

export function pcsUrl(tour: Tour, path = ''): string | null {
  if (!tour.pcs_slug) return null;
  return `https://www.procyclingstats.com/race/${tour.pcs_slug}${path ? `/${path}` : ''}`;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-link" href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}
