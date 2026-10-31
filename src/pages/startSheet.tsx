/**
 * Startbildschirm der Minispiele: ein Blatt am unteren Rand über der 3D-Welt – Kopf des Spiels (Symbol, Name,
 * Strecke), darunter das Nötigste zum Spiel, unten der Startknopf. Kommt man von der Startseite, fliegt der Kopf
 * der Spielkarte hierher (handoff.ts); beim Losfahren gleitet das Blatt weg, dann beginnt der Countdown.
 * Dazu der Countdown selbst: ein Ring, der je Sekunde abläuft, die Zahl in der Mitte.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HANDOFF_MS, endHandoff, sheetIn, sheetOut } from '../app/handoff';
import { markUiBusy } from '../game/uiBusy';
import type { GameId } from '../data/source';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';
import { GameHead } from '../ui/GameHead';
import { Icon } from '../ui/Icon';
import { Avatar, cx } from '../ui/kit';

export function StartSheet({ game, title, sub, tag, extra, children, cta = 'Losfahren', onStart, onClose, plain, after }: {
  game: GameId;
  title: string;
  sub: ReactNode;
  tag?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  cta?: string;
  onStart: () => void;
  onClose: () => void;
  /** nur der Inhalt (Bestenliste, Fehler) – ohne Kopf und Startknopf */
  plain?: boolean;
  /** unter dem Startknopf (Testfahrt, Messfahrt) */
  after?: ReactNode;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const firstRef = useRef(true);
  useLayoutEffect(() => {
    const s = sheet.current;
    if (!s || !firstRef.current) return;
    firstRef.current = false;
    // solange das Blatt hereinkommt, baut die 3D-Welt nur in kleinen Portionen weiter
    markUiBusy(HANDOFF_MS + 350);
    const h = head.current;
    if (!(h && endHandoff(h, s))) sheetIn(s);
  }, []);
  const go = () => {
    if (leaving) return;
    setLeaving(true);
    // Blatt weg, Countdown, HUD herein: Bewegung vor Vorbauen
    markUiBusy(3800);
    const s = sheet.current;
    (s ? sheetOut(s, layer.current) : Promise.resolve()).then(onStart);
  };
  return (
    <div ref={layer} className={cx('abf-layer abf-layer--sheet', leaving && 'is-leaving')}>
      <button type="button" className="abf-round abf-close" onClick={onClose} aria-label="Schließen"><Icon name="x" size={20} /></button>
      <div className="abf-sheet" ref={sheet}>
        {plain ? (
          <div className="abf-sheet__body abf-scroll">{children}</div>
        ) : (
          <>
            <div className="abf-sheet__head">
              <GameHead ref={head} as="h1" game={game} title={title} sub={sub} tag={tag} extra={extra} />
            </div>
            {children ? <div className="abf-sheet__body abf-scroll">{children}</div> : null}
            <div className="abf-sheet__foot">
              <button type="button" className="btn btn--primary btn--full abf-go" onClick={go} disabled={leaving}><span>{cta}</span></button>
              {after}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Countdown über dem Spiel: ein Ring läuft je Zahl ab, dann „Los“. step = Sekunden je Zahl (Abfahrt 0,75;
 * Zeitfahren 0,6). Vibriert leise, wo das Gerät es kann.
 */
export function Countdown({ count, step = 0.75 }: { count: number; step?: number }) {
  useEffect(() => {
    try { navigator.vibrate?.(count > 0 ? 10 : 24); } catch { /* egal */ }
  }, [count]);
  const R = 38;
  const C = 2 * Math.PI * R;
  const go = count <= 0;
  return (
    <div className="abf-count" aria-live="assertive">
      <div key={count} className={cx('abf-count__wrap', go && 'is-go')} style={{ '--step': `${step}s` } as CSSProperties}>
        <svg className="abf-count__ring" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r={R} className="abf-count__track" />
          <circle cx="42" cy="42" r={R} className="abf-count__arc" style={{ strokeDasharray: C }} />
        </svg>
        <span className="abf-count__n">{go ? 'Los' : count}</span>
      </div>
    </div>
  );
}

/**
 * Eine Zeile zur Bestenliste: die ersten drei als Köpfe, der eigene Platz, Pfeil – die ganze Liste öffnet sich
 * darüber (die Startseite zeigt die Liste schon ausführlich)
 */
export function BoardLink({ rows, label, members, meId, onOpen, fmt }: {
  rows: GameBest[]; label: string; members: Profile[]; meId: string; onOpen: () => void; fmt: (best: number) => string;
}) {
  const top = rows.slice(0, 3);
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const mine = myIdx >= 0 ? rows[myIdx] : null;
  return (
    <button type="button" className="abf-boardlink" onClick={onOpen} aria-label={`Bestenliste ${label} öffnen`}>
      <span className="abf-boardlink__avs" aria-hidden="true">
        {top.map((r) => { const m = members.find((x) => x.id === r.user_id); return <Avatar key={r.user_id} name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={22} />; })}
      </span>
      <span className="abf-boardlink__text">Bestenliste<small>{label}</small></span>
      {mine ? <span className="abf-boardlink__me">{myIdx + 1}. · {fmt(mine.best)}</span> : top.length ? null : <span className="abf-boardlink__me">noch leer</span>}
      <Icon name="chevron" size={16} className="muted" />
    </button>
  );
}
