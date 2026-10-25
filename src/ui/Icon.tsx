const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  flag: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  podium: 'M3 21h18M9 21V7h6v14M4 21v-8h5M15 21v-5h5v5',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  back: 'm15 18-6-6 6-6',
  chevron: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2',
  search: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-4-4',
  check: 'm5 12 5 5 9-10',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.6 12.6 0 0 1-2.7 3.5M6.5 7.6C4.6 8.9 3.2 10.7 2.5 12c1 2 4.5 6 9.5 6 1.6 0 3-.4 4.3-1',
  shirt: 'M8 3 4 5.5 2.5 10l3 1.5V21h13v-9.5l3-1.5L20 5.5 16 3a4 4 0 0 1-8 0z',
  flame: 'M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v5M8 21h8M9 18h6',
  users: 'M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2',
  pencil: 'M4 20h4L19 9l-4-4L4 16z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v7h14v-7',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  mountain: 'm3 19 6-10 4 6 2-3 6 7z',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v6M12 7.5v.5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 1.8, className, label }: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
