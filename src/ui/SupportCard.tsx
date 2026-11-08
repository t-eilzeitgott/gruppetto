import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SUPPORT_EMBED, SUPPORT_ENABLED, SUPPORT_URL } from '../app/support';
import { Icon } from './Icon';
import { cx } from './kit';

/** Kachel „Gefällt dir gruppetto?“ – öffnet das Ko-fi-Formular als Sheet im App-Look */
export function SupportCard({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!SUPPORT_ENABLED) return null;
  return (
    <>
      <button type="button" className={cx('card card--row support', compact && 'support--compact')} onClick={() => setOpen(true)}>
        <span className="support__icon" aria-hidden="true"><Icon name="coffee" size={22} /></span>
        <span className="card__main">
          <strong>Gefällt dir gruppetto?</strong>
          <span className="muted">Das Tippspiel bleibt kostenlos. Ein Kaffee hilft beim Weiterbauen.</span>
        </span>
        <Icon name="chevron" className="muted" />
      </button>
      {open ? <SupportSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SupportSheet({ onClose }: { onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const closing = useRef(false);
  const timer = useRef(0);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setLeaving(true);
    timer.current = window.setTimeout(onClose, 220);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className={cx('lobby-layer', leaving && 'is-leaving')} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="lobby-sheet support-sheet" role="dialog" aria-modal="true" aria-labelledby="support-title">
        <div className="lobby-sheet__head">
          <span className="lobby-sheet__icon" aria-hidden="true"><Icon name="coffee" size={22} /></span>
          <div>
            <h2 id="support-title">Einen Kaffee?</h2>
            <p>gruppetto bleibt kostenlos. Ein Kaffee hilft beim Weiterbauen.</p>
          </div>
          <button type="button" className="lobby-sheet__x" onClick={close} aria-label="Schließen"><Icon name="x" size={20} /></button>
        </div>
        <div className={cx('support-frame', loaded && 'is-on')}>
          <span className="support-frame__wait"><Icon name="coffee" size={26} />Ko-fi lädt …</span>
          <iframe title="Ko-fi" src={SUPPORT_EMBED} onLoad={() => setLoaded(true)} referrerPolicy="no-referrer-when-downgrade" />
        </div>
        <a className="btn btn--secondary btn--sm support-sheet__ext" href={SUPPORT_URL} target="_blank" rel="noopener">
          <span>Auf ko-fi.com öffnen</span><Icon name="external" size={15} />
        </a>
      </div>
    </div>,
    document.body,
  );
}
