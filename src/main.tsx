import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme } from './app/theme';
import './styles.css';

applyTheme();
document.documentElement.dataset.tour = document.documentElement.dataset.tour ?? 'neutral';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
