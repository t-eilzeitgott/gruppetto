/** App-Symbol des Spiels: Serpentine in den Farben der App */
export function GameIcon({ size = 44 }: { size?: number }) {
  return (
    <svg className="game-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="gi-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gi-top, #ff7ab6)" />
          <stop offset="1" stopColor="var(--gi-bottom, #7b2cbf)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#gi-sky)" />
      <path d="M0 30 L9 17 L15 24 L24 9 L33 21 L39 15 L48 26 V48 H0Z" fill="rgba(255,255,255,0.18)" />
      <path d="M24 9 L28.5 15.2 L25 13.6 L22 15.6 Z" fill="rgba(255,255,255,0.85)" />
      <path d="M31 14 C 40 16, 38 22, 26 23 C 12 24, 10 30, 22 32 C 34 34, 36 40, 20 47" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M31 14 C 40 16, 38 22, 26 23 C 12 24, 10 30, 22 32 C 34 34, 36 40, 20 47" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M31 14 C 40 16, 38 22, 26 23 C 12 24, 10 30, 22 32 C 34 34, 36 40, 20 47" fill="none" stroke="var(--gi-bottom, #7b2cbf)" strokeWidth="0.9" strokeDasharray="2 2.4" strokeLinecap="round" />
      <circle cx="16.5" cy="27.2" r="2.6" fill="#ffd23f" stroke="#fff" strokeWidth="1" />
    </svg>
  );
}
