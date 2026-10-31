/**
 * Kopf eines Spiels: Symbol, Name, Strecke des Tages – auf der Startseite (Spielkarte) und im Startblatt des Spiels
 * derselbe Aufbau, damit er beim Wechsel ins Spiel an seinen Platz fliegen kann (handoff.ts).
 */
import type { ReactNode, RefObject } from 'react';
import type { GameId } from '../data/source';
import { GameBadge } from './GameIcon';
import { cx } from './kit';

export function GameHead({ game, title, sub, tag, extra, className, as = 'strong', ref }: {
  game: GameId;
  title: string;
  sub: ReactNode;
  /** neben dem Namen (z. B. „Neu“) */
  tag?: ReactNode;
  /** darunter (z. B. „Echtes Finale …“) */
  extra?: ReactNode;
  className?: string;
  as?: 'h1' | 'strong';
  ref?: RefObject<HTMLDivElement | null> | ((el: HTMLDivElement | null) => void);
}) {
  const Title = as;
  return (
    <div ref={ref} className={cx('ghead', className)}>
      <GameBadge game={game} size={44} />
      <div className="ghead__text">
        <Title className="ghead__title">{title}{tag}</Title>
        <span className="ghead__sub">{sub}</span>
        {extra}
      </div>
    </div>
  );
}
