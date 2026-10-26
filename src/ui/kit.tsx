import { useEffect, useState, useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';
import { goBack, navigate } from '../app/router';
import { Icon, type IconName } from './Icon';
import { categoryTile, CATEGORY_INFO } from '../lib/categories';
import type { BonusCategory, TourTheme } from '../lib/types';
import { errorText } from '../data/source';
import { fmtDuration } from '../lib/time';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Ästhetisches Pro-Abzeichen */
export function ProBadge({ large }: { large?: boolean }) {
  return (
    <span className={cx('pro-badge', large && 'pro-badge--lg')} title="Pro-Mitglied">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" /></svg>
      Pro
    </span>
  );
}

/** Interner Link (Hash-Routing mit eigener History). */
export function Link({ to, className, children, ariaLabel, ariaCurrent, onNavigate }: {
  to: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  ariaCurrent?: 'page';
  /** wird vor dem Wechsel aufgerufen (z. B. um einen Hinweis als gesehen zu markieren) */
  onNavigate?: () => void;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onNavigate?.();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={`#${to}`} className={className} onClick={onClick} aria-label={ariaLabel} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export function Avatar({ name, color, size = 36, ring }: {
  name: string | null | undefined;
  color: string;
  size?: number;
  ring?: 'accent' | 'line';
}) {
  return (
    <span
      className={cx('avatar', ring && `avatar--ring-${ring}`)}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled, busy, full, icon, size }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  busy?: boolean;
  full?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, full && 'btn--full', size === 'sm' && 'btn--sm')}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function LinkButton({ to, children, variant = 'primary', full, icon }: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  full?: boolean;
  icon?: IconName;
}) {
  return (
    <Link to={to} className={cx('btn', `btn--${variant}`, full && 'btn--full')}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </Link>
  );
}

/** Kopfzeile für Unterseiten mit Zurück-Pfeil. */
export function TopBar({ title, subtitle, back, action }: {
  title: string;
  subtitle?: string;
  back: string;
  action?: ReactNode;
}) {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={() => goBack(back)} aria-label="Zurück">
        <Icon name="back" size={24} />
      </button>
      <div className="topbar__title">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="topbar__action">{action}</div>
    </header>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-title">
      <div className="page-title__text">
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="page-title__action">{action}</div> : null}
    </header>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx('segmented__item', o.value === value && 'is-active')}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ label = 'Lädt …' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice notice--error" role="alert">
      <Icon name="info" />
      <div className="notice__body">
        <p>{errorText(error)}</p>
        {onRetry ? <button type="button" className="text-btn" onClick={onRetry}>Erneut versuchen</button> : null}
      </div>
    </div>
  );
}

export function Notice({ icon = 'info', children, tone }: { icon?: IconName; children: ReactNode; tone?: 'accent' | 'error' }) {
  return (
    <div className={cx('notice', tone && `notice--${tone}`)}>
      <Icon name={icon} />
      <div className="notice__body">{children}</div>
    </div>
  );
}

export function Empty({ icon = 'flag', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <h2>{title}</h2>
      {children ? <div className="muted">{children}</div> : null}
    </div>
  );
}

export function Countdown({ to, now, prefix = 'noch ' }: { to: string | Date; now: number; prefix?: string }) {
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span>vorbei</span>;
  return <span>{prefix}{fmtDuration(ms)}</span>;
}

export function JerseyTile({ category, theme, size = 40 }: { category: BonusCategory; theme: TourTheme; size?: number }) {
  const tile = categoryTile(category, theme);
  return (
    <span
      className={cx('tile', tile.pattern && `tile--${tile.pattern}`)}
      style={{ width: size, height: size, background: tile.background, color: tile.color, borderColor: tile.border ?? 'transparent' }}
      aria-hidden="true"
    >
      <Icon name={CATEGORY_INFO[category].icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

// ---------- Toast ----------

let toastText: string | null = null;
let toastTimer: number | undefined;
const toastListeners = new Set<() => void>();

export function toast(text: string) {
  toastText = text;
  toastListeners.forEach((cb) => cb());
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastText = null;
    toastListeners.forEach((cb) => cb());
  }, 2600);
}

export function ToastHost() {
  const text = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastText,
  );
  return (
    <div className="toast-host" aria-live="polite">
      {text ? <div className="toast"><Icon name="check" size={18} /><span>{text}</span></div> : null}
    </div>
  );
}

/** Führt eine asynchrone Aktion aus und merkt sich Lade- und Fehlerzustand. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Setzt den Dokumenttitel. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · gruppetto` : 'gruppetto';
  }, [title]);
}
