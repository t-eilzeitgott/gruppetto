/**
 * Symbole der Spiele und Bereiche: eine ruhige Glyphe in einer Farbe auf einer dezent getönten Kachel – gleiche
 * Strichstärke, runde Enden, keine Verläufe. Die Farben kommen aus dem Stylesheet (.gi--…), hell wie dunkel.
 */
import type { ReactNode } from 'react';
import type { GameId } from '../data/source';

export type AreaId = 'garage' | 'reise' | 'paesse';

/** Kachel mit Glyphe (viewBox 48, Striche 3 breit) */
function Tile({ kind, size, children, label }: { kind: string; size: number; children: ReactNode; label?: string }) {
  return (
    <svg className={`gi gi--${kind}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      <rect width="48" height="48" rx="13" fill="var(--gi-tint)" />
      <g fill="none" stroke="var(--gi-hue)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{children}</g>
    </svg>
  );
}

/** Abfahrt: das Gefälle (wie auf dem Verkehrsschild), der Fahrer oben am Hang */
export function GameIcon({ size = 44 }: { size?: number }) {
  return (
    <Tile kind="abfahrt" size={size}>
      <path d="M11 15 37 34H11z" />
      <circle cx="18" cy="20" r="2.4" fill="var(--gi-hue)" stroke="none" />
    </Tile>
  );
}

/** Sprintfinale: die Ziellinie */
export function SprintIcon({ size = 44 }: { size?: number }) {
  const cells: ReactNode[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) cells.push(<rect key={`${r}${c}`} x={10 + c * 7} y={17 + r * 7} width="7" height="7" rx="0.8" fill="var(--gi-hue)" stroke="none" />);
  return (
    <Tile kind="sprint" size={size}>
      {cells}
    </Tile>
  );
}

/** Bergfinale: zwei Gipfel */
export function BergIcon({ size = 44 }: { size?: number }) {
  return (
    <Tile kind="berg" size={size}>
      <path d="M7 35 18.5 16l6 9.5M18 35h23l-9.5-15-4.6 7" />
      <path d="M7 35h11" />
    </Tile>
  );
}

/** Zeitfahren: die Stoppuhr */
export function ZeitIcon({ size = 44 }: { size?: number }) {
  return (
    <Tile kind="tt" size={size}>
      <circle cx="24" cy="27" r="11.5" />
      <path d="M24 27l5.5-5.5M21 10h6M24 10v5.5" />
    </Tile>
  );
}

/** Symbol eines Spiels nach Kennung */
export function GameBadge({ game, size = 20 }: { game: GameId; size?: number }) {
  return game === 'sprint' ? <SprintIcon size={size} /> : game === 'berg' ? <BergIcon size={size} /> : game === 'zeitfahren' ? <ZeitIcon size={size} /> : <GameIcon size={size} />;
}

/** Bereiche: Radgarage (Rad), Europareise (Weg mit Ziel), Passbuch (Stempel mit Pass) */
export function AreaIcon({ area, size = 40 }: { area: AreaId; size?: number }) {
  if (area === 'garage') {
    return (
      <Tile kind="area" size={size}>
        <circle cx="14" cy="30" r="6.5" />
        <circle cx="34" cy="30" r="6.5" />
        <path d="M14 30l6-12h12M20 18l6 12h8M26 30l-6.5-12M31 14h4" />
      </Tile>
    );
  }
  if (area === 'reise') {
    return (
      <Tile kind="area" size={size}>
        <path d="M11 36c9 0 9-17 19-17" />
        <circle cx="11" cy="36" r="3" fill="var(--gi-hue)" stroke="none" />
        <path d="M36 11a5.5 5.5 0 0 0-5.5 5.5c0 4.2 5.5 9.5 5.5 9.5s5.5-5.3 5.5-9.5A5.5 5.5 0 0 0 36 11z" />
      </Tile>
    );
  }
  return (
    <Tile kind="area" size={size}>
      <circle cx="24" cy="24" r="15.5" strokeDasharray="2.2 3.4" strokeWidth="2.2" />
      <path d="M14 30l6-9 4 5.5 3-4 7 7.5" />
    </Tile>
  );
}

/** Symbol von „Akku leer!“: Akku mit Blitz */
export function AkkuIcon({ size = 44 }: { size?: number }) {
  return (
    <Tile kind="akku" size={size}>
      <rect x="9" y="16" width="26" height="16" rx="3.5" />
      <path d="M38 21v6" />
      <path d="M24 18.5 20.5 25h6L23 30" strokeWidth="2.4" />
    </Tile>
  );
}
