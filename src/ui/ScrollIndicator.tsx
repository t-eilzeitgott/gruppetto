/**
 * Eigene, schlanke Scroll-Anzeige für Touch-Geräte: läuft nur zwischen Statusleiste und Tableiste
 * (die native von iOS reicht über die Tableiste), erscheint beim Scrollen und blendet danach aus.
 */
import { useEffect, useRef } from 'react';

export function ScrollIndicator({ tabbar }: { tabbar: boolean }) {
  const track = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = track.current;
    const th = thumb.current;
    if (!t || !th) return;
    let frame = 0;
    let hide = 0;
    let lastY = window.scrollY;
    const place = () => {
      frame = 0;
      const doc = document.documentElement;
      const view = window.innerHeight;
      const full = doc.scrollHeight;
      const max = full - view;
      const h = t.clientHeight;
      if (max <= 4 || h <= 0) { t.classList.remove('is-on'); return; }
      const size = Math.max(36, Math.round(h * (view / full)));
      // über die Ränder hinaus (Gummiband): Daumen staucht sich wie bei iOS
      const y = window.scrollY;
      const over = y < 0 ? -y : y > max ? y - max : 0;
      const s = Math.max(14, size - over);
      const pos = y <= 0 ? 0 : y >= max ? h - s : Math.round((h - size) * (y / max));
      th.style.height = `${s}px`;
      th.style.transform = `translateY(${pos}px)`;
    };
    const onScroll = () => {
      if (Math.abs(window.scrollY - lastY) < 1) return;
      lastY = window.scrollY;
      if (!frame) frame = requestAnimationFrame(place);
      t.classList.add('is-on');
      window.clearTimeout(hide);
      hide = window.setTimeout(() => t.classList.remove('is-on'), 900);
    };
    const onResize = () => { if (!frame) frame = requestAnimationFrame(place); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    place();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
      window.clearTimeout(hide);
    };
  }, []);

  return (
    <div ref={track} className={tabbar ? 'scrollbar' : 'scrollbar scrollbar--full'} aria-hidden="true">
      <div ref={thumb} className="scrollbar__thumb" />
    </div>
  );
}
