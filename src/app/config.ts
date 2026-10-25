import type { DataSource } from '../data/source';
import { SupabaseSource } from '../data/supabase';
import { DemoSource } from '../data/demo';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;
declare const __BUILD_ID__: string;

export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const URL_ = typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : '';
const KEY = typeof __SUPABASE_KEY__ === 'string' ? __SUPABASE_KEY__ : '';

export const LIVE_CONFIGURED = Boolean(URL_ && KEY);

function demoStart(): 'app' | 'login' | 'join' | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('demo');
  if (value === null) return null;
  return value === 'login' || value === 'join' ? value : 'app';
}

function createSource(): DataSource {
  const demo = demoStart();
  if (demo || !LIVE_CONFIGURED) {
    // ?demotime=2027-05-16T14:00 setzt die Demo-Uhr (zum Ausprobieren anderer Zustände)
    const time = new URLSearchParams(window.location.search).get('demotime');
    const base = time ? new Date(time).getTime() : NaN;
    return new DemoSource(demo ?? 'app', Number.isNaN(base) ? undefined : base);
  }
  return new SupabaseSource(URL_, KEY);
}

export const source: DataSource = createSource();
