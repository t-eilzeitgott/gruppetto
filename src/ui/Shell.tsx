import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Link, cx } from './kit';
import { useRoute } from '../app/router';
import { source, LIVE_CONFIGURED } from '../app/config';
import { setSelectedTour } from '../app/hooks';
import type { Tour } from '../lib/types';
import { fmtRange } from '../lib/time';

const NAV: { to: string; label: string; icon: IconName; match: string[] }[] = [
  { to: '/', label: 'Heute', icon: 'home', match: [''] },
  { to: '/etappen', label: 'Etappen', icon: 'flag', match: ['etappen', 'etappe', 'tipp', 'fahrer'] },
  { to: '/bonus', label: 'Bonus', icon: 'star', match: ['bonus'] },
  { to: '/rangliste', label: 'Rangliste', icon: 'podium', match: ['rangliste', 'spieler'] },
  { to: '/profil', label: 'Profil', icon: 'user', match: ['profil', 'admin', 'impressum', 'datenschutz'] },
];

function useActive(): string {
  const { parts } = useRoute();
  const first = parts[0] ?? '';
  return NAV.find((n) => n.match.includes(first))?.to ?? '/';
}

export function Shell({ children, hideTabBar, isAdmin }: { children: ReactNode; hideTabBar?: boolean; isAdmin?: boolean }) {
  const active = useActive();
  const route = useRoute();
  const sideActive = isAdmin && route.parts[0] === 'admin' ? '/admin' : active;
  return (
    <div className={cx('shell', hideTabBar && 'shell--no-tabbar')}>
      <aside className="sidebar" aria-label="Seitenleiste">
        <div className="wordmark wordmark--lg">gruppetto<span>.</span></div>
        <nav className="sidebar__nav" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={cx('sidebar__link', sideActive === n.to && 'is-active')} ariaCurrent={sideActive === n.to ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
          {isAdmin ? (
            <Link to="/admin" className={cx('sidebar__link', route.parts[0] === 'admin' && 'is-active')}>
              <Icon name="settings" />
              <span>Admin</span>
            </Link>
          ) : null}
        </nav>
      </aside>
      <div className="shell__content">
        <main className="main" id="main">
          {children}
          {source.mode === 'demo' ? <DemoBanner /> : null}
        </main>
      </div>
      {hideTabBar ? null : (
        <nav className="tabbar" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={cx('tabbar__item', active === n.to && 'is-active')} ariaCurrent={active === n.to ? 'page' : undefined}>
              <Icon name={n.icon} size={24} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <Icon name="info" size={16} />
      <span>
        Demo-Modus mit Beispieldaten{LIVE_CONFIGURED ? '' : ' – Supabase ist noch nicht verbunden'}.
      </span>
    </div>
  );
}

export function Wordmark() {
  return <div className="wordmark">gruppetto<span>.</span></div>;
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
