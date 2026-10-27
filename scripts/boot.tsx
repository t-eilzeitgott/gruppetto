// Startansicht für index.html: dieselben Platzhalter wie in der App, schon vor dem Laden des Skripts sichtbar.
// Wird beim Bauen (scripts/build.mjs) mit esbuild gebündelt und in Node gerendert.
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoBanner, ShellFrame } from '../src/ui/frame';
import { AppSkeleton, GameSkeleton, GarageSkeleton, PageSkeleton, SkelText } from '../src/ui/skeleton';

export function bootHtml(demo: boolean): string {
  const banner = demo ? <DemoBanner live={false} /> : null;
  const home = renderToStaticMarkup(<AppSkeleton parts={[]} banner={banner} />);
  // andere Seiten: Rahmen ohne markierten Tab (welcher, weiß erst die App), Titel und Karten
  const page = renderToStaticMarkup(
    <ShellFrame active="" banner={banner}>
      <header className="page-title"><div className="page-title__text"><SkelText w={160} size={30} /></div></header>
      <PageSkeleton />
    </ShellFrame>,
  );
  const full = renderToStaticMarkup(<GameSkeleton />);
  const garage = renderToStaticMarkup(<GarageSkeleton />);
  return `<div class="boot boot--home">${home}</div><div class="boot boot--page">${page}</div><div class="boot boot--full">${full}</div><div class="boot boot--garage">${garage}</div>`;
}
