export type TourTheme = 'giro' | 'tour' | 'vuelta' | 'neutral';
export type StageKind = 'flat' | 'hilly' | 'mountain' | 'itt' | 'ttt';
export type BonusCategory =
  | 'gc' | 'rest' | 'points' | 'mountains' | 'youth' | 'combative' | 'stage_wins' | 'team';

export const BONUS_CATEGORIES: BonusCategory[] =
  ['gc', 'rest', 'points', 'mountains', 'youth', 'combative', 'stage_wins', 'team'];

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_color: string;
  is_member: boolean;
  is_admin: boolean;
  is_pro: boolean;
  /** Pro angefragt (keine Zahlung, nur Vermerk) */
  pro_requested_at?: string | null;
  created_at: string;
}

export interface AdminUser extends Profile {
  email: string;
}

export interface Tour {
  id: string;
  name: string;
  short_name: string;
  theme: TourTheme;
  year: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  is_visible: boolean;
  bonus_final: boolean;
  pcs_slug: string | null;
  /** Wie oft man denselben Fahrer pro Rundfahrt höchstens tippen darf (null = unbegrenzt) */
  tip_limit?: number | null;
  info?: TourInfo;
  /** Automatische Ergebnisse von procyclingstats.com: aus, als Vorschlag oder automatisch veröffentlichen */
  sync_mode?: SyncMode;
}

export type SyncMode = 'off' | 'draft' | 'auto';

/** Stand der Automatik für eine Etappe (nur für Admins sichtbar) */
export interface StageSyncInfo {
  stage_id: number;
  paused: boolean;
  paused_reason: string | null;
  checked_at: string | null;
  synced_at: string | null;
  status: string | null;
  source_url: string | null;
  last_error: string | null;
}

export interface SyncLogEntry {
  id: number;
  at: string;
  stage_id: number | null;
  level: 'info' | 'change' | 'warning' | 'error';
  message: string;
}

export interface SyncStatus {
  stages: StageSyncInfo[];
  log: SyncLogEntry[];
}

export interface Rider {
  id: number;
  tour_id: string;
  bib: number | null;
  name: string;
  team: string;
  tip_limit: number | null;
  excluded_from_rest: boolean;
  status: 'active' | 'out';
  /** ISO-Ländercode, z. B. 'DK' */
  nationality?: string | null;
  /** Alter beim Start der Rundfahrt */
  age?: number | null;
  /** startberechtigt in der Nachwuchswertung */
  young?: boolean;
  /** Verknüpfung zu den Fahrer-Stammdaten (für Favoriten über Rundfahrten hinweg) */
  cyclist_id?: number | null;
}

export interface StageStanding {
  stage_id: number;
  category: 'gc' | 'points' | 'mountains' | 'youth';
  position: number;
  rider_id: number;
}

export interface StageInfo {
  original_date?: string;
  start_real?: string;
  finish_real?: string;
  neutral_km?: number;
  three_sec?: boolean;
  /** Streckenbeschreibung und Finale (aus dem Roadbook) */
  route?: string;
  finale?: string;
  /** Verpflegungszonen, z. B. „36.6 - 70.6 - 103.1“ */
  feed?: string;
  /** Quelle der Streckenbeschreibung (ohne Angabe: Roadbook des Giro) */
  source?: string;
}

export interface TourInfo {
  kom?: Record<string, number[]>;
  sprint_points?: number[];
  finish_bonus?: number[];
  redbull_bonus?: number[];
  redbull_points?: number[];
  stage_points?: Record<string, number[]>;
}

/** Bergwertung: cat '1'–'4', 'HC' oder 'CC' (Cima Coppi) */
export interface Climb {
  name: string;
  cat: string;
  km: number;
  len?: number;
  grad?: number;
  /** Maximalsteigung in % */
  max?: number;
  /** Gipfelhöhe in m */
  alt?: number;
}

export interface Sprint {
  km: number;
  name?: string;
  /** 'sprint' = Zwischensprint (Punktewertung), 'redbull' = Red Bull KM (Zeitbonus) */
  kind?: 'sprint' | 'redbull';
}

export interface Stage {
  id: number;
  tour_id: string;
  number: number;
  starts_at: string; // ISO
  kind: StageKind;
  departure: string | null;
  arrival: string | null;
  distance_km: number | null;
  results_published: boolean;
  climbs?: Climb[];
  sprints?: Sprint[];
  elevation_m?: number | null;
  info?: StageInfo;
}

export interface StageTip {
  stage_id: number;
  user_id: string;
  rider_id: number;
  updated_at: string;
}

export interface StageResult {
  stage_id: number;
  position: number;
  rider_id: number;
}

export interface PointScale {
  position: number;
  points: number;
}

export interface BonusTip {
  tour_id: string;
  user_id: string;
  category: BonusCategory;
  rider_id: number | null;
  team: string | null;
}

export interface BonusResult {
  tour_id: string;
  category: Exclude<BonusCategory, 'stage_wins'>;
  position: number;
  rider_id: number | null;
  team: string | null;
}

/** Alles, was für eine Rundfahrt geladen wird (sichtbar laut RLS). */
export interface TourData {
  tour: Tour;
  stages: Stage[];
  riders: Rider[];
  tips: StageTip[];
  results: StageResult[];
  bonusTips: BonusTip[];
  bonusResults: BonusResult[];
  scale: PointScale[];
  /** Wertungsstände nach den Etappen (z. B. Gesamtwertung Top 10) */
  standings?: StageStanding[];
}
