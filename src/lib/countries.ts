/** ISO-Ländercodes der Fahrer → deutscher Name */
export const COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra', AR: 'Argentinien', AT: 'Österreich', AU: 'Australien', BE: 'Belgien', BG: 'Bulgarien', BY: 'Belarus',
  CA: 'Kanada', CH: 'Schweiz', CL: 'Chile', CN: 'China', CO: 'Kolumbien', CR: 'Costa Rica', CZ: 'Tschechien', DE: 'Deutschland',
  DK: 'Dänemark', EC: 'Ecuador', EE: 'Estland', ER: 'Eritrea', ES: 'Spanien', ET: 'Äthiopien', FI: 'Finnland', FR: 'Frankreich',
  GB: 'Großbritannien', GR: 'Griechenland', HR: 'Kroatien', HU: 'Ungarn', IE: 'Irland', IL: 'Israel', IT: 'Italien', JP: 'Japan',
  KZ: 'Kasachstan', LT: 'Litauen', LU: 'Luxemburg', LV: 'Lettland', MA: 'Marokko', MT: 'Malta', MX: 'Mexiko', NL: 'Niederlande',
  NO: 'Norwegen', NZ: 'Neuseeland', PL: 'Polen', PT: 'Portugal', RO: 'Rumänien', RS: 'Serbien', RU: 'Russland', RW: 'Ruanda',
  SE: 'Schweden', SI: 'Slowenien', SK: 'Slowakei', UA: 'Ukraine', US: 'USA', UY: 'Uruguay', UZ: 'Usbekistan', VE: 'Venezuela',
  ZA: 'Südafrika',
};

/** Flaggen-Emoji aus dem Ländercode ('DK' → 🇩🇰) */
export function flag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  const up = code.toUpperCase();
  return String.fromCodePoint(base + up.charCodeAt(0) - 65, base + up.charCodeAt(1) - 65);
}

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}
