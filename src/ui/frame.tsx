/**
 * Rahmen der App ohne Hooks und ohne Datenquelle (Seitenleiste, Inhalt, Tableiste) – genutzt von der App,
 * von den Ladeansichten und beim Bauen für die statische Startansicht in index.html.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Link, cx } from './kit';

export const NAV: { to: string; label: string; icon: IconName; match: string[] }[] = [
  { to: '/', label: 'Heute', icon: 'home', match: ['', 'spiel'] },
  { to: '/etappen', label: 'Etappen', icon: 'flag', match: ['etappen', 'etappe', 'tipp', 'fahrer', 'anstiege'] },
  { to: '/bonus', label: 'Bonus', icon: 'star', match: ['bonus'] },
  { to: '/rangliste', label: 'Rangliste', icon: 'podium', match: ['rangliste', 'spieler'] },
  { to: '/profil', label: 'Profil', icon: 'user', match: ['profil', 'admin', 'impressum', 'datenschutz'] },
];

/**
 * Rahmen der App ohne Hooks: Seitenleiste, Inhalt, Tableiste. Wird auch für die Ladeansicht genutzt –
 * beim Bauen sogar statisch in index.html geschrieben, damit schon vor dem Laden des Skripts die
 * richtige Oberfläche steht (kein Springen beim Start).
 */
export function ShellFrame({ children, active, sideActive = active, adminActive, hideTabBar, isAdmin, banner }: {
  children: ReactNode; active: string; sideActive?: string; adminActive?: boolean; hideTabBar?: boolean; isAdmin?: boolean; banner?: ReactNode;
}) {
  return (
    <div className={cx('shell', hideTabBar && 'shell--no-tabbar')}>
      {/* Hintergrund unter der Statusleiste (Uhr, Akku), damit gescrollter Inhalt nicht dahinter durchscheint */}
      {hideTabBar ? null : <div className="status-shade" aria-hidden="true" />}
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
            <Link to="/admin" className={cx('sidebar__link', adminActive && 'is-active')}>
              <Icon name="settings" />
              <span>Admin</span>
            </Link>
          ) : null}
        </nav>
      </aside>
      <div className="shell__content">
        <main className="main" id="main">
          {children}
          {banner}
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

/** aktiver Eintrag der Navigation für einen Pfad (ohne Hook, auch für die Ladeansicht) */
export function navFor(first: string): string {
  return NAV.find((n) => n.match.includes(first))?.to ?? '/';
}


export function Wordmark() {
  return <div className="wordmark">gruppetto<span>.</span></div>;
}

/** Hinweis im Demo-Modus (unten auf jeder Seite) */
export function DemoBanner({ live }: { live: boolean }) {
  return (
    <div className="demo-banner" role="note">
      <Icon name="info" size={16} />
      <span>
        Demo-Modus mit Beispieldaten{live ? '' : ' – Supabase ist noch nicht verbunden'}.
      </span>
    </div>
  );
}
