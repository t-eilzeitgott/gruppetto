import type { BonusCategory, TourTheme } from './types';

export interface CategoryInfo {
  label: string;
  /** Trikotname je Rundfahrt, falls es eines gibt */
  jersey?: Partial<Record<TourTheme, string>>;
  icon: 'shirt' | 'flame' | 'trophy' | 'users';
  hint?: string;
}

export const CATEGORY_INFO: Record<BonusCategory, CategoryInfo> = {
  gc: { label: 'Gesamtwertung', icon: 'shirt', jersey: { giro: 'Maglia rosa', tour: 'Maillot jaune', vuelta: 'Maillot rojo' } },
  rest: { label: 'Best of the Rest', icon: 'shirt', hint: 'Gesamtwertung ohne die ausgeklammerten Favoriten' },
  points: { label: 'Punktewertung', icon: 'shirt', jersey: { giro: 'Maglia ciclamino', tour: 'Maillot vert', vuelta: 'Maillot verde' } },
  mountains: { label: 'Bergwertung', icon: 'shirt', jersey: { giro: 'Maglia azzurra', tour: 'Maillot à pois', vuelta: 'Maillot de lunares' } },
  youth: { label: 'Nachwuchswertung', icon: 'shirt', jersey: { giro: 'Maglia bianca', tour: 'Maillot blanc', vuelta: 'Maillot blanco' } },
  combative: { label: 'Kämpferischster Fahrer', icon: 'flame', hint: 'Meist nur ein Preisträger: 15 Punkte oder 0' },
  stage_wins: { label: 'Meiste Etappensiege', icon: 'trophy', hint: 'Wird automatisch aus den Etappen berechnet' },
  team: { label: 'Bestes Team', icon: 'users' },
};

export type TileStyle = { background: string; color: string; border?: string; pattern?: 'dots-red' | 'dots-blue' };

/** Farbe der Kachel je Wertung und Rundfahrt. */
export function categoryTile(category: BonusCategory, theme: TourTheme): TileStyle {
  const neutral: TileStyle = { background: 'var(--surface2)', color: 'var(--text)' };
  switch (category) {
    case 'gc':
      if (theme === 'tour') return { background: '#FFD23F', color: '#3A2E00' };
      if (theme === 'vuelta') return { background: '#E5322D', color: '#FFFFFF' };
      if (theme === 'giro') return { background: '#F7A1C4', color: '#3A1027' };
      return neutral;
    case 'points':
      if (theme === 'giro') return { background: '#9B2D86', color: '#FFFFFF' };
      if (theme === 'tour' || theme === 'vuelta') return { background: '#1E9E4A', color: '#FFFFFF' };
      return neutral;
    case 'mountains':
      if (theme === 'giro') return { background: '#1E88E5', color: '#FFFFFF' };
      if (theme === 'tour') return { background: '#FFFFFF', color: '#C62828', border: 'var(--line)', pattern: 'dots-red' };
      if (theme === 'vuelta') return { background: '#FFFFFF', color: '#1E5FBF', border: 'var(--line)', pattern: 'dots-blue' };
      return neutral;
    case 'youth':
      return theme === 'neutral' ? neutral : { background: '#FFFFFF', color: '#111111', border: 'var(--line)' };
    case 'combative':
      return { background: 'var(--surface2)', color: '#F07B2F' };
    case 'rest':
      return { background: 'var(--surface2)', color: 'var(--accent)' };
    default:
      return neutral;
  }
}

export function categoryTitle(category: BonusCategory, theme: TourTheme): string {
  const info = CATEGORY_INFO[category];
  const jersey = info.jersey?.[theme];
  return jersey ? `${info.label} · ${jersey}` : info.label;
}
