import type {
  AdminUser, BonusCategory, BonusResult, Profile, Rider, Stage, Tour, TourData, StageKind, TourTheme,
} from '../lib/types';

export interface SessionUser {
  id: string;
  email: string;
}

export interface TourInput {
  id: string;
  name: string;
  short_name: string;
  theme: TourTheme;
  year: number;
  start_date: string;
  end_date: string;
  is_visible: boolean;
  bonus_final: boolean;
  pcs_slug: string | null;
}

export interface StageInput {
  number: number;
  starts_at: string;
  kind: StageKind;
  departure: string | null;
  arrival: string | null;
  distance_km: number | null;
}

export interface RiderInput {
  bib: number | null;
  name: string;
  team: string;
}

export type RiderPatch = Partial<Pick<Rider, 'bib' | 'name' | 'team' | 'tip_limit' | 'excluded_from_rest' | 'status'>>;

export interface BonusResultInput {
  position: number;
  rider_id: number | null;
  team: string | null;
}

/** Gemeinsame Schnittstelle für Supabase und den Demo-Modus. */
export interface DataSource {
  readonly mode: 'live' | 'demo';
  now(): number;

  // Anmeldung
  currentUser(): SessionUser | null;
  onAuthChange(cb: () => void): () => void;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;

  // Lesen
  loadMe(): Promise<Profile | null>;
  loadMembers(): Promise<Profile[]>;
  loadTours(): Promise<Tour[]>;
  loadTourData(tour: Tour): Promise<TourData>;
  stageTippers(stageId: number): Promise<string[]>;

  // Spieler
  joinGroup(code: string, name: string): Promise<void>;
  updateProfile(name: string, color: string): Promise<void>;
  deleteAccount(): Promise<void>;
  requestPro(request: boolean): Promise<void>;
  saveStageTip(stageId: number, riderId: number): Promise<void>;
  deleteStageTip(stageId: number): Promise<void>;
  saveBonusTip(tourId: string, category: BonusCategory, riderId: number | null, team: string | null): Promise<void>;
  deleteBonusTip(tourId: string, category: BonusCategory): Promise<void>;

  // Admin
  adminListUsers(): Promise<AdminUser[]>;
  adminSetFlags(userId: string, member: boolean, admin: boolean, pro: boolean): Promise<void>;
  getInviteCode(): Promise<string>;
  setInviteCode(code: string): Promise<void>;
  saveTour(tour: TourInput): Promise<void>;
  deleteTour(id: string): Promise<void>;
  saveStages(tourId: string, stages: StageInput[]): Promise<void>;
  updateStage(id: number, patch: Partial<StageInput>): Promise<void>;
  deleteStage(id: number): Promise<void>;
  importRiders(tourId: string, riders: RiderInput[]): Promise<void>;
  updateRider(id: number, patch: RiderPatch): Promise<void>;
  deleteRider(id: number): Promise<void>;
  setStageResults(stageId: number, riderIds: number[]): Promise<void>;
  setStagePublished(stageId: number, published: boolean): Promise<void>;
  setBonusResults(tourId: string, category: BonusResult['category'], entries: BonusResultInput[]): Promise<void>;
}

export type { Stage };

/** Fehler mit maschinenlesbarem Code aus der Datenbank (z. B. „joker_limit_reached“). */
export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  joker_limit_reached: 'Dein Joker-Limit für diesen Fahrer ist aufgebraucht.',
  rider_not_active: 'Dieser Fahrer ist nicht mehr im Rennen.',
  rider_not_in_tour: 'Dieser Fahrer fährt diese Rundfahrt nicht.',
  team_not_in_tour: 'Dieses Team fährt diese Rundfahrt nicht.',
  stage_not_started: 'Die Etappe ist noch nicht gestartet – Ergebnisse erst danach veröffentlichen.',
  invalid_code: 'Der Einladungscode stimmt nicht.',
  name_taken: 'Dieser Name ist schon vergeben.',
  invalid_name: 'Der Name muss 2 bis 20 Zeichen lang sein.',
  invalid_color: 'Ungültige Farbe.',
  not_admin: 'Dafür brauchst du Admin-Rechte.',
  cannot_remove_own_admin: 'Du kannst dir die Admin-Rechte nicht selbst entziehen.',
  not_authenticated: 'Bitte melde dich erneut an.',
  locked: 'Tippschluss ist vorbei – der Tipp kann nicht mehr geändert werden.',
};

/** Wandelt Fehler in einen verständlichen deutschen Satz um. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    for (const [key, text] of Object.entries(MESSAGES)) {
      if (err.message.includes(key) || err.code === key) return text;
    }
    if (err.message.includes('row-level security')) return MESSAGES.locked;
    if (err.status === 429 || /rate limit|over_email_send_rate_limit|security purposes/i.test(err.message)) {
      return 'Zu viele Versuche – bitte warte eine Minute und probier es dann erneut.';
    }
    if (/otp_expired|token has expired|invalid/i.test(err.message) && err.status && err.status < 500) {
      return 'Der Code ist falsch oder abgelaufen.';
    }
    if (err.code === '23505') return 'Das gibt es schon (doppelter Eintrag).';
    return err.message;
  }
  if (err instanceof TypeError) return 'Keine Verbindung – bitte prüfe dein Internet.';
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler';
}
