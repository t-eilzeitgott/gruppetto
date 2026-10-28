import { useTourData, useNow } from '../../app/hooks';
import { Link, useTitle } from '../../ui/kit';
import { Icon, type IconName } from '../../ui/Icon';
import { AdminPage } from './common';
import type { Tour } from '../../lib/types';
import { runningStages } from '../../lib/time';
import { SYNC_MODE_LABEL } from './AdminSync';

export function AdminHome() {
  useTitle('Admin');
  return (
    <AdminPage title="Admin" back="/profil">
      {(tour) => <Sections tour={tour} />}
    </AdminPage>
  );
}

function Sections({ tour }: { tour: Tour }) {
  const q = useTourData(tour);
  const now = useNow(60000);
  const d = q.data;
  const pending = d ? runningStages(d.stages, now) : [];
  const limit = tour.tip_limit === undefined ? 3 : tour.tip_limit;
  const out = d?.riders.filter((r) => r.status === 'out').length ?? 0;
  const items: { to: string; icon: IconName; title: string; sub: string; alert?: boolean }[] = [
    { to: '/admin/rundfahrten', icon: 'calendar', title: 'Rundfahrten', sub: 'Anlegen, Zeitraum, sichtbar, Endstand' },
    { to: '/admin/etappen', icon: 'flag', title: 'Etappen', sub: d ? `${d.stages.length} angelegt · Tippschluss = Startzeit` : 'Lädt …' },
    { to: '/admin/startliste', icon: 'users', title: 'Startliste', sub: d ? `${d.riders.length} Fahrer${out ? ` · ${out} ausgestiegen` : ''} · ${limit === null ? 'beliebig oft tippbar' : `max. ${limit}× pro Fahrer`}` : 'Lädt …' },
    {
      to: '/admin/ergebnis',
      icon: 'trophy',
      title: 'Etappenergebnis',
      sub: pending.length ? `Etappe\u00a0${pending.map((s) => s.number).join(', ')} wartet auf das Ergebnis` : 'Top 10 eintragen und veröffentlichen',
      alert: pending.length > 0,
    },
    { to: '/admin/bonus', icon: 'star', title: 'Bonuswertungen', sub: tour.bonus_final ? 'Endstand eingetragen' : 'Zwischenstand für die Hochrechnung' },
    {
      to: '/admin/automatik',
      icon: 'refresh',
      title: 'Automatische Ergebnisse',
      sub: !tour.sync_mode || tour.sync_mode === 'off' ? 'Aus · Ergebnisse von procyclingstats.com holen' : `Von procyclingstats.com · ${SYNC_MODE_LABEL[tour.sync_mode]}`,
    },
    { to: '/admin/mitglieder', icon: 'user', title: 'Mitglieder & Einladung', sub: 'Einladungscode, Admins, Pro' },
    { to: '/admin/akku', icon: 'zap', title: 'Minispiel „Akku leer!“', sub: 'Prototyp · nur für Admins sichtbar' },
    { to: '/admin/welt', icon: 'mountain', title: 'Welt-Editor', sub: 'Durch die 3D-Welten fliegen, Requisiten und Gelände ändern, Notizen für Claude' },
    { to: '/admin/gpu', icon: 'zap', title: 'WebGPU-Test', sub: 'Passabfahrt mit neuer Grafik-Technik – Vergleich zum Spiel' },
  ];
  return (
    <ul className="list admin-list">
      {items.map((it) => (
        <li key={it.to}>
          <Link to={it.to} className="card card--row">
            <span className={it.alert ? 'accent' : ''}><Icon name={it.icon} /></span>
            <span className="card__main">
              <strong>{it.title}</strong>
              <span className={it.alert ? 'accent' : 'muted'}>{it.sub}</span>
            </span>
            <Icon name="chevron" className="muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
