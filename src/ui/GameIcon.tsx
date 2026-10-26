import { useId } from 'react';
import type { GameId } from '../data/source';

/** App-Symbol des Spiels: Serpentine in den Farben der App */
export function GameIcon({ size = 44 }: { size?: number }) {
  const id = `gi-${useId().replace(/:/g, '')}`;
  return (
    <svg className="game-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gi-top, #ff7ab6)" />
          <stop offset="1" stopColor="var(--gi-bottom, #7b2cbf)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id})`} />
      <path d="M0 30 L9 17 L15 24 L24 9 L33 21 L39 15 L48 26 V48 H0Z" fill="rgba(255,255,255,0.18)" />
      <path d="M24 9 L28.5 15.2 L25 13.6 L22 15.6 Z" fill="rgba(255,255,255,0.85)" />
      <path d="M31 14 C 40 16, 38 22, 26 23 C 12 24, 10 30, 22 32 C 34 34, 36 40, 20 47" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M31 14 C 40 16, 38 22, 26 23 C 12 24, 10 30, 22 32 C 34 34, 36 40, 20 47" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M31 14 C 40 16, 38 22, 26 23 C 12 24, 10 30, 22 32 C 34 34, 36 40, 20 47" fill="none" stroke="var(--gi-bottom, #7b2cbf)" strokeWidth="0.9" strokeDasharray="2 2.4" strokeLinecap="round" />
      <circle cx="16.5" cy="27.2" r="2.6" fill="#ffd23f" stroke="#fff" strokeWidth="1" />
    </svg>
  );
}

/** Symbol des Sprintfinales: Zielgerade mit Zielbogen */
export function SprintIcon({ size = 44 }: { size?: number }) {
  const id = `gs-${useId().replace(/:/g, '')}`;
  return (
    <svg className="game-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--gi-top, #ff7ab6)" />
          <stop offset="1" stopColor="var(--gi-bottom, #7b2cbf)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id})`} />
      <path d="M19 22 L29 22 L44 48 H4 Z" fill="rgba(0,0,0,0.22)" />
      <path d="M24 24 V48" stroke="rgba(255,255,255,0.55)" strokeWidth="1.6" strokeDasharray="3 3" />
      <path d="M8 26 V11 H40 V26" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round" />
      <rect x="9.5" y="11" width="29" height="7" fill="#ffffff" />
      <path d="M9.5 18 h29" stroke="var(--gi-bottom, #7b2cbf)" strokeWidth="0.8" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={i} x={9.5 + i * 3.625} y={i % 2 ? 11 : 14.5} width="3.625" height="3.5" fill="#16171a" />
      ))}
      <path d="M13 37 h22" stroke="#ffffff" strokeWidth="3" />
      <path d="M13 37 h22" stroke="#16171a" strokeWidth="3" strokeDasharray="2.75 2.75" />
      <circle cx="28" cy="31" r="2.6" fill="#ffd23f" stroke="#fff" strokeWidth="1" />
    </svg>
  );
}

/** Symbol eines Minispiels nach seiner Kennung (für Bestenliste und Spielübersicht) */
export function GameBadge({ game, size = 20 }: { game: GameId; size?: number }) {
  return game === 'sprint' ? <SprintIcon size={size} /> : <GameIcon size={size} />;
}
