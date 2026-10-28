/**
 * Die Europareise: alle Kilometer aus allen Minispielen (seit Eröffnung der Radgarage) landen auf einer
 * Route von Wuppertal den Rhein hinauf, über den Gotthard, durch die Po-Ebene und den Apennin, über Rom
 * und Neapel bis nach Sizilien – wie eine echte Radreise, Etappenort für Etappenort. Jeder sieht, wo er
 * steht; die Runde zusammen fährt auf derselben Strecke (und schafft sie deutlich öfter).
 */

export interface Stop {
  /** Ortsname */
  name: string;
  /** Kilometer ab Wuppertal (Straßenkilometer, gerundet) */
  km: number;
  /** DE, CH, IT */
  land: 'DE' | 'CH' | 'IT';
  /** Lage auf der stilisierten Karte (Länge, Breite in Grad) */
  lon: number;
  lat: number;
  /** eine Zeile für die Postkarte */
  note: string;
  /** Passhöhe (m) – dann ist es ein Pass, kein Ort */
  alt?: number;
  /** großer Etappenort (auf der Karte beschriftet) */
  major?: boolean;
  /** Lage der Beschriftung auf der Karte (Standard: rechts) */
  label?: 'left' | 'above' | 'below';
}

export const ROUTE: Stop[] = [
  { name: 'Wuppertal', km: 0, land: 'DE', lon: 7.15, lat: 51.26, note: 'Start unter der Schwebebahn – erst mal aus dem Tal raus', major: true },
  { name: 'Köln', km: 45, land: 'DE', lon: 6.96, lat: 50.94, note: 'Dom, Rhein, Kölsch – ab hier geht es flussaufwärts' },
  { name: 'Bonn', km: 75, land: 'DE', lon: 7.1, lat: 50.73, note: 'Rheinufer, Drachenfels am Horizont' },
  { name: 'Koblenz', km: 135, land: 'DE', lon: 7.59, lat: 50.36, note: 'Deutsches Eck – Mosel und Rhein treffen sich' },
  { name: 'Mainz', km: 230, land: 'DE', lon: 8.27, lat: 50.0, note: 'Rheinhessen, Riesling, der Fluss wird breit', major: true },
  { name: 'Heidelberg', km: 330, land: 'DE', lon: 8.69, lat: 49.4, note: 'Schloss und Neckar, dann die Bergstraße' },
  { name: 'Karlsruhe', km: 390, land: 'DE', lon: 8.4, lat: 49.01, note: 'Fächerstadt – die Rheinebene liegt flach vor dir' },
  { name: 'Freiburg', km: 540, land: 'DE', lon: 7.85, lat: 47.99, note: 'Bächle, Münster, der Schwarzwald rechts', major: true },
  { name: 'Basel', km: 610, land: 'CH', lon: 7.59, lat: 47.56, note: 'Dreiländereck – die Schweiz beginnt am Rheinknie' },
  { name: 'Luzern', km: 710, land: 'CH', lon: 8.31, lat: 47.05, note: 'Kapellbrücke, Vierwaldstättersee, Pilatus im Nacken', major: true },
  { name: 'Andermatt', km: 790, land: 'CH', lon: 8.59, lat: 46.63, note: 'Urserental – ab hier zählt nur noch der Pass' },
  { name: 'Gotthardpass', km: 805, land: 'CH', lon: 8.56, lat: 46.56, note: 'Tremola-Kehren auf Kopfsteinpflaster – der Alpenübergang', alt: 2106, major: true },
  { name: 'Bellinzona', km: 870, land: 'CH', lon: 9.02, lat: 46.19, note: 'Drei Burgen, Palmen, erstes Gelato' },
  { name: 'Como', km: 935, land: 'IT', lon: 9.09, lat: 45.81, note: 'Lago di Como – Italien, endlich', major: true },
  { name: 'Mailand', km: 985, land: 'IT', lon: 9.19, lat: 45.46, note: 'Duomo, Navigli, Espresso im Stehen' },
  { name: 'Pavia', km: 1020, land: 'IT', lon: 9.16, lat: 45.19, note: 'Ponte Coperto über den Ticino' },
  { name: 'Piacenza', km: 1070, land: 'IT', lon: 9.7, lat: 45.05, note: 'Über den Po – die Via Emilia beginnt' },
  { name: 'Parma', km: 1130, land: 'IT', lon: 10.33, lat: 44.8, note: 'Prosciutto, Parmigiano, Tortelli' },
  { name: 'Bologna', km: 1230, land: 'IT', lon: 11.34, lat: 44.49, note: 'Arkaden ohne Ende, Ragù, die Rote', major: true },
  { name: 'Passo della Futa', km: 1280, land: 'IT', lon: 11.28, lat: 44.09, note: 'Apennin – die Straße nach Florenz', alt: 903 },
  { name: 'Florenz', km: 1330, land: 'IT', lon: 11.26, lat: 43.77, note: 'Kuppel von Brunelleschi, Ponte Vecchio', major: true },
  { name: 'Siena', km: 1400, land: 'IT', lon: 11.33, lat: 43.32, note: 'Piazza del Campo – Strade Bianche ringsum' },
  { name: 'Montalcino', km: 1445, land: 'IT', lon: 11.49, lat: 43.06, note: 'Zypressen, Brunello, Val d’Orcia' },
  { name: 'Viterbo', km: 1570, land: 'IT', lon: 12.11, lat: 42.42, note: 'Papstpalast, Thermen – Latium' },
  { name: 'Rom', km: 1650, land: 'IT', lon: 12.5, lat: 41.9, note: 'Via Appia, Kolosseum, Pflaster überall', major: true },
  { name: 'Terracina', km: 1760, land: 'IT', lon: 13.25, lat: 41.29, note: 'Zurück ans Meer – Tyrrhenische Küste' },
  { name: 'Gaeta', km: 1800, land: 'IT', lon: 13.57, lat: 41.21, note: 'Sperlonga, Gaeta – Formia liegt gleich dahinter' },
  { name: 'Neapel', km: 1870, land: 'IT', lon: 14.27, lat: 40.85, note: 'Vesuv, Pizza, Via Acton am Hafen', major: true, label: 'left' },
  { name: 'Amalfi', km: 1930, land: 'IT', lon: 14.6, lat: 40.63, note: 'Costiera Amalfitana – Kurve um Kurve über dem Meer' },
  { name: 'Paestum', km: 2000, land: 'IT', lon: 15.0, lat: 40.42, note: 'Griechische Tempel, Büffelmozzarella' },
  { name: 'Maratea', km: 2130, land: 'IT', lon: 15.72, lat: 39.99, note: 'Basilikata – Christusstatue hoch über der Küste' },
  { name: 'Cosenza', km: 2250, land: 'IT', lon: 16.25, lat: 39.3, note: 'Kalabrien, Sila-Gebirge – es wird einsam' },
  { name: 'Reggio Calabria', km: 2440, land: 'IT', lon: 15.65, lat: 38.11, note: 'Die Stiefelspitze – Sizilien zum Greifen nah', major: true, label: 'above' },
  { name: 'Messina', km: 2450, land: 'IT', lon: 15.55, lat: 38.19, note: 'Mit der Fähre über die Straße von Messina' },
  { name: 'Taormina', km: 2500, land: 'IT', lon: 15.29, lat: 37.85, note: 'Antikes Theater, Blick auf den Ätna' },
  { name: 'Ätna', km: 2560, land: 'IT', lon: 15.0, lat: 37.7, note: 'Rifugio Sapienza – Lava, Wind, 1.910 m', alt: 1910, major: true, label: 'below' },
  { name: 'Catania', km: 2600, land: 'IT', lon: 15.09, lat: 37.5, note: 'Fischmarkt, schwarzer Lavastein' },
  { name: 'Syrakus', km: 2660, land: 'IT', lon: 15.29, lat: 37.07, note: 'Ortigia – Piazza Duomo im Abendlicht' },
  { name: 'Agrigent', km: 2820, land: 'IT', lon: 13.58, lat: 37.31, note: 'Tal der Tempel' },
  { name: 'Palermo', km: 2960, land: 'IT', lon: 13.36, lat: 38.12, note: 'Ziel: Palermo. Arancini, Markt, Meer – und von vorn', major: true, label: 'left' },
];

export const ROUTE_KM = ROUTE[ROUTE.length - 1].km;

export interface JourneyPos {
  /** Meter insgesamt */
  meters: number;
  /** wievielte Runde (1 = erste Reise) */
  lap: number;
  /** Kilometer innerhalb der Runde */
  km: number;
  /** letzter erreichter Ort (Index) */
  at: number;
  /** nächster Ort (Index) – gleich at am Ziel */
  next: number;
  /** Kilometer bis zum nächsten Ort */
  toNext: number;
  /** Anteil zwischen at und next (0–1) */
  frac: number;
  /** Lage auf der Karte (Länge, Breite) */
  lon: number;
  lat: number;
}

export function journeyAt(meters: number): JourneyPos {
  const total = Math.max(0, meters) / 1000;
  const lap = Math.floor(total / ROUTE_KM) + 1;
  const km = total - (lap - 1) * ROUTE_KM;
  let at = 0;
  for (let i = 0; i < ROUTE.length; i++) if (ROUTE[i].km <= km) at = i;
  const next = Math.min(ROUTE.length - 1, at + 1);
  const span = ROUTE[next].km - ROUTE[at].km;
  const frac = span > 0 ? Math.min(1, (km - ROUTE[at].km) / span) : 1;
  const a = ROUTE[at];
  const b = ROUTE[next];
  return {
    meters, lap, km, at, next,
    toNext: Math.max(0, ROUTE[next].km - km),
    frac,
    lon: a.lon + (b.lon - a.lon) * frac,
    lat: a.lat + (b.lat - a.lat) * frac,
  };
}

/** Stilisierte Karte: Grad → Bildkoordinaten (Hochformat, Alpen in der Mitte) */
export const MAP = { w: 320, h: 560 };
export function mapXY(lon: number, lat: number): [number, number] {
  const lon0 = 5.2;
  const lon1 = 17.4;
  const lat0 = 52.2;
  const lat1 = 36.3;
  const x = ((lon - lon0) / (lon1 - lon0)) * MAP.w;
  // Breite leicht gestaucht (Mercator-ähnlich reicht hier nicht, Hochformat zählt)
  const y = ((lat0 - lat) / (lat0 - lat1)) * MAP.h;
  return [x, y];
}

export const fmtKm = (km: number) => `${Math.floor(km).toLocaleString('de-DE')} km`;
