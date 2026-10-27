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

/** Symbol des Bergfinales: Gipfel mit Serpentinen und Bergwertungs-Fähnchen */
export function BergIcon({ size = 44 }: { size?: number }) {
  const id = `gb-${useId().replace(/:/g, '')}`;
  return (
    <svg className="game-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gi-top, #ff7ab6)" />
          <stop offset="1" stopColor="var(--gi-bottom, #7b2cbf)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id})`} />
      <path d="M2 44 L20 14 L27 24 L32 17 L46 44 Z" fill="rgba(255,255,255,0.9)" />
      <path d="M20 14 L24.5 21.5 L21.5 20 L18.5 22.5 L16.8 19.4 Z" fill="var(--gi-bottom, #7b2cbf)" opacity="0.35" />
      <path d="M12 44 C 20 41, 30 40, 26 36 C 22 32, 16 33, 21 29 C 25 26, 27 26, 23 23 L21 20" fill="none" stroke="var(--gi-bottom, #7b2cbf)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 14 V5" stroke="#16171a" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M20 5.2 H29 V11 H20 Z" fill="#ffffff" stroke="#16171a" strokeWidth="0.8" />
      {[[22.2, 7], [26.6, 7], [24.4, 9.3]].map(([cx, cy]) => <circle key={`${cx}`} cx={cx} cy={cy} r="1.15" fill="#e5484d" />)}
    </svg>
  );
}

/** Symbol eines Minispiels nach seiner Kennung (für Bestenliste und Spielübersicht) */
export function GameBadge({ game, size = 20 }: { game: GameId; size?: number }) {
  return game === 'sprint' ? <SprintIcon size={size} /> : game === 'berg' ? <BergIcon size={size} /> : <GameIcon size={size} />;
}

/** Symbol von „Akku leer!“: leerer Akku, getroffen */
export function AkkuIcon({ size = 44 }: { size?: number }) {
  const id = `ga-${useId().replace(/:/g, '')}`;
  return (
    <svg className="game-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--gi-top, #ff7ab6)" />
          <stop offset="1" stopColor="var(--gi-bottom, #7b2cbf)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id})`} />
      <path d="M0 36 L12 28 L22 33 L34 24 L48 31 V48 H0Z" fill="rgba(255,255,255,0.16)" />
      <rect x="8.5" y="17" width="25" height="15" rx="4" fill="rgba(0,0,0,0.28)" stroke="#ffffff" strokeWidth="2.6" />
      <rect x="34.6" y="21.5" width="3.4" height="6" rx="1.2" fill="#ffffff" />
      <rect x="11.8" y="20.3" width="4.6" height="8.4" rx="1.2" fill="#ff5a4f" />
      <path d="M38.5 5.5 l1.9 4.6 4.8 0.6-3.6 3.2 1 4.8-4.1-2.5-4.2 2.5 1.1-4.8-3.6-3.2 4.8-0.6z" fill="#ffd23f" stroke="#ffffff" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="29" cy="11.5" r="4.2" fill="#2fb24c" stroke="#ffffff" strokeWidth="1.4" />
      <path d="M18 9 h6 M16.5 12.5 h7 M18.5 16 h5" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
