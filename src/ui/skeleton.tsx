/**
 * Platzhalter beim Laden: graue Flächen in der Form des kommenden Inhalts (statt Ladekreis). Sie pulsieren
 * leise und stehen dort, wo der Inhalt erscheint – so springt beim Start und beim Seitenwechsel nichts.
 * Ohne Hooks und ohne Datenquelle: Die Startansicht wird beim Bauen statisch in index.html geschrieben.
 */
import type { CSSProperties, ReactNode } from 'react';
import { ShellFrame, Wordmark, navFor } from './frame';
import { cx } from './kit';

let booting = true;
/**
 * Erster echter Inhalt nach dem Start (statt der Startansicht aus index.html)? Nur einmal wahr –
 * dann blendet der Inhalt weich ein, statt hart über die grauen Flächen zu springen.
 */
export function firstContent(): boolean {
  if (!booting) return false;
  booting = false;
  return typeof performance !== 'undefined' && performance.now() < 6000;
}

/** graue Fläche; w/h in px oder CSS-Wert, r = Eckenradius */
export function Skel({ w, h, r, className, style }: { w?: number | string; h?: number | string; r?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={cx('skel', className)} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

/** Textzeile: so hoch wie eine Zeile in dieser Schriftgröße, der graue Balken in der Mitte */
export function SkelText({ w, size = 16, className }: { w: number | string; size?: number; className?: string }) {
  return <span className={cx('skel-t', className)} style={{ width: w, fontSize: size }} aria-hidden="true" />;
}

/** für Bildschirmleser: „Lädt …“ */
function Busy({ label = 'Lädt …' }: { label?: string }) {
  return <span className="sr-only" role="status">{label}</span>;
}

/** allgemeine Seite: ein paar Karten mit Zeilen */
export function PageSkeleton({ cards = 3, label }: { cards?: number; label?: string }) {
  return (
    <div className="stack skel-page">
      <Busy label={label} />
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="card card--row">
          <Skel w={40} h={40} r={12} />
          <div className="card__main">
            <SkelText w={['58%', '46%', '64%'][i % 3]} size={16} />
            <SkelText w={['38%', '52%', '30%'][i % 3]} size={13} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Kopf der Startseite (Wortmarke links, Profilbild rechts) */
export function HomeHeadSkeleton() {
  return (
    <header className="home-head">
      <Wordmark />
      <span className="home-head__me"><Skel w={36} h={36} r="50%" /></span>
    </header>
  );
}

/** Startseite: Rundfahrt, Punkte, nächste Etappe, letztes Ergebnis, Kacheln, Garage, Minispiele */
export function HomeSkeleton() {
  return (
    <div className="stack skel-page">
      <Busy />
      <Skel w={220} h={40} r={999} />
      <section className="hero">
        <SkelText w={150} size={14} />
        <Skel w={132} h={53} r={12} />
        <SkelText w={170} size={14} />
      </section>
      <section className="card tip-card">
        <div className="card__row">
          <SkelText w={120} size={12} />
          <Skel w={100} h={28} r={999} />
        </div>
        <div>
          <SkelText w={112} size={22} />
          <SkelText w={190} size={15} />
        </div>
        <div className="tip-facts">
          <Skel w={64} h={24} r={999} />
          <SkelText w={64} size={14} />
          <SkelText w={76} size={14} />
          <SkelText w={58} size={14} className="skel-right" />
        </div>
        <Skel h={48} r={14} />
      </section>
      <section className="card card--row">
        <div className="card__main">
          <SkelText w={110} size={12} />
          <SkelText w={160} size={16} />
          <SkelText w={210} size={14} />
        </div>
        <SkelText w={26} size={16} />
      </section>
      <div className="tiles">
        {[0, 1].map((i) => (
          <div key={i} className="tile-card">
            <SkelText w="62%" size={13} />
            <Skel w={44} h={30} r={8} />
            <SkelText w="54%" size={13} />
          </div>
        ))}
      </div>
      <GamesCardSkeleton />
    </div>
  );
}

/** Spielkarte: Spielwahl, Kopf mit Symbol, kleine Bestenliste, Startknopf, drei Kacheln */
export function GamesCardSkeleton() {
  return (
    <section className="card arena" aria-hidden="true">
      <div className="arena__tabs">
        <span className="arena__ind" />
        {['Zeitfahren', 'Abfahrt', 'Sprint', 'Berg'].map((n, i) => <span key={n} className={cx('arena__tab', i === 0 && 'is-on')}>{n}</span>)}
      </div>
      <div className="arena__scroller">
        <div className="arena__pane">
          <div className="ghead">
            <Skel w={44} h={44} r={13} />
            <div className="ghead__text">
              <SkelText w={120} size={22} />
              <SkelText w={200} size={13.5} />
            </div>
          </div>
          <BoardSkeleton />
        </div>
      </div>
      <Skel w="100%" h={48} r={14} />
      <div className="arena__tiles">
        {[0, 1, 2].map((i) => (
          <div key={i} className="arena__tile">
            <Skel w={34} h={34} r={10} />
            <div className="arena__tile-text">
              <SkelText w={36} size={17} />
              <SkelText w={48} size={11.5} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Bestenliste in der Spielkarte: Kennzeichnung und drei Zeilen */
export function BoardSkeleton() {
  return (
    <span className="arena__board" aria-hidden="true">
      <SkelText w={44} size={11} className="arena__board-label" />
      {[0, 1, 2].map((i) => (
        <span key={i} className="arena__row">
          <SkelText w={10} size={13} />
          <Skel w={22} h={22} r="50%" />
          <SkelText w={['44%', '36%', '40%'][i]} size={15} />
          <SkelText w={44} size={15} className="skel-right" />
        </span>
      ))}
    </span>
  );
}

/** Radgarage: Kopf, Drehscheibe, Leiste mit Rädern, Infokasten */
export function GarageSkeleton() {
  return (
    <div className="garage skel-page">
      <Busy />
      <header className="garage__top">
        <Skel w={44} h={44} r="50%" className="skel--dark" />
        <div className="garage__head">
          <h1>Radgarage</h1>
          <SkelText w={170} size={13} className="skel--dark" />
        </div>
      </header>
      <div className="garage__body">
        <div className="garage__stage">
          <div className="garage__plate">
            <SkelText w={140} size={11.5} className="skel--dark" />
            <SkelText w={170} size={26} className="skel--dark" />
          </div>
        </div>
        <div className="garage__side">
          <nav className="garage__list" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="garage__item">
                <span className="garage__thumb"><span className="garage__skel" /></span>
                <SkelText w="70%" size={14} className="skel--dark" />
              </span>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

/** Minispiel: dunkle Bühne wie das Spiel selbst (die Startkarte erscheint mit der Seite) */
export function GameSkeleton() {
  return (
    <div className="abf abf--boot">
      <Busy label="Spiel lädt …" />
    </div>
  );
}

/** Ladeansicht passend zur Seite (ohne Rahmen) */
export function RouteSkeleton({ parts, head }: { parts: string[]; head?: ReactNode }) {
  const [first, second] = parts;
  if (first === 'spiel') return second === 'garage' || second === 'reise' ? <GarageSkeleton /> : <GameSkeleton />;
  if (first === undefined) return <>{head ?? <HomeHeadSkeleton />}<HomeSkeleton /></>;
  return (
    <>
      <header className="page-title">
        <div className="page-title__text"><SkelText w={160} size={30} /></div>
      </header>
      <PageSkeleton />
    </>
  );
}

/** ganze Ladeansicht mit Rahmen (Tableiste usw.) für eine Seite */
export function AppSkeleton({ parts, banner }: { parts: string[]; banner?: ReactNode }) {
  const first = parts[0];
  const full = first === 'tipp' || first === 'spiel' || (first === 'bonus' && !!parts[1]);
  return (
    <ShellFrame active={navFor(first ?? '')} hideTabBar={full} banner={banner}>
      <RouteSkeleton parts={parts} />
    </ShellFrame>
  );
}
