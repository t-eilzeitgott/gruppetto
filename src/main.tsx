import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme } from './app/theme';
import './lib/install'; // Installations-Ereignis früh abfangen
import { BUILD_ID, source } from './app/config';
import { persistQueries } from './app/query';
import './styles.css';

applyTheme();
// Zuletzt gesehener Stand sofort, frische Daten im Hintergrund (nicht im Demo-Modus)
if (source.mode !== 'demo') persistQueries(`gruppetto.cache.${BUILD_ID}`, /^(me:|tours$|tour:|members$|game:|tippers:)/);
document.documentElement.dataset.tour = document.documentElement.dataset.tour ?? 'neutral';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
