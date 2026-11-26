import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme } from './app/theme';
import './lib/install'; // Installations-Ereignis früh abfangen
import { BUILD_ID, source } from './app/config';
import { persistQueries } from './app/query';
import { installFixedHeal } from './ui/fixedHeal';
import { watchPushRenew } from './app/push';
import './styles.css';
import { LANG, loadDict, translateDom } from './lib/i18n';

applyTheme();
installFixedHeal();
// Zuletzt gesehener Stand sofort, frische Daten im Hintergrund (nicht im Demo-Modus)
if (source.mode !== 'demo') persistQueries(`gruppetto.cache.${BUILD_ID}`, /^(me:|tours$|tour:|members$|group$|game:|tippers:|news$|favorites$|emblems:)/);
document.documentElement.dataset.tour = document.documentElement.dataset.tour ?? 'neutral';

watchPushRenew();
const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
if (LANG === 'de') render();
else loadDict().then(translateDom, () => undefined).finally(render);
