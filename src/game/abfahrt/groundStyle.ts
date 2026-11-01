/**
 * Böden je Gegend: welcher Asphalt, welches Pflaster, welche Gehwege, Bordsteine, Rinnen und Schachtdeckel zu
 * einer Region gehören – Porphyr in Südtirol, Sampietrini an der Küste, Steinplatten mit Steinmetzrillen in der
 * Toskana, Calade in der Provence, Pavé und Klinker im Norden, Adoquines und Panots in Spanien. Je Region zwei
 * Gehwege (Orte wechseln zwischen beiden), damit nicht jedes Dorf gleich aussieht.
 */
import type { AsphaltTone, CobbleKind, CoverLang, CurbKind, GutterKind, VergeKind, WalkKind } from './groundTex';
import type { Region } from './region';

export interface GroundStyle {
  asphalt: AsphaltTone;
  cobble: CobbleKind;
  walk: [WalkKind, WalkKind];
  curb: CurbKind;
  gutter: GutterKind;
  verge: VergeKind;
}

export const GROUND_STYLES: Record<Region, GroundStyle> = {
  dolomiten: { asphalt: 'cool', cobble: 'porfido', walk: ['opus', 'lastre'], curb: 'granite', gutter: 'porphyry', verge: 'soil' },
  suedtirol: { asphalt: 'cool', cobble: 'porfido', walk: ['opus', 'mosaic'], curb: 'porphyry', gutter: 'porphyry', verge: 'soil' },
  po: { asphalt: 'warm', cobble: 'ciottoli', walk: ['lastre', 'slabs'], curb: 'granite', gutter: 'setts', verge: 'soil' },
  toskana: { asphalt: 'warm', cobble: 'lastricato', walk: ['lastre', 'enrobe'], curb: 'limestone', gutter: 'concrete', verge: 'gravel' },
  riviera: { asphalt: 'light', cobble: 'sampietrini', walk: ['lastre', 'mosaic'], curb: 'travertine', gutter: 'concrete', verge: 'gravel' },
  apennin: { asphalt: 'warm', cobble: 'sampietrini', walk: ['lastre', 'slabs'], curb: 'travertine', gutter: 'setts', verge: 'gravel' },
  alpen: { asphalt: 'cool', cobble: 'setts', walk: ['enrobe', 'slabs'], curb: 'granite', gutter: 'setts', verge: 'soil' },
  pyrenaeen: { asphalt: 'cool', cobble: 'setts', walk: ['slabs', 'lastre'], curb: 'granite', gutter: 'setts', verge: 'soil' },
  provence: { asphalt: 'light', cobble: 'ciottoli', walk: ['enrobe', 'lastre'], curb: 'limestone', gutter: 'pebbles', verge: 'gravel' },
  nord: { asphalt: 'dark', cobble: 'pave', walk: ['brick', 'slabs'], curb: 'bluestone', gutter: 'setts', verge: 'soil' },
  spanien: { asphalt: 'light', cobble: 'adoquin', walk: ['panot', 'slabs'], curb: 'concrete', gutter: 'concrete', verge: 'gravel' },
  andalusien: { asphalt: 'light', cobble: 'ciottoli', walk: ['panot', 'mosaic'], curb: 'limestone', gutter: 'pebbles', verge: 'gravel' },
};

/** Sprache der Aufschriften auf den Schachtdeckeln */
export function coverLang(lang: string): CoverLang {
  return lang === 'fr' || lang === 'es' || lang === 'en' ? lang : 'it';
}
