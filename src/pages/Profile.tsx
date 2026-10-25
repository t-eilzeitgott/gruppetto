import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../app/context';
import { useTourData } from '../app/hooks';
import { source, BUILD_ID } from '../app/config';
import { invalidate, resetCache } from '../app/query';
import { setThemePref, useThemePref, type ThemePref } from '../app/theme';
import { DEFAULT_SCALE, UNDERDOG_BONUS, BONUS_POINTS } from '../lib/scoring';
import type { TourData } from '../lib/types';
import { Avatar, ProBadge, Button, ErrorBox, Link, PageTitle, Segmented, cx, toast, useAction, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { lastName } from '../ui/bits';

const COLORS = ['#6A3FB5', '#1F6F8B', '#B23A6B', '#2E7D4F', '#A0522D', '#3D5AFE', '#8E44AD', '#00796B', '#C0392B', '#455A64', '#6D4C41', '#5C6BC0'];

export function Profile() {
  useTitle('Profil');
  const { me, tour } = useApp();
  const tourQ = useTourData(tour);
  const theme = useThemePref();
  const [editing, setEditing] = useState(false);
  const logout = useAction();
  const del = useAction();
  const user = source.currentUser();

  const onLogout = () => logout.run(async () => {
    await source.signOut();
    resetCache();
  });

  const onDelete = () => {
    if (!window.confirm('Konto wirklich löschen? Alle deine Tipps werden entfernt. Das lässt sich nicht rückgängig machen.')) return;
    del.run(async () => {
      await source.deleteAccount();
      resetCache();
    });
  };

  return (
    <>
      <PageTitle title="Profil" />
      <div className="stack">
        <section className="card">
          {editing ? (
            <EditProfile onDone={() => setEditing(false)} />
          ) : (
            <div className="account">
              <Avatar name={me.display_name} color={me.avatar_color} size={56} />
              <div className="account__main">
                <strong className="account__name">{me.display_name}{me.is_pro ? <ProBadge /> : null}</strong>
                <span className="muted break-all">{user?.email}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Bearbeiten</Button>
            </div>
          )}
        </section>

        <ProCard />

        <section className="card">
          <div className="setting">
            <span className="setting__label">Darstellung</span>
            <Segmented<ThemePref>
              label="Darstellung wählen"
              value={theme}
              onChange={setThemePref}
              options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }]}
            />
          </div>
          <InstallHint />
        </section>

        {me.is_admin ? (
          <Link to="/admin" className="card card--row">
            <Icon name="settings" />
            <span className="card__main">
              <strong>Admin-Bereich</strong>
              <span className="muted">Rundfahrten, Etappen, Startliste, Ergebnisse, Mitglieder</span>
            </span>
            <Icon name="chevron" className="muted" />
          </Link>
        ) : null}

        <Rules data={tourQ.data} />

        <section className="card link-list">
          <Link to="/impressum" className="link-row"><span>Impressum</span><Icon name="chevron" className="muted" /></Link>
          <Link to="/datenschutz" className="link-row"><span>Datenschutz</span><Icon name="chevron" className="muted" /></Link>
        </section>

        {logout.error ? <ErrorBox error={logout.error} /> : null}
        {del.error ? <ErrorBox error={del.error} /> : null}
        <Button variant="secondary" full icon="logout" onClick={onLogout} busy={logout.busy}>Abmelden</Button>
        <Button variant="ghost" full onClick={onDelete} busy={del.busy}>Konto löschen</Button>
        <p className="hint center">gruppetto · Version {BUILD_ID}{source.mode === 'demo' ? ' · Demo' : ''}</p>
      </div>
    </>
  );
}

function EditProfile({ onDone }: { onDone: () => void }) {
  const { me } = useApp();
  const [name, setName] = useState(me.display_name ?? '');
  const [color, setColor] = useState(me.avatar_color);
  const save = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      await source.updateProfile(name, color);
      invalidate('me');
      invalidate('members');
      toast('Profil gespeichert');
      onDone();
    });
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="account">
        <Avatar name={name} color={color} size={56} />
        <div className="field account__main">
          <label htmlFor="edit-name">Anzeigename</label>
          <input id="edit-name" type="text" maxLength={20} value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <fieldset className="swatches">
        <legend>Farbe</legend>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={cx('swatch', c === color && 'is-selected')}
            style={{ background: c }}
            aria-label={`Farbe ${c}`}
            aria-pressed={c === color}
            onClick={() => setColor(c)}
          />
        ))}
      </fieldset>
      {save.error ? <ErrorBox error={save.error} /> : null}
      <div className="form__actions">
        <Button variant="secondary" onClick={onDone}>Abbrechen</Button>
        <Button type="submit" busy={save.busy} disabled={name.trim().length < 2}>Speichern</Button>
      </div>
    </form>
  );
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (standalone) return null;
  return (
    <div className="setting setting--column">
      <span className="setting__label">Als App auf den Home-Bildschirm</span>
      {prompt ? (
        <Button variant="secondary" icon="plus" onClick={() => prompt.prompt()}>App installieren</Button>
      ) : ios ? (
        <p className="muted">In Safari unten auf <Icon name="share" size={16} /> <strong>Teilen</strong> tippen und <strong>Zum Home-Bildschirm</strong> wählen.</p>
      ) : (
        <p className="muted">Im Browser-Menü <strong>App installieren</strong> bzw. <strong>Zum Startbildschirm hinzufügen</strong> wählen.</p>
      )}
    </div>
  );
}

export function Rules({ data }: { data?: TourData }) {
  const scale = data?.scale.length ? data.scale : DEFAULT_SCALE;
  const jokers = data?.riders.filter((r) => r.tip_limit !== null) ?? [];
  const excluded = data?.riders.filter((r) => r.excluded_from_rest) ?? [];
  const names = (list: { name: string }[]) => list.map((r) => lastName(r.name)).join(' und ');
  return (
    <section className="card rules" aria-labelledby="rules-title">
      <h2 id="rules-title" className="card__title">Regeln</h2>
      <div className="rule">
        <h3>Etappentipp</h3>
        <p className="muted">Ein Fahrer pro Etappe. Punkte nach seinem Platz im Ziel:</p>
        <ol className="scale">
          {scale.map((s) => (
            <li key={s.position} className={cx(s.position === 1 && 'is-first')}>
              <span>{s.position}.</span>
              <strong>{s.points}</strong>
            </li>
          ))}
        </ol>
      </div>
      <div className="rule">
        <h3>Außenseiter-Bonus +{UNDERDOG_BONUS}</h3>
        <p className="muted">Wenn du als Einziger den Etappensieger getippt hast. Tippen zwei oder mehr auf den Sieger, gibt es keinen Bonus.</p>
      </div>
      <div className="rule">
        <h3>Joker-Limit</h3>
        <p className="muted">
          {jokers.length
            ? `${names(jokers)} darfst du je höchstens ${jokers[0].tip_limit}× pro Rundfahrt tippen.`
            : 'Für einzelne Top-Favoriten kann der Admin festlegen, wie oft man sie pro Rundfahrt tippen darf.'}
        </p>
      </div>
      <div className="rule">
        <h3>Tippschluss</h3>
        <p className="muted">Zum Start der jeweiligen Etappe. Bis dahin kannst du deinen Tipp ändern und niemand sieht ihn. Ohne Tipp gibt es 0 Punkte. Steigt dein Fahrer vorher aus, tippe neu.</p>
      </div>
      <div className="rule">
        <h3>Bonustipps</h3>
        <p className="muted">
          Acht Wertungen, Tipp bis zum Start von Etappe&nbsp;1. Liegt dein Fahrer am Ende auf Platz 1, 2 oder 3,
          gibt es {BONUS_POINTS[1]}, {BONUS_POINTS[2]} oder {BONUS_POINTS[3]} Punkte.
          {excluded.length ? ` „Best of the Rest“ ist die Gesamtwertung ohne ${names(excluded)}.` : ''}
        </p>
      </div>
      <div className="rule">
        <h3>Gleichstand</h3>
        <p className="muted">Bei gleicher Punktzahl teilt ihr euch den Platz.</p>
      </div>
    </section>
  );
}

function ProCard() {
  const { me } = useApp();
  const act = useAction();
  const requested = !!me.pro_requested_at;
  const toggle = (on: boolean) => act.run(async () => {
    await source.requestPro(on);
    invalidate('me');
    toast(on ? 'Pro angefragt' : 'Anfrage zurückgezogen');
  });

  return (
    <section className="card card--accent pro-card" aria-labelledby="pro-title">
      <div className="pro-card__head">
        <h2 id="pro-title" className="card__title">gruppetto Pro</h2>
        {me.is_pro ? <ProBadge large /> : <p className="pro-card__price">2,99&nbsp;€<span> / Monat</span></p>}
      </div>
      {me.is_pro ? (
        <p className="muted">Dein Pro-Abo ist aktiv. Das Abzeichen siehst du und alle anderen neben deinem Namen.</p>
      ) : (
        <>
          <ul>
            <li><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" /></svg><span>Legendäres Badge am Profil</span></li>
          </ul>
          <p className="hint">Hab ein <span className="accent" role="img" aria-label="Herz">♥</span> für arme Entwickler.</p>
          {requested ? <p className="muted">Angefragt – sobald der Admin freischaltet, erscheint dein Badge.</p> : null}
          {act.error ? <ErrorBox error={act.error} /> : null}
          {requested ? (
            <Button variant="secondary" full onClick={() => toggle(false)} busy={act.busy}>Anfrage zurückziehen</Button>
          ) : (
            <Button full onClick={() => toggle(true)} busy={act.busy}>Pro anfragen</Button>
          )}
        </>
      )}
    </section>
  );
}
