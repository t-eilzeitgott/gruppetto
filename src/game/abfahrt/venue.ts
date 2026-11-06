/**
 * Schauplatz des Tages: An jedem Etappentag von Giro und Tour 2027 tragen alle Minispiele das Ortsbild der Etappe –
 * Häuser, Kirchen, Dächer, Pflaster, Laternen, Straßenbäume, Straßenmöbel, Schilder, Ortsnamen, Fahnen und
 * Wahrzeichen. Berge, Gelände und Streckenführung bleiben, wie sie sind (alle fahren dieselbe Strecke).
 *
 * Ortsbild (Scape): wie eine Gegend gebaut ist. Schauplatz (Venue): eine Etappe mit ihrem Ortsbild, dem Zielort,
 * den Wahrzeichen und echten Orts-, Tal- und Passnamen der Gegend.
 *
 * Vorschau: ?etappe=tour-2027:21 oder die Auswahl im Startblatt (Admins, localStorage) – gilt für alle Spiele.
 */
import type { Climb } from '../../lib/types';
import type { Lang } from './facade';
import type { Region } from './region';

/** Grundbauweise: Kirchturm, Rathaus, Laternen, Straßenschilder, Fahnen */
export type Country = 'it' | 'si' | 'fr' | 'uk';

/** Hausstile (Schlüssel aus STYLE in facade.ts) */
export type StyleKey = 'ocker' | 'lachs' | 'creme' | 'gelb' | 'haussmann' | 'terrakotta' | 'chalet' | 'bruchstein' | 'fachwerk' | 'backstein';

/** Laternen, Kirchtürme, Straßenbäume, Straßenmöbel – werden schrittweise eigens gebaut */
export type LampKind = 'it' | 'fr' | 'paris' | 'uk';
export type ChurchKind = 'campanile' | 'clocher' | 'tower' | 'chapel';
export type RoofKind = 'tile' | 'slate' | 'zinc' | 'lauze';

export interface Scape {
  id: string;
  /** für die Startkarte: „Paris“, „Bretagne“ */
  label: string;
  country: Country;
  /** Sprache der Schilder und Straßenmalereien */
  lang: Lang;
  /** Landschaft (Bäume, Felder, Küste) */
  region: Region;
  /** Hausstile in Orten (Gewichte) */
  styles: [StyleKey, number][];
  /** Anteil Berghäuser (Chalet, Bruchstein) in Weilern und Bergdörfern */
  alpine: number;
  /** Geschosse über dem Erdgeschoss in der Stadt (von … bis) */
  floors?: [number, number];
  roof: RoofKind;
  church: ChurchKind;
  lamp: LampKind;
  /** Straßenbäume in den Orten (Platanen, Kastanien, Pinien) */
  alley?: 'plane' | 'chestnut' | 'pine' | 'lime' | 'palm';
  /** Anteil Pflaster in den Ortsdurchfahrten (0 … 1) */
  cobble?: number;
  /** Boulevard: im Sprint- und Zeitfahrziel breite Gehwege mit Baumreihen, Häuser weiter zurück */
  boulevard?: boolean;
  /** Straßenmöbel der Gegend (Litfaßsäulen, Kioske, Brunnen) */
  furniture?: ('morris' | 'kiosk' | 'wallace')[];
  /** Fahnen am Straßenrand (Ländercodes und Regionen: fr, bzh, eus, cym, sco, …) */
  flags: string[];
  /** Namen für Abschnitte, Weiler und Pässe (die Abfahrt und Zwischenorte) */
  names: NameSet;
}

export interface NameSet {
  villages: string[];
  valleys: string[];
  forests: string[];
  lakes: string[];
  hills: string[];
  passes: [string, number][];
}

/** Wahrzeichen, die in der Welt stehen (werden Ort für Ort gebaut; was noch fehlt, bleibt unsichtbar) */
export type Mark =
  // Paris
  | 'arc' | 'eiffel' | 'obelisk' | 'sacreCoeur' | 'seine' | 'montmartre'
  // Frankreich
  | 'chambord' | 'angers' | 'albi' | 'sernin' | 'marteau' | 'elephants' | 'peyrou' | 'palaisIsle' | 'montBlanc' | 'geant'
  | 'calvaire' | 'menhir' | 'montStMichel' | 'gatteville' | 'harbour' | 'fronton' | 'bastide' | 'chateauPau' | 'mende' | 'etangs'
  // Großbritannien
  | 'liver' | 'albertDock' | 'cardiffCastle' | 'pierhead' | 'citadel' | 'carlisleCastle' | 'chapel' | 'drystone'
  // Italien und Slowenien
  | 'colosseo' | 'circoMassimo' | 'vittoriano' | 'duomoMilano' | 'tram' | 'autodromo' | 'circuit' | 'vesuvio' | 'castelOvo'
  | 'piazzaUnita' | 'faro' | 'miramare' | 'pretorio' | 'tempioCanova' | 'ghisallo' | 'acquedotto' | 'torri' | 'tricolore'
  | 'mura' | 'basilicaNorcia' | 'terme' | 'skiArea' | 'campana' | 'livenza' | 'monastero';

export interface Venue {
  /** „tour-2027:21“ */
  key: string;
  tourId: 'giro-2027' | 'tour-2027';
  stage: number;
  /** Ortsbild */
  scape: Scape;
  /** Zielort für Schilder und die Startkarte („Paris“) */
  place: string;
  /** eine Zeile für die Startkarte */
  blurb: string;
  marks: Mark[];
  /** echter Anstieg der Gegend für Berg und Zeitfahren, wenn die Etappe selbst keinen hat */
  climb?: Climb;
  /** echte Orte entlang der Etappe (vor den Ortsnamen der Gegend) */
  towns?: string[];
}

// ------------------------------------------------------------------ Namen

const FR_ALPS: [string, number][] = [
  ['Col du Galibier', 2642], ['Col de la Madeleine', 2000], ['Col de la Croix de Fer', 2067], ["Col de l'Iseran", 2764],
  ["Col d'Izoard", 2360], ['Col du Glandon', 1924], ['Col de la Colombière', 1618], ['Col des Aravis', 1486],
  ['Col de Joux Plane', 1691], ['Col du Pré', 1748], ['Cormet de Roselend', 1968], ['Col de la Loze', 2304],
  ['Col du Télégraphe', 1566], ['Col de Vars', 2108], ["Col d'Allos", 2247], ['Montée de Bisanne', 1723],
];
const FR_PYR: [string, number][] = [
  ['Col du Tourmalet', 2115], ["Col d'Aubisque", 1709], ['Col du Soulor', 1474], ["Col d'Aspin", 1489],
  ['Col de Peyresourde', 1569], ['Col du Portet', 2215], ["Hourquette d'Ancizan", 1564], ['Col de Marie Blanque', 1035],
  ['Col de Soudet', 1540], ['Port de Balès', 1755], ['Col de Menté', 1349], ["Col d'Azet", 1580],
  ['Col de Bagargui', 1327], ['Col de Burdincurutcheta', 1135], ['Col du Pourtalet', 1794], ['Col de Val Louron-Azet', 1580],
];
const FR_JURA: [string, number][] = [
  ['Grand Colombier', 1501], ['Col de la Faucille', 1323], ['Col de Richemond', 1036], ['Col de la Biche', 1316],
  ['Col du Berthiand', 780], ['Col de Bérentin', 1144], ['Col de Cuvéry', 1181], ['Col du Sappel', 1150],
];
const FR_MC: [string, number][] = [
  ['Col de la Lusette', 1351], ['Mont Aigoual', 1567], ['Col du Pas de Peyrol', 1589], ['Col de la Croix-Morand', 1401],
  ['Col du Vent', 703], ['Col de la Gravelle', 774], ['Col de Finiels', 1541], ['Col de la République', 1161],
  ["Signal d'Uchon", 635], ['Col du Grand Bois', 1161], ["Col de l'Asclier", 905], ['Col de Montmirat', 1046],
];
const UK_PASSES: [string, number][] = [
  ['Kirkstone Pass', 454], ['Hardknott Pass', 393], ['Wrynose Pass', 393], ['Honister Pass', 356], ['Great Dun Fell', 847],
  ['Cairnwell Pass', 670], ['Bealach na Bà', 626], ['The Lecht', 637], ['Bwlch y Groes', 545], ['Gospel Pass', 549],
  ['Horseshoe Pass', 417], ['The Bwlch', 449], ['Rhigos', 486], ['Shap Summit', 423], ['Trough of Bowland', 293], ['Mennock Pass', 457],
];
const IT_ALPS: [string, number][] = [
  ['Passo Giau', 2236], ['Passo Pordoi', 2239], ['Passo Fedaia', 2057], ['Passo di Gavia', 2618], ['Passo dello Stelvio', 2758],
  ['Passo San Pellegrino', 1918], ['Passo Rolle', 1984], ['Passo Valparola', 2192], ['Passo Sella', 2244], ['Passo Gardena', 2121],
  ['Passo Manghen', 2047], ['Passo del Mortirolo', 1852], ['Passo Falzarego', 2105], ['Passo del Tonale', 1883], ['Passo Campolongo', 1875],
  ['Passo Duran', 1601], ['Passo Croce Domini', 1892], ['Passo Campo Carlo Magno', 1682], ['Monte Bondone', 1650], ['Passo Durone', 1039],
];
const IT_LOMB: [string, number][] = [
  ['Passo del Mortirolo', 1852], ['Passo di Gavia', 2618], ['Passo San Marco', 1992], ['Passo della Presolana', 1297],
  ['Colle di Zambla', 1257], ['Culmine di San Pietro', 1254], ['Madonna del Ghisallo', 754], ['Passo dello Spluga', 2115],
  ['Passo del Vivione', 1828], ['Passo dell’Aprica', 1176], ['Passo di Foscagno', 2291], ['Passo del Maniva', 1664],
];
const IT_FRIUL: [string, number][] = [
  ['Monte Zoncolan', 1730], ['Sella Valcalda', 958], ['Passo Duron', 1069], ['Sella Nevea', 1190], ['Monte Crostis', 1982],
  ['Passo Pura', 1428], ['Forcella Lavardet', 1542], ['Monte Lussari', 1766], ['Passo di Monte Croce Carnico', 1360],
  ['Passo del Pura', 1428], ['Sella di Razzo', 1760], ['Forcella Clautana', 1432],
];
const IT_APP: [string, number][] = [
  ['Campo Imperatore', 2135], ['Blockhaus', 2142], ['Passo Lanciano', 1306], ['Forca di Presta', 1536], ['Monte Terminillo', 1675],
  ['Sassotetto', 1361], ['Passo delle Capannelle', 1300], ['Valico della Forchetta', 1270], ['Forca Canapine', 1541],
  ['Monte Livata', 1429], ['Passo San Leonardo', 1282], ['Forca d’Acero', 1538], ['Valico di Monte Bove', 1300], ['Prati di Tivo', 1450],
];
const IT_TOSC: [string, number][] = [
  ['Abetone', 1388], ['Passo del Muraglione', 907], ['Passo della Futa', 903], ['Passo del Giogo', 882], ['Passo dei Due Santi', 1392],
  ['Passo del Cerreto', 1261], ['Passo del Lagastrello', 1200], ['Passo della Calla', 1296], ['Passo dei Mandrioli', 1173], ['Colle di Cento Croci', 1055],
];

const forests = {
  fr: ['Forêt de Chambord', 'Forêt de Rambouillet', 'Forêt du Morvan', 'Forêt de Paimpont', "Forêt d'Iraty", 'Forêt de la Joux', 'Bois de Vincennes', 'Forêt de Fontainebleau'],
  frMtn: ['Forêt du Grand Colombier', 'Forêt des Bauges', "Forêt d'Iraty", 'Forêt de Saint-Hugon', 'Bois de la Glière', 'Forêt du Risoux'],
  uk: ['Kielder Forest', 'Grizedale Forest', 'Whinlatter Forest', 'Forest of Bowland', 'Brecon Beacons', 'Afan Forest', 'Glentress Forest', 'Ettrick Forest'],
  it: ['Foresta di Paneveggio', 'Bosco del Cansiglio', 'Foresta di Tarvisio', 'Foresta del Cadore', 'Bosco di Larici', 'Foresta di Somadida'],
  itApp: ['Foresta Umbra', 'Faggeta di Monte Livata', 'Bosco di Sant’Antonio', 'Foresta della Lama', 'Faggeta del Cimino', 'Bosco Martese'],
};

// ------------------------------------------------------------------ Ortsbilder

const sc = (s: Scape) => s;

export const SCAPES = {
  paris: sc({
    id: 'paris', label: 'Paris', country: 'fr', lang: 'fr', region: 'nord',
    styles: [['haussmann', 1]], alpine: 0, floors: [4, 6], roof: 'zinc', church: 'clocher', lamp: 'paris', alley: 'plane', cobble: 0.85, boulevard: true, furniture: ['morris', 'kiosk', 'wallace'],
    flags: ['fr', 'fr', 'paris'],
    names: {
      villages: ['Montmartre', 'Saint-Germain', 'Le Marais', 'Passy', 'Les Batignolles', 'Belleville', 'Montparnasse', 'Saint-Cloud', 'Sèvres', 'Versailles', 'Saint-Cyr-l’École', 'Chevreuse'],
      valleys: ['Vallée de Chevreuse', 'Vallée de la Seine', 'Vallée de la Bièvre', 'Plaine de Versailles', 'Vallée de Montmorency', 'Vallée de la Marne'],
      forests: ['Bois de Boulogne', 'Bois de Vincennes', 'Forêt de Rambouillet', 'Forêt de Meudon', 'Forêt de Saint-Germain', 'Forêt de Marly'],
      lakes: ['Bassin de la Villette', 'Lac du Bois de Boulogne', 'Étang de Saint-Quentin', 'Lac de Vincennes', 'Pièce d’eau des Suisses'],
      hills: ['Butte Montmartre', 'Côte de Saint-Rémy', 'Côte des Dix-Sept Tournants', 'Côte de Châteaufort', 'Mont Valérien', 'Buttes-Chaumont'],
      passes: [...FR_ALPS.slice(0, 8), ...FR_PYR.slice(0, 8)],
    },
  }),
  cotentin: sc({
    id: 'cotentin', label: 'Cotentin', country: 'fr', lang: 'fr', region: 'nord',
    styles: [['bruchstein', 3], ['creme', 1], ['haussmann', 1]], alpine: 0.3, roof: 'slate', church: 'clocher', lamp: 'fr', flags: ['fr', 'normandie'],
    names: {
      villages: ['Barfleur', 'Saint-Vaast-la-Hougue', 'Valognes', 'Les Pieux', 'Beaumont-Hague', 'Quettehou', 'Bricquebec', 'Saint-Pierre-Église', 'Omonville', 'Auderville'],
      valleys: ['Val de Saire', 'La Hague', 'Vallée de la Divette', 'Vallée de la Douve', 'Marais du Cotentin'],
      forests: ['Forêt de Brix', 'Bois de la Hague', 'Forêt de Barnavast', 'Bois de Rochemont'],
      lakes: ['Rade de Cherbourg', 'Anse de Saint-Martin', 'Baie de la Hougue', 'Port de Barfleur'],
      hills: ['Nez de Jobourg', 'Mont du Roc', 'Montagne du Roule', 'Côte de Gréville'],
      passes: FR_ALPS,
    },
  }),
  bretagne: sc({
    id: 'bretagne', label: 'Bretagne', country: 'fr', lang: 'fr', region: 'nord',
    styles: [['bruchstein', 3], ['creme', 2], ['fachwerk', 0.5]], alpine: 0.4, roof: 'slate', church: 'clocher', lamp: 'fr', flags: ['bzh', 'bzh', 'fr'],
    names: {
      villages: ['Combourg', 'Bécherel', 'Saint-Méen-le-Grand', 'Ploërmel', 'Sérent', 'Josselin', 'Pleine-Fougères', 'Rochefort-en-Terre', 'Malestroit', 'Guer'],
      valleys: ["Vallée de l'Oust", 'Vallée de la Rance', 'Landes de Lanvaux', 'Pays de Brocéliande', 'Vallée du Couesnon'],
      forests: ['Forêt de Brocéliande', 'Forêt de Paimpont', 'Forêt de Villecartier', 'Forêt de Lanouée'],
      lakes: ['Lac au Duc', 'Baie du Mont-Saint-Michel', 'Golfe du Morbihan', 'Étang de Paimpont'],
      hills: ['Côte de Cadoudal', 'Monts d’Arrée', 'Landes de Lanvaux', 'Mont Dol'],
      passes: FR_ALPS,
    },
  }),
  anjou: sc({
    id: 'anjou', label: 'Anjou und Loire', country: 'fr', lang: 'fr', region: 'nord',
    styles: [['creme', 3], ['haussmann', 1.5], ['bruchstein', 1], ['fachwerk', 0.5]], alpine: 0.1, roof: 'slate', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr'],
    names: {
      villages: ['Bouchemaine', 'Candé', 'Nozay', 'Redon', 'Guémené-Penfao', 'Savennières', 'Saumur', 'Cour-Cheverny', 'Cellettes', 'Mont-près-Chambord', 'Bracieux', 'Chaumont-sur-Loire'],
      valleys: ['Val de Loire', 'Vallée de la Maine', 'Vallée du Loir', 'Sologne', 'Vallée du Cher', 'Coteaux du Layon'],
      forests: ['Forêt de Chambord', 'Forêt de Russy', 'Forêt de Boulogne', 'Forêt de Blois'],
      lakes: ['Loire', 'Lac de Maine', 'Étangs de Sologne', 'Confluence de la Maine'],
      hills: ['Coteaux de Savennières', 'Coteaux du Layon', 'Côte de Cheverny', 'Coteaux de la Loire'],
      passes: FR_ALPS,
    },
  }),
  burgund: sc({
    id: 'burgund', label: 'Berry und Burgund', country: 'fr', lang: 'fr', region: 'nord',
    styles: [['creme', 3], ['ocker', 1], ['bruchstein', 2], ['fachwerk', 0.7]], alpine: 0.25, roof: 'tile', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr', 'bourgogne'],
    names: {
      villages: ['Avord', 'Nevers', 'Château-Chinon', 'Autun', 'Mesvres', 'Glux-en-Glenne', 'Saint-Léger-sous-Beuvray', 'Châtillon-en-Bazois', 'Montcenis', 'Uchon'],
      valleys: ['Bazois', 'Vallée de la Loire', 'Vallée de l’Arroux', 'Champagne berrichonne', 'Vallée de l’Yonne'],
      forests: ['Forêt du Morvan', 'Forêt de Saint-Prix', 'Forêt de Planoise', 'Forêt des Battées'],
      lakes: ['Lac des Settons', 'Lac de Pannecière', 'Étang de la Sorme', 'Lac de Saint-Agnan'],
      hills: ["Signal d'Uchon", 'Mont Beuvray', 'Croix de la Libération', 'Haut-Folin'],
      passes: FR_MC,
    },
  }),
  bugey: sc({
    id: 'bugey', label: 'Dombes und Bugey', country: 'fr', lang: 'fr', region: 'alpen',
    styles: [['bruchstein', 2], ['creme', 2], ['ocker', 1], ['chalet', 0.5]], alpine: 0.45, roof: 'tile', church: 'clocher', lamp: 'fr', flags: ['fr'],
    names: {
      villages: ['Chalamont', "Pont-d'Ain", 'Poncin', 'Nantua', 'Injoux', 'Artemare', 'Culoz', 'Ochiaz', 'Hautecourt', 'Belley'],
      valleys: ['Dombes', 'Valromey', 'Vallée de l’Ain', 'Bugey', 'Marais de Lavours', 'Vallée du Rhône'],
      forests: forests.frMtn,
      lakes: ['Lac de Nantua', 'Étangs de la Dombes', 'Lac du Bourget', 'Lac de Sylans'],
      hills: ['Vignoble du Bugey', 'Coteaux de Cerdon', 'Côte des Neyrolles', 'Montagne de Parves'],
      passes: FR_JURA,
    },
  }),
  savoyen: sc({
    id: 'savoyen', label: 'Savoyen', country: 'fr', lang: 'fr', region: 'alpen',
    styles: [['chalet', 2], ['creme', 2], ['bruchstein', 1], ['ocker', 1]], alpine: 0.6, roof: 'slate', church: 'clocher', lamp: 'fr', flags: ['fr', 'savoie'],
    names: {
      villages: ['La Clusaz', 'Le Grand-Bornand', 'Thônes', 'Beaufort', 'Megève', 'Saint-Gervais', 'Passy', 'Cluses', 'Bonneville', 'Hauteluce', 'Villard-sur-Doron', 'Ugine'],
      valleys: ['Vallée de l’Arve', 'Beaufortain', 'Val d’Arly', 'Vallée du Giffre', 'Aravis', 'Tarentaise'],
      forests: forests.frMtn,
      lakes: ["Lac d'Annecy", 'Lac de Roselend', 'Lac de Passy', 'Lac des Confins', 'Lac du Bourget'],
      hills: ['Plateau d’Assy', 'Côte de Domancy', 'Montée du Bettex', 'Plateau des Glières'],
      passes: FR_ALPS,
    },
  }),
  dauphine: sc({
    id: 'dauphine', label: 'Dauphiné und Rhonetal', country: 'fr', lang: 'fr', region: 'provence',
    styles: [['creme', 2], ['ocker', 2], ['lachs', 1], ['gelb', 1], ['bruchstein', 1]], alpine: 0.2, roof: 'tile', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr'],
    names: {
      villages: ['Saint-Laurent-du-Pont', 'Voiron', 'Vinay', 'Roybon', 'Hauterives', 'Romans-sur-Isère', 'Tullins', 'Saint-Marcellin', 'Tain-l’Hermitage', 'Tournon'],
      valleys: ['Vallée de l’Isère', 'Vallée du Rhône', 'Chambaran', 'Bas-Dauphiné', 'Royans', 'Drôme des Collines'],
      forests: ['Forêt de Chambaran', 'Forêt de la Chartreuse', 'Forêt de Saoû', 'Bois de Vinay'],
      lakes: ['Lac de Paladru', 'Lac du Bourget', 'Rhône', 'Lac de Laffrey'],
      hills: ['Hermitage', 'Crozes-Hermitage', 'Coteaux de Saint-Marcellin', 'Côte de Cornas'],
      passes: FR_ALPS,
    },
  }),
  languedoc: sc({
    id: 'languedoc', label: 'Cevennen und Languedoc', country: 'fr', lang: 'fr', region: 'provence',
    styles: [['ocker', 2], ['creme', 2], ['lachs', 1], ['bruchstein', 1.5]], alpine: 0.2, roof: 'tile', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr', 'occitanie'],
    names: {
      villages: ['Largentière', 'Lablachère', 'Saint-Ambroix', 'Alès', 'Anduze', 'Quissac', 'Saint-Mathieu-de-Tréviers', 'Castelnau-le-Lez', 'Aniane', 'Le Vigan', 'Saint-Guilhem-le-Désert'],
      valleys: ['Vallée de l’Hérault', 'Garrigues', 'Vallée du Gardon', 'Pic Saint-Loup', 'Vallée de la Cèze', 'Vallée de l’Ardèche'],
      forests: ['Forêt de l’Aigoual', 'Bois de Païolive', 'Forêt des Cévennes', 'Bois de Valène'],
      lakes: ['Étang de Thau', 'Lac du Salagou', 'Étang de l’Or', 'Gorges de l’Ardèche'],
      hills: ['Pic Saint-Loup', 'Terrasses du Larzac', 'Coteaux du Languedoc', 'Côte de Montmirat'],
      passes: FR_MC,
    },
  }),
  cevennen: sc({
    id: 'cevennen', label: 'Cevennen und Lozère', country: 'fr', lang: 'fr', region: 'pyrenaeen',
    styles: [['bruchstein', 3], ['creme', 1.5], ['ocker', 0.5]], alpine: 0.6, roof: 'lauze', church: 'clocher', lamp: 'fr', flags: ['fr', 'occitanie'],
    names: {
      villages: ['Florac', 'Saint-Maurice-Navacelles', 'Le Vigan', 'Meyrueis', 'Ispagnac', 'Sainte-Enimie', 'Balsièges', 'Le Pont-de-Montvert', 'Langogne', 'Marvejols'],
      valleys: ['Cirque de Navacelles', 'Causse Méjean', 'Gorges du Tarn', 'Vallée du Lot', 'Causse de Sauveterre', 'Vallée Française'],
      forests: ['Forêt de l’Aigoual', 'Forêt du Mont Lozère', 'Bois du Chapitre', 'Forêt de Mercoire'],
      lakes: ['Lac de Naussac', 'Gorges du Tarn', 'Lac de Villefort', 'Lac de Charpal'],
      hills: ['Causse de Mende', 'Côte de l’Estrade', 'Montée Jalabert', 'Mont Mimat'],
      passes: FR_MC,
    },
  }),
  albi: sc({
    id: 'albi', label: 'Aveyron und Albigeois', country: 'fr', lang: 'fr', region: 'provence',
    styles: [['backstein', 3], ['ocker', 1], ['lachs', 1], ['bruchstein', 1], ['fachwerk', 0.6]], alpine: 0.2, roof: 'tile', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr', 'occitanie'],
    names: {
      villages: ['Naucelle', 'Rieupeyroux', 'Villefranche-de-Rouergue', 'Laguépie', 'Monestiés', 'Cordes-sur-Ciel', 'Carmaux', 'Sauveterre-de-Rouergue', 'Najac', 'Lescure'],
      valleys: ['Vallée du Tarn', 'Ségala', 'Vallée du Viaur', 'Vallée de l’Aveyron', 'Causse Comtal', 'Gaillacois'],
      forests: ['Forêt de la Grésigne', 'Forêt des Palanges', 'Bois du Ségala', 'Forêt de Sérénac'],
      lakes: ['Tarn', 'Lac de Pareloup', 'Lac de la Roucarié', 'Lac de Saint-Géraud'],
      hills: ['Vignoble de Gaillac', 'Côte de Cordes', 'Puech de Rodez', 'Côte de Monestiés'],
      passes: FR_MC,
    },
  }),
  toulouse: sc({
    id: 'toulouse', label: 'Toulouse', country: 'fr', lang: 'fr', region: 'provence',
    styles: [['backstein', 4], ['lachs', 1.5], ['creme', 1]], alpine: 0, floors: [2, 4], roof: 'tile', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr', 'occitanie', 'toulouse'],
    names: {
      villages: ['Portet-sur-Garonne', 'Pinsaguel', 'Lacroix-Falgarde', 'Muret', 'Carbonne', 'Saint-Sernin', 'Les Carmes', 'Empalot', 'Rangueil', 'Colomiers'],
      valleys: ['Vallée de la Garonne', 'Lauragais', 'Vallée de l’Ariège', 'Comminges', 'Coteaux du Volvestre'],
      forests: ['Forêt de Bouconne', 'Bois de la Ramée', 'Forêt de Buzet', 'Bois de Pech David'],
      lakes: ['Garonne', 'Canal du Midi', 'Lac de la Ramée', 'Lac de Sesquières'],
      hills: ['Côte de Pech David', 'Coteaux de Vieille-Toulouse', 'Côte de Lacroix', 'Côte de Rangueil'],
      passes: FR_PYR,
    },
  }),
  bearn: sc({
    id: 'bearn', label: 'Gascogne und Béarn', country: 'fr', lang: 'fr', region: 'pyrenaeen',
    styles: [['creme', 2], ['bruchstein', 2], ['ocker', 1], ['haussmann', 1]], alpine: 0.35, roof: 'slate', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr', 'bearn', 'occitanie'],
    names: {
      villages: ['Aurignac', 'Boulogne-sur-Gesse', 'Castelnau-Magnoac', 'Trie-sur-Baïse', 'Rabastens-de-Bigorre', 'Vic-en-Bigorre', 'Morlaàs', 'Lescar', 'Nay', 'Oloron-Sainte-Marie', 'Laruns', 'Arette'],
      valleys: ['Vallée d’Ossau', 'Vallée d’Aspe', 'Vallée du Gave de Pau', 'Coteaux de Gascogne', 'Magnoac', 'Plaine de Tarbes'],
      forests: ['Forêt de Bastard', 'Forêt d’Issaux', 'Forêt du Bager', 'Forêt de Mixe'],
      lakes: ['Gave de Pau', 'Lac de Fabrèges', 'Lac d’Artouste', 'Lac de Bious-Artigues'],
      hills: ['Coteaux du Jurançon', 'Vignoble de Madiran', 'Côte de Morlaàs', 'Coteaux de Gascogne'],
      passes: FR_PYR,
    },
  }),
  bigorre: sc({
    id: 'bigorre', label: 'Hautes-Pyrénées', country: 'fr', lang: 'fr', region: 'pyrenaeen',
    styles: [['bruchstein', 3], ['creme', 1.5], ['chalet', 0.5]], alpine: 0.65, roof: 'slate', church: 'clocher', lamp: 'fr', flags: ['fr', 'occitanie'],
    names: {
      villages: ['Asson', 'Argelès-Gazost', 'Luz-Saint-Sauveur', 'Barèges', 'Sainte-Marie-de-Campan', 'Arreau', 'Saint-Lary-Soulan', 'Vielle-Aure', 'Pierrefitte', 'Cauterets'],
      valleys: ['Vallée de Campan', 'Val d’Azun', 'Pays Toy', 'Vallée d’Aure', 'Vallée du Louron', 'Vallée des Gaves'],
      forests: ['Forêt de Payolle', 'Forêt du Lys', 'Forêt de Rioumajou', 'Bois de Barèges'],
      lakes: ["Lac de l'Oule", "Lac d'Orédon", 'Lac de Payolle', 'Lac de Gaube'],
      hills: ['Plateau de Payolle', 'Pla d’Adet', 'Hautacam', 'Luz Ardiden'],
      passes: FR_PYR,
    },
  }),
  baskenland: sc({
    id: 'baskenland', label: 'Baskenland', country: 'fr', lang: 'fr', region: 'pyrenaeen',
    styles: [['fachwerk', 3], ['creme', 2], ['bruchstein', 0.6]], alpine: 0.3, roof: 'tile', church: 'clocher', lamp: 'fr', flags: ['eus', 'eus', 'fr'],
    names: {
      villages: ['Hasparren', 'Saint-Jean-le-Vieux', 'Saint-Jean-Pied-de-Port', 'Larrau', 'Sainte-Engrâce', 'Mauléon', 'Tardets', 'Espelette', 'Cambo-les-Bains', 'Iholdy'],
      valleys: ['Pays de Cize', 'Soule', 'Vallée de la Nive', 'Labourd', 'Basse-Navarre', 'Barétous'],
      forests: ["Forêt d'Iraty", 'Forêt des Arbailles', 'Bois de Mixe', 'Forêt d’Orion'],
      lakes: ['Lac d’Iraty', 'Nive', 'Lac de Saint-Pée', 'Gave de Mauléon'],
      hills: ['Col de Burdincurutcheta', 'Mont Ursuya', 'Pic de Behorleguy', 'Côte d’Hasparren'],
      passes: FR_PYR,
    },
  }),
  gironde: sc({
    id: 'gironde', label: 'Gascogne und Gironde', country: 'fr', lang: 'fr', region: 'provence',
    styles: [['creme', 3], ['bruchstein', 1.5], ['ocker', 1], ['haussmann', 0.6]], alpine: 0.1, roof: 'tile', church: 'clocher', lamp: 'fr', alley: 'plane', flags: ['fr', 'occitanie'],
    names: {
      villages: ['Plaisance', 'Eauze', 'Sos', 'Casteljaloux', 'Cocumont', 'La Réole', 'Sauveterre-de-Guyenne', 'Saint-Quentin-de-Baron', 'Saint-Émilion', 'Pomerol', 'Fronsac', 'Castillon-la-Bataille'],
      valleys: ['Entre-deux-Mers', 'Vallée de la Dordogne', 'Armagnac', 'Vallée de la Garonne', 'Landes de Gascogne', 'Bazadais'],
      forests: ['Forêt des Landes', 'Forêt de Campet', 'Bois de Sauveterre', 'Forêt de Mézos'],
      lakes: ['Dordogne', 'Garonne', 'Isle', 'Étang de la Ganne'],
      hills: ['Saint-Émilion', 'Pomerol', 'Côtes de Castillon', 'Fronsadais', 'Côtes de Bourg'],
      passes: FR_PYR,
    },
  }),
  // Großbritannien
  grenzland: sc({
    id: 'grenzland', label: 'Scottish Borders und Cumbria', country: 'uk', lang: 'en', region: 'nord',
    styles: [['bruchstein', 4], ['creme', 1], ['backstein', 0.6]], alpine: 0.6, roof: 'slate', church: 'tower', lamp: 'uk', flags: ['sco', 'sco', 'eng', 'uk'],
    names: {
      villages: ['Innerleithen', 'Galashiels', 'Melrose', 'Hawick', 'Newcastleton', 'Longtown', 'Brampton', 'Peebles', 'Selkirk', 'Jedburgh', 'Penrith', 'Wigton'],
      valleys: ['Tweeddale', 'Teviotdale', 'Liddesdale', 'Ettrick Valley', 'Eden Valley', 'Solway Plain'],
      forests: forests.uk,
      lakes: ['St Mary’s Loch', 'Talla Reservoir', 'Solway Firth', 'River Tweed', 'Talkin Tarn'],
      hills: ['Eildon Hills', 'Broad Law', 'Côte de Melrose', 'Lammermuir Hills', 'Cheviot Hills'],
      passes: UK_PASSES,
    },
  }),
  lancashire: sc({
    id: 'lancashire', label: 'Lake District und Lancashire', country: 'uk', lang: 'en', region: 'nord',
    styles: [['backstein', 4], ['bruchstein', 2], ['creme', 1]], alpine: 0.4, roof: 'slate', church: 'tower', lamp: 'uk', flags: ['eng', 'uk', 'lancs'],
    names: {
      villages: ['Windermere', 'Milnthorpe', 'Carnforth', 'Lancaster', 'Blackburn', 'Chorley', 'Prescot', 'Clitheroe', 'Dunsop Bridge', 'Waddington', 'Belmont', 'Parbold'],
      valleys: ['Ribble Valley', 'Forest of Bowland', 'Lune Valley', 'Langdale', 'Borrowdale', 'West Pennine Moors'],
      forests: forests.uk,
      lakes: ['Derwentwater', 'Windermere', 'Thirlmere', 'River Mersey', 'Ullswater', 'Grasmere'],
      hills: ['Jubilee Tower', 'Waddington Fell', 'Parbold Hill', 'Pendle Hill', 'Winter Hill'],
      passes: UK_PASSES,
    },
  }),
  wales: sc({
    id: 'wales', label: 'Wales', country: 'uk', lang: 'en', region: 'nord',
    styles: [['bruchstein', 3], ['creme', 2], ['backstein', 1]], alpine: 0.5, roof: 'slate', church: 'chapel', lamp: 'uk', flags: ['cym', 'cym', 'uk'],
    names: {
      villages: ['Newtown', 'Llandrindod Wells', 'Builth Wells', 'Brecon', 'Hirwaun', 'Treorchy', 'Ferndale', 'Aberdare', 'Nelson', 'Caerphilly', 'Llanidloes', 'Pontypridd'],
      valleys: ['Rhondda Fawr', 'Rhondda Fach', 'Cynon Valley', 'Vale of Usk', 'Wye Valley', 'Taff Valley'],
      forests: forests.uk,
      lakes: ['Llyn Brianne', 'Llangorse Lake', 'Elan Valley Reservoir', 'Cardiff Bay', 'Llyn Clywedog'],
      hills: ['Bannau Brycheiniog', 'Penrhys', 'Maerdy Mountain', 'Caerphilly Mountain', 'Mynydd Epynt'],
      passes: UK_PASSES,
    },
  }),
  // Italien und Slowenien
  triest: sc({
    id: 'triest', label: 'Triest und Karst', country: 'it', lang: 'it', region: 'riviera',
    styles: [['creme', 3], ['gelb', 1.5], ['ocker', 1], ['haussmann', 1.5], ['bruchstein', 0.8]], alpine: 0.2, floors: [3, 5], roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'trieste'],
    names: {
      villages: ['Opicina', 'Sistiana', 'Duino', 'Prosecco', 'Muggia', 'Basovizza', 'Sgonico', 'Aurisina', 'Monrupino', 'Santa Croce'],
      valleys: ['Carso', 'Val Rosandra', 'Costiera Triestina', 'Altopiano carsico', 'Golfo di Trieste'],
      forests: ['Bosco Bazzoni', 'Pineta di Barcola', 'Bosco Farneto', 'Bosco di Basovizza'],
      lakes: ['Golfo di Trieste', 'Baia di Sistiana', 'Porto Vecchio', 'Molo Audace'],
      hills: ['Strada Napoleonica', 'Monte Grisa', 'Vigneti del Carso', 'Scala Santa'],
      passes: IT_FRIUL,
    },
  }),
  istrien: sc({
    id: 'istrien', label: 'Slowenien und Istrien', country: 'si', lang: 'it', region: 'riviera',
    styles: [['creme', 2], ['ocker', 2], ['gelb', 1], ['lachs', 1], ['bruchstein', 1.2]], alpine: 0.25, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['si', 'si', 'it'],
    names: {
      villages: ['Postojna', 'Divača', 'Sežana', 'Izola', 'Piran', 'Ankaran', 'Vrhnika', 'Logatec', 'Lipica', 'Kozina', 'Črni Kal'],
      valleys: ['Kras', 'Vipavska dolina', 'Rižana', 'Notranjska', 'Slovenska Istra'],
      forests: ['Trnovski gozd', 'Hrušica', 'Javorniki', 'Gozd Panovec'],
      lakes: ['Koprski zaliv', 'Piranski zaliv', 'Cerkniško jezero', 'Ljubljanica'],
      hills: ['Brda', 'Kraški rob', 'Šmarje', 'Vinakoper'],
      passes: [['Vršič', 1611], ['Mangart', 2072], ['Predel', 1156], ['Ljubelj', 1369], ['Pokljuka', 1347], ['Krvavec', 1450], ['Javornik', 1240], ['Nanos', 1262]],
    },
  }),
  veneto: sc({
    id: 'veneto', label: 'Venetien und Friaul', country: 'it', lang: 'it', region: 'po',
    styles: [['creme', 2], ['gelb', 1.5], ['lachs', 1.5], ['ocker', 1.5], ['terrakotta', 1]], alpine: 0.15, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'veneto'],
    names: {
      villages: ['Cervignano', 'Palmanova', 'Montebelluna', 'Asolo', 'Castelfranco', 'Valdobbiadene', 'Conegliano', 'Caneva', 'Montaner', 'Este', 'Arquà Petrarca', 'Teolo'],
      valleys: ['Montello', 'Pedemontana del Grappa', 'Colli Euganei', 'Valle del Piave', 'Pianura friulana', 'Valle del Livenza'],
      forests: ['Bosco del Montello', 'Bosco del Cansiglio', 'Bosco di Mestre', 'Foresta del Grappa'],
      lakes: ['Laguna di Grado', 'Piave', 'Livenza', 'Lago di Revine', 'Brenta'],
      hills: ['Colli Euganei', 'Mostaccin', 'Montello', 'Colline del Prosecco', 'Monte Venda'],
      passes: IT_ALPS,
    },
  }),
  romagna: sc({
    id: 'romagna', label: 'Romagna und Adria', country: 'it', lang: 'it', region: 'riviera',
    styles: [['gelb', 2], ['lachs', 2], ['creme', 2], ['ocker', 1]], alpine: 0, roof: 'tile', church: 'campanile', lamp: 'it', alley: 'pine', flags: ['it', 'romagna'],
    names: {
      villages: ['Argenta', 'Lugo', 'Cervia', 'Cesenatico', 'Bellaria', 'Riccione', 'Cattolica', 'Santarcangelo', 'Coriano', 'Ravenna'],
      valleys: ['Valli di Comacchio', 'Pianura romagnola', 'Valle del Marecchia', 'Riviera romagnola', 'Valle del Conca'],
      forests: ['Pineta di Classe', 'Pineta di Cervia', 'Pineta di San Vitale', 'Bosco della Mesola'],
      lakes: ['Mare Adriatico', 'Valli di Comacchio', 'Saline di Cervia', 'Porto canale'],
      hills: ['Colli di Rimini', 'San Marino', 'Gemmano', 'Montefiore Conca'],
      passes: IT_TOSC,
    },
  }),
  marken: sc({
    id: 'marken', label: 'Marken und Sibillini', country: 'it', lang: 'it', region: 'apennin',
    styles: [['backstein', 3], ['ocker', 1.5], ['creme', 1], ['bruchstein', 1]], alpine: 0.3, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'marche'],
    names: {
      villages: ['Filottrano', 'Tolentino', 'Macerata', 'Sarnano', 'Camerino', 'Recanati', 'Cingoli', 'San Ginesio', 'Amandola', 'Treia'],
      valleys: ['Monti Sibillini', 'Valle del Chienti', 'Valle del Fiastrone', 'Muri marchigiani', 'Valle del Tenna'],
      forests: forests.itApp,
      lakes: ['Lago di Fiastra', 'Lago di Caccamo', 'Lago di Pilato', 'Lago di Borgiano'],
      hills: ['Muri di Filottrano', 'Colline maceratesi', 'Verdicchio', 'Muro di Treia'],
      passes: IT_APP,
    },
  }),
  abruzzen: sc({
    id: 'abruzzen', label: 'Abruzzen', country: 'it', lang: 'it', region: 'apennin',
    styles: [['bruchstein', 2.5], ['creme', 2], ['ocker', 1], ['gelb', 0.5]], alpine: 0.4, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'abruzzo'],
    names: {
      villages: ['Sulmona', 'Pacentro', 'Pettorano', 'Ripa Teatina', 'Chieti', 'Guardiagrele', 'Orsogna', 'Pescocostanzo', 'Roccaraso', 'Scanno', 'Trasacco', 'Avezzano'],
      valleys: ['Valle Peligna', 'Maiella', 'Piana del Fucino', 'Valle del Sangro', 'Valle dell’Aterno', 'Altopiano delle Cinquemiglia'],
      forests: forests.itApp,
      lakes: ['Lago di Scanno', 'Lago di Barrea', 'Lago di Bomba', 'Lago di Campotosto'],
      hills: ['Colline teatine', 'Montepulciano d’Abruzzo', 'Colle di Lanciano', 'Costa dei Trabocchi'],
      passes: IT_APP,
    },
  }),
  neapel: sc({
    id: 'neapel', label: 'Kampanien und Neapel', country: 'it', lang: 'it', region: 'riviera',
    styles: [['gelb', 2], ['lachs', 2], ['ocker', 2], ['creme', 1], ['terrakotta', 1]], alpine: 0.05, floors: [3, 6], roof: 'tile', church: 'campanile', lamp: 'it', alley: 'pine', cobble: 0.4, flags: ['it', 'napoli'],
    names: {
      villages: ['Mergellina', 'Posillipo', 'Pozzuoli', 'Caserta', 'Capua', 'Venafro', 'Isernia', 'Castel di Sangro', 'Ercolano', 'Portici', 'Torre del Greco'],
      valleys: ['Valle del Volturno', 'Campi Flegrei', 'Valle Roveto', 'Terra di Lavoro', 'Agro aversano'],
      forests: ['Bosco di Capodimonte', 'Bosco degli Astroni', 'Pineta di Castel Volturno', 'Foresta del Matese'],
      lakes: ['Golfo di Napoli', 'Lago d’Averno', 'Lago Patria', 'Lago del Matese'],
      hills: ['Posillipo', 'Vomero', 'Capodimonte', 'Lacryma Christi'],
      passes: IT_APP,
    },
  }),
  latium: sc({
    id: 'latium', label: 'Latium', country: 'it', lang: 'it', region: 'apennin',
    styles: [['ocker', 2], ['creme', 2], ['bruchstein', 1.5], ['terrakotta', 1]], alpine: 0.3, roof: 'tile', church: 'campanile', lamp: 'it', alley: 'pine', flags: ['it', 'lazio'],
    names: {
      villages: ['Itri', 'Fondi', 'Subiaco', 'Palombara Sabina', 'Tivoli', 'Arsoli', 'Jenne', 'Cervara di Roma', 'Sperlonga', 'Ceccano'],
      valleys: ['Valle dell’Aniene', 'Monti Simbruini', 'Ciociaria', 'Sabina', 'Valle del Liri', 'Monti Aurunci'],
      forests: forests.itApp,
      lakes: ['Lago di Fondi', 'Lago di Turano', 'Lago del Salto', 'Aniene'],
      hills: ['Monti Lucretili', 'Colli Albani', 'Castelli Romani', 'Monte Gennaro'],
      passes: IT_APP,
    },
  }),
  umbrien: sc({
    id: 'umbrien', label: 'Umbrien und Valnerina', country: 'it', lang: 'it', region: 'apennin',
    styles: [['bruchstein', 2.5], ['creme', 2], ['ocker', 1.5]], alpine: 0.35, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'umbria'],
    names: {
      villages: ['Castelluccio', 'Cascia', 'Preci', 'Visso', 'Rieti', 'Leonessa', 'Gualdo Tadino', 'Nocera Umbra', 'Gubbio', 'Spoleto'],
      valleys: ['Piano Grande', 'Valnerina', 'Valle Umbra', 'Piana di Santa Scolastica', 'Valle del Topino'],
      forests: forests.itApp,
      lakes: ['Lago di Piediluco', 'Lago Trasimeno', 'Lago di Fiastra', 'Nera'],
      hills: ['Forca di Presta', 'Forca Ventolosa', 'Colli di Montefalco', 'Monte Subasio'],
      passes: IT_APP,
    },
  }),
  toskana: sc({
    id: 'toskana', label: 'Toskana', country: 'it', lang: 'it', region: 'toskana',
    styles: [['ocker', 2], ['terrakotta', 1.5], ['creme', 1.5], ['bruchstein', 1.2], ['gelb', 0.6]], alpine: 0.25, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'toscana'],
    names: {
      villages: ['Borgo San Lorenzo', 'Barberino', 'Firenzuola', 'Marradi', 'Dicomano', 'Pontremoli', 'Aulla', 'Fivizzano', 'Pescia', 'Montecatini Alto', 'Villafranca in Lunigiana'],
      valleys: ['Mugello', 'Lunigiana', 'Valdinievole', 'Val di Sieve', 'Casentino', 'Valle del Magra'],
      forests: ['Foresta di Campigna', 'Bosco di Vallombrosa', 'Castagneti della Lunigiana', 'Foresta dell’Abetone'],
      lakes: ['Lago di Bilancino', 'Padule di Fucecchio', 'Arno', 'Magra'],
      hills: ['Colline del Mugello', 'Montalbano', 'Chianti Rufina', 'Colline lucchesi'],
      passes: IT_TOSC,
    },
  }),
  emilia: sc({
    id: 'emilia', label: 'Emilia', country: 'it', lang: 'it', region: 'po',
    styles: [['terrakotta', 2], ['ocker', 2], ['lachs', 1.5], ['gelb', 1], ['backstein', 1]], alpine: 0.1, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'it', 'it'],
    names: {
      villages: ['Fornovo', 'Collecchio', 'Parma', 'Montecchio', 'Sant’Ilario', 'Cavriago', 'Scandiano', 'Correggio', 'Bibbiano', 'Borgotaro'],
      valleys: ['Val di Taro', 'Pianura emiliana', 'Val d’Enza', 'Bassa reggiana', 'Valle del Crostolo'],
      forests: ['Boschi di Carrega', 'Bosco della Mesola', 'Foresta di Montebello', 'Bosco di Ca’ Bosco'],
      lakes: ['Po', 'Enza', 'Lago Santo', 'Taro'],
      hills: ['Colline di Canossa', 'Lambrusco', 'Colli di Parma', 'Matilde di Canossa'],
      passes: IT_TOSC,
    },
  }),
  lario: sc({
    id: 'lario', label: 'Comer See und Voralpen', country: 'it', lang: 'it', region: 'po',
    styles: [['creme', 2], ['gelb', 1.5], ['lachs', 1.5], ['ocker', 1], ['bruchstein', 1]], alpine: 0.4, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'lombardia'],
    names: {
      villages: ['Bellagio', 'Magreglio', 'Erba', 'Asso', 'Valtorta', 'Moggio', 'Barzio', 'Lecco', 'Cassina Valsassina', 'Zogno', 'San Pellegrino Terme'],
      valleys: ['Valsassina', 'Val Brembana', 'Vallassina', 'Triangolo Lariano', 'Valle Imagna'],
      forests: ['Foresta di Val Biandino', 'Bosco della Brianza', 'Foresta del Resegone', 'Bosco di Montorfano'],
      lakes: ['Lago di Como', 'Lago di Lecco', 'Lago di Pusiano', 'Lago del Segrino'],
      hills: ['Brianza', 'Ghisallo', 'Miragolo San Salvatore', 'Alino'],
      passes: IT_LOMB,
    },
  }),
  mailand: sc({
    id: 'mailand', label: 'Monza und Mailand', country: 'it', lang: 'it', region: 'po',
    styles: [['haussmann', 2], ['creme', 2], ['gelb', 1.5], ['ocker', 1]], alpine: 0, floors: [4, 6], roof: 'tile', church: 'campanile', lamp: 'it', alley: 'lime', cobble: 0.5, flags: ['it', 'milano'],
    names: {
      villages: ['Sesto San Giovanni', 'Cinisello', 'Monza', 'Brera', 'Navigli', 'Porta Venezia', 'Isola', 'Città Studi', 'Lambrate', 'Bicocca'],
      valleys: ['Parco di Monza', 'Navigli', 'Brianza', 'Pianura lombarda', 'Valle del Lambro'],
      forests: ['Parco di Monza', 'Bosco in Città', 'Parco Nord', 'Parco Sempione'],
      lakes: ['Naviglio Grande', 'Darsena', 'Idroscalo', 'Lambro'],
      hills: ['Monte Stella', 'Brianza', 'Colle di Montevecchia', 'Montevecchia'],
      passes: IT_LOMB,
    },
  }),
  veltlin: sc({
    id: 'veltlin', label: 'Veltlin', country: 'it', lang: 'it', region: 'suedtirol',
    styles: [['bruchstein', 2.5], ['creme', 2], ['chalet', 1], ['ocker', 1]], alpine: 0.55, roof: 'lauze', church: 'campanile', lamp: 'it', flags: ['it', 'lombardia'],
    names: {
      villages: ['Sondrio', 'Tirano', 'Mazzo di Valtellina', 'Grosio', 'Ponte di Legno', 'Santa Caterina', 'Bormio', 'Edolo', 'Teglio', 'Tresenda'],
      valleys: ['Valtellina', 'Valcamonica', 'Valfurva', 'Valle del Mortirolo', 'Alta Valtellina'],
      forests: forests.it,
      lakes: ['Adda', 'Lago di Cancano', 'Lago Bianco', 'Lago Nero'],
      hills: ['Sassella', 'Grumello', 'Inferno', 'Valgella'],
      passes: IT_LOMB,
    },
  }),
  trentino: sc({
    id: 'trentino', label: 'Trentino', country: 'it', lang: 'it', region: 'suedtirol',
    styles: [['creme', 2], ['chalet', 2], ['gelb', 1], ['ocker', 1], ['bruchstein', 1]], alpine: 0.55, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'trentino'],
    names: {
      villages: ['Rovereto', 'Ponte Arche', 'Spiazzo', 'Tione', 'Pinzolo', 'Carisolo', 'Vigolo Vattaro', 'Bieno', 'Borgo Valsugana', 'Levico'],
      valleys: ['Val Rendena', 'Giudicarie', 'Valsugana', 'Vallagarina', 'Val di Daone', 'Val Genova'],
      forests: forests.it,
      lakes: ['Lago di Caldonazzo', 'Lago di Molveno', 'Lago di Levico', 'Lago di Tenno'],
      hills: ['Vallagarina', 'Marzemino', 'Altopiano della Vigolana', 'Monte Zugna'],
      passes: IT_ALPS,
    },
  }),
  karnien: sc({
    id: 'karnien', label: 'Friaul und Karnien', country: 'it', lang: 'it', region: 'dolomiten',
    styles: [['bruchstein', 2.5], ['creme', 2], ['chalet', 1.5], ['gelb', 0.6]], alpine: 0.6, roof: 'tile', church: 'campanile', lamp: 'it', flags: ['it', 'friuli'],
    names: {
      villages: ['Ovaro', 'Comeglians', 'Sutrio', 'Ravascletto', 'Paluzza', 'Tolmezzo', 'Ampezzo', 'Spilimbergo', 'Maniago', 'Barcis', 'Claut'],
      valleys: ['Val Degano', 'Valcalda', 'Val But', 'Val Tagliamento', 'Val Cellina', 'Carnia'],
      forests: ['Foresta di Tarvisio', 'Bosco Bandito', 'Foresta del Prescudin', 'Bosco di Pramosio'],
      lakes: ['Lago di Barcis', 'Lago di Sauris', 'Tagliamento', 'Lago di Verzegnis'],
      hills: ['Pedemontana pordenonese', 'Colli di Maniago', 'Ramandolo', 'Col Gentile'],
      passes: IT_FRIUL,
    },
  }),
  rom: sc({
    id: 'rom', label: 'Rom', country: 'it', lang: 'it', region: 'apennin',
    styles: [['ocker', 3], ['terrakotta', 2], ['gelb', 1.5], ['lachs', 1], ['creme', 1]], alpine: 0, floors: [3, 5], roof: 'tile', church: 'campanile', lamp: 'it', alley: 'pine', cobble: 0.8, flags: ['it', 'roma'],
    names: {
      villages: ['Trastevere', 'Testaccio', 'Aventino', 'Monti', 'Prati', 'Celio', 'San Lorenzo', 'Parioli', 'EUR', 'Ostiense'],
      valleys: ['Valle del Tevere', 'Campagna romana', 'Valle Murcia', 'Agro romano', 'Appia Antica'],
      forests: ['Villa Borghese', 'Villa Doria Pamphilj', 'Villa Ada', 'Pineta di Castel Fusano'],
      lakes: ['Tevere', 'Lago di Bracciano', 'Lago Albano', 'Laghetto dell’EUR'],
      hills: ['Aventino', 'Palatino', 'Gianicolo', 'Celio', 'Campidoglio'],
      passes: IT_APP,
    },
  }),
} satisfies Record<string, Scape>;

export type ScapeId = keyof typeof SCAPES;

// ------------------------------------------------------------------ Etappen

const S = SCAPES;
/** Anstieg der Gegend (ohne Länge und Steigung, wo sie nicht sicher bekannt sind) */
const cl = (name: string, alt?: number, len?: number, grad?: number, max?: number): Climb => ({
  name, cat: '?', km: 0, ...(alt ? { alt } : {}), ...(len ? { len } : {}), ...(grad ? { grad } : {}), ...(max ? { max } : {}),
});

type V = Omit<Venue, 'key' | 'tourId' | 'stage'>;
const v = (scape: Scape, place: string, marks: Mark[], blurb: string, o: Partial<V> = {}): V => ({ scape, place, marks, blurb, ...o });

const GIRO: Record<number, V> = {
  1: v(S.triest, 'Triest', ['piazzaUnita', 'faro', 'miramare'], 'Triest: Piazza Unità am Meer, Leuchtturm, Karst', { climb: cl('Salita di Opicina', 330) }),
  2: v(S.istrien, 'Koper', ['pretorio', 'harbour'], 'Koper/Capodistria: venezianische Altstadt am Hafen', { climb: cl('Kraški rob', 400) }),
  3: v(S.veneto, 'Possagno', ['tempioCanova'], 'Possagno: Canovas Tempel am Fuß des Monte Grappa', { climb: cl('Monte Grappa', 1775) }),
  4: v(S.romagna, 'Misano Adriatico', ['circuit'], 'Misano: Ziel auf der Rennstrecke, Adria-Riviera', { climb: cl('Monte Titano', 739) }),
  5: v(S.marken, 'Sarnano-Sassotetto', ['skiArea'], 'Sibillini: Backsteinstädtchen der Marken, Skigebiet Sassotetto'),
  6: v(S.abruzzen, 'Lanciano', ['torri'], 'Lanciano: Torri Montanare und Dom auf der Römerbrücke', { climb: cl('Salita di Lanciano', 283) }),
  7: v(S.abruzzen, 'Campo di Giove', ['acquedotto'], 'Sulmona: Aquädukt und Confetti-Läden, hinauf an die Maiella'),
  8: v(S.neapel, 'Neapel', ['vesuvio', 'castelOvo'], 'Neapel: Lungomare, Castel dell’Ovo, der Vesuv', { climb: cl('Posillipo', 150) }),
  9: v(S.latium, 'Subiaco-Monte Livata', ['monastero', 'skiArea'], 'Subiaco: Klöster im Fels, Buchenwälder am Monte Livata'),
  10: v(S.umbrien, 'Norcia', ['mura', 'basilicaNorcia'], 'Norcia: Stadtmauer, San Benedetto, Hochebene von Castelluccio', { climb: cl('Forca di Presta', 1536) }),
  11: v(S.toskana, 'Scarperia (Mugello)', ['circuit'], 'Mugello: Zypressen, Villen und Ziel auf der Rennstrecke', { climb: cl('Passo del Giogo', 882) }),
  12: v(S.toskana, 'Zeri', ['terme', 'skiArea'], 'Montecatini Terme und Lunigiana: Kastanienwälder, Steindörfer'),
  13: v(S.emilia, 'Reggio Emilia', ['tricolore'], 'Reggio Emilia: Laubengänge, Wiege der Trikolore', { climb: cl('Canossa', 576) }),
  14: v(S.lario, 'Piani di Bobbio', ['ghisallo', 'skiArea'], 'Comer See: Madonna del Ghisallo, Lifte der Piani di Bobbio'),
  15: v(S.mailand, 'Mailand', ['autodromo', 'duomoMilano', 'tram'], 'Monza und Mailand: Autodromo, Dom und Straßenbahn', { climb: cl('Montevecchia', 479) }),
  16: v(S.veltlin, 'Aprica', ['skiArea'], 'Veltlin: Weinterrassen, Mortirolo und Gavia', { climb: cl('Passo del Mortirolo', 1852, 12.8, 10.1, 18) }),
  17: v(S.veneto, 'Vo’', [], 'Euganeische Hügel: Weinberge, Villen, steile Muri', { climb: cl('Monte della Madonna', 523) }),
  18: v(S.trentino, 'Madonna di Campiglio', ['skiArea'], 'Val Rendena: Holzbalkone, Brenta-Dolomiten über Campiglio'),
  19: v(S.veneto, 'Sacile', ['campana', 'livenza'], 'Sacile: venezianische Palazzi am Livenza, Glocke von Rovereto', { climb: cl('Castello di Caneva') }),
  20: v(S.karnien, 'Monte Zoncolan', ['skiArea'], 'Karnien: Steinhäuser mit Holzbalkonen, hinauf zum Zoncolan'),
  21: v(S.rom, 'Rom', ['colosseo', 'circoMassimo', 'vittoriano'], 'Rom: Circus Maximus, Kolosseum, Pinien und Sampietrini', { climb: cl('Aventino', 46) }),
};

const TOUR: Record<number, V> = {
  1: v(S.grenzland, 'Carlisle', ['citadel', 'carlisleCastle', 'drystone'], 'Scottish Borders und Carlisle: Sandstein, Schiefer, Trockenmauern'),
  2: v(S.lancashire, 'Liverpool', ['liver', 'albertDock', 'drystone'], 'Lake District und Liverpool: Backsteinzeilen, Liver Building'),
  3: v(S.wales, 'Cardiff', ['cardiffCastle', 'pierhead', 'chapel'], 'Wales: Reihenhäuser der Rhondda, Kapellen, Cardiff Castle'),
  4: v(S.cotentin, 'Cherbourg-en-Cotentin', ['harbour', 'gatteville'], 'Cotentin: Granit und Schiefer, Hafen, Leuchtturm von Gatteville', { climb: cl('Montagne du Roule', 117) }),
  5: v(S.bretagne, 'Plumelec', ['calvaire', 'menhir', 'montStMichel'], 'Bretagne: Granit, Kalvarienberge, Gwenn-ha-Du'),
  6: v(S.anjou, 'Angers', ['angers'], 'Anjou: Tuffstein und Schiefer, Schloss Angers'),
  7: v(S.anjou, 'Chambord', ['chambord'], 'Loire: Schloss Chambord, Tuffstein, Platanen'),
  8: v(S.burgund, 'Le Creusot', ['marteau'], 'Morvan und Le Creusot: Burgunder Dächer, Dampfhammer'),
  9: v(S.bugey, 'Grand Colombier', ['etangs'], 'Dombes und Bugey: Teiche, Kalkstein, Bergdörfer'),
  10: v(S.savoyen, 'Sallanches', ['palaisIsle', 'montBlanc'], 'Hochsavoyen: Chalets, Annecy, Blick auf den Mont Blanc'),
  11: v(S.savoyen, 'Les Saisies', ['montBlanc'], 'Beaufortain: Chalets, Almen, Les Saisies'),
  12: v(S.dauphine, 'Valence', ['elephants'], 'Chambéry und Valence: Elefantenbrunnen, Rhonetal'),
  13: v(S.languedoc, 'Montpellier', ['peyrou'], 'Cevennen und Montpellier: Aquädukt Saint-Clément, Platanen'),
  14: v(S.cevennen, 'Mende', ['mende'], 'Cevennen: Schiefer und Lauze, Kathedrale von Mende'),
  15: v(S.albi, 'Albi', ['albi'], 'Albi: Backsteinkathedrale Sainte-Cécile über dem Tarn', { climb: cl('Côte de Cordes-sur-Ciel') }),
  16: v(S.toulouse, 'Toulouse', ['sernin'], 'Toulouse: rosa Backstein, Saint-Sernin, Garonne'),
  17: v(S.bearn, 'Pau', ['chateauPau'], 'Pau: Boulevard des Pyrénées und Schloss'),
  18: v(S.bigorre, 'Col du Portet', ['geant'], 'Hautes-Pyrénées: Tourmalet, Saint-Lary, Col du Portet'),
  19: v(S.baskenland, 'Laruns', ['fronton'], 'Baskenland und Ossau: weiße Häuser mit roten Balken, Pelota-Wände'),
  20: v(S.gironde, 'Libourne', ['bastide'], 'Gironde: Weinberge von Saint-Émilion, Bastide von Libourne'),
  21: v(S.paris, 'Paris', ['arc', 'eiffel', 'obelisk', 'sacreCoeur', 'montmartre', 'seine'], 'Paris: Champs-Élysées, Arc de Triomphe, Montmartre', {
    climb: cl('Côte de la Butte Montmartre', 130, 1.1, 5.9, 11),
    towns: ['Saint-Quentin-en-Yvelines', 'Versailles', 'Montmartre', 'Concorde', 'Champs-Élysées'],
  }),
};

const CAT: Record<Venue['tourId'], Record<number, V>> = { 'giro-2027': GIRO, 'tour-2027': TOUR };

/** Rundfahrt-Kennung aus dem Namen („Tour de France 2027“ → tour-2027) */
export function tourIdOf(name: string | null | undefined): Venue['tourId'] | null {
  if (!name) return null;
  if (/giro/i.test(name) && /2027/.test(name)) return 'giro-2027';
  if (/tour de france/i.test(name) && /2027/.test(name)) return 'tour-2027';
  return null;
}

export function venueOf(tourId: Venue['tourId'] | null, stage: number): Venue | null {
  if (!tourId) return null;
  const x = CAT[tourId]?.[stage];
  return x ? { key: `${tourId}:${stage}`, tourId, stage, ...x } : null;
}

/** alle Schauplätze (Admin-Auswahl, Tests) */
export function allVenues(): Venue[] {
  const out: Venue[] = [];
  for (const id of Object.keys(CAT) as Venue['tourId'][]) for (const n of Object.keys(CAT[id]).map(Number)) out.push(venueOf(id, n)!);
  return out;
}

/** Vorschau eines Schauplatzes (Admins, localStorage) */
export const VENUE_KEY = 'gruppetto.etappe';

/** ?etappe=tour-2027:21 oder die gespeicherte Wahl – sonst null */
export function forcedVenue(): { tourId: Venue['tourId']; stage: number } | null {
  try {
    const m = /[?&]etappe=([a-z]+-\d{4}):(\d+)/i.exec(window.location.search);
    const raw = m ? `${m[1]}:${m[2]}` : localStorage.getItem(VENUE_KEY);
    if (!raw) return null;
    const [id, n] = raw.split(':');
    const tourId = id === 'giro-2027' || id === 'tour-2027' ? id : null;
    const stage = Number(n);
    return tourId && venueOf(tourId, stage) ? { tourId, stage } : null;
  } catch {
    return null;
  }
}

/** Name einer Abschnittsliste der Gegend an Stelle des Dolomiten-Namens (gleicher Zufall, anderer Name) */
export function localName(list: readonly string[], picked: string, local: readonly string[] | undefined): string {
  if (!local?.length) return picked;
  const i = list.indexOf(picked);
  return i < 0 ? picked : local[i % local.length];
}
