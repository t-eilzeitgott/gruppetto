// Saison 2027: alles, was bisher über Giro, Tour und Vuelta feststeht.
// Daraus entstehen supabase/seed_2027.sql (node scripts/season2027/build-sql.ts) und die
// Tour-Etappen im Demo-Modus. Stand: 26. Oktober 2026.
//
// Tour de France 2027 – Strecke offiziell seit der Präsentation am 22.10.2026 (letour.fr):
//   Datum, Start/Ziel, Distanz, Etappentyp und Höhenmeter („D+“) von den Etappenseiten,
//   Durchfahrtsorte mit Kilometer und Höhe sowie die Anstiege (Länge, Steigung, Gipfelhöhe)
//   aus den offiziellen Profilen; Maximalsteigungen aus den Detailprofilen der Schlüsselanstiege.
//   Kategorien der Bergwertungen und Zwischensprints stehen erst im Roadbook (Juni 2027): cat '?'.
// Giro d'Italia 2027 – offiziell nur 8.–30. Mai mit Start in Triest; Präsentation am 3.11.2026 in Rom.
// La Vuelta 2027 – offiziell 4.–26. September, Start in Santiago de Compostela, Ziel in Madrid;
//   Präsentation im Dezember 2026.
// Giro und Vuelta bekommen ihre Etappen, sobald die Strecken präsentiert sind.
import type { Climb, StageKind, TourInfo } from '../lib/types';

export interface SeasonWaypoint {
  km: number;
  alt: number;
  name: string;
}

export interface SeasonStage {
  n: number;
  date: string; // YYYY-MM-DD
  from: string | null;
  to: string | null;
  km: number | null;
  kind: StageKind;
  /** Höhenmeter laut Veranstalter */
  elevation?: number;
  climbs?: Climb[];
  /** Durchfahrtsorte aus dem offiziellen Profil (ergeben das Höhenprofil) */
  waypoints?: SeasonWaypoint[];
  /** Streckenbeschreibung (deutsch) */
  route?: string;
}

export interface SeasonTour {
  id: string;
  name: string;
  /** Quelle für die Kommentare im SQL und das Höhenprofil */
  source: string;
  /** Quelle, die in der App unter der Streckenbeschreibung steht */
  routeSource?: string;
  info?: TourInfo;
  stages: SeasonStage[];
}

// Ein Eintrag je Durchfahrtsort; mit Länge/Steigung ist es eine Bergwertung (Gipfel bei km).
type P = [km: number, alt: number, name: string, len?: number, grad?: number, max?: number];

function profile(points: P[]): { waypoints: SeasonWaypoint[]; climbs: Climb[] } {
  const waypoints = points.map(([km, alt, name]) => ({ km, alt, name }));
  const climbs: Climb[] = points
    .filter((p) => p[3] !== undefined)
    .map(([km, alt, name, len, grad, max]) => ({
      name, cat: '?', km, len, grad, ...(max ? { max } : {}), alt,
    }));
  return { waypoints, climbs };
}

const tdf = (n: number, date: string, from: string, to: string, km: number, kind: StageKind, elevation: number, route: string, points?: P[]): SeasonStage => ({
  n, date, from, to, km, kind, elevation, route, ...(points ? profile(points) : {}),
});

const TOUR: SeasonStage[] = [
  tdf(1, '2027-07-02', 'Edinburgh', 'Carlisle', 185, 'flat', 2000,
    'Von Edinburgh durch die Scottish Borders über Innerleithen, Galashiels und Hawick nach England. Einzige Bergwertung ist die Côte de Melrose (2,2 km, 6,7 %) bei km 65, danach wellig und zum Schluss flach nach Carlisle.',
    [[0, 70, 'Edinburgh'], [18, 407, 'Broad Law (Heriot)'], [36, 155, 'Innerleithen'], [53, 157, 'Galashiels'],
      [65, 247, 'Côte de Melrose', 2.2, 6.7], [91.5, 142, 'Hawick'], [125.5, 106, 'Newcastleton'], [151.5, 12, 'Longtown'],
      [169, 65, 'Brampton'], [185, 21, 'Carlisle']]),
  tdf(2, '2027-07-03', 'Keswick', 'Liverpool', 223, 'hilly', 3000,
    'Aus dem Lake District nach Lancashire. In der zweiten Hälfte fünf kurze Bergwertungen – Jubilee Tower, Trough of Bowland, Waddington Fell, Belmont und Parbold bei km 183 –, dann flach nach Liverpool.',
    [[0, 166, 'Keswick'], [28.5, 110, 'Windermere'], [52.5, 46, 'Milnthorpe'], [65.5, 24, 'Carnforth'], [76, 10, 'Lancaster'],
      [88, 285, 'Côte de Jubilee Tower', 3.8, 6.1], [98.5, 293, 'Côte de Trough of Bowland', 1.9, 5.2],
      [112, 347, 'Côte de Waddington Fell', 3.4, 6.4], [132.5, 150, 'Blackburn'], [152.5, 326, 'Côte de Belmont', 2, 4],
      [161, 108, 'Chorley'], [183, 122, 'Côte de Parbold', 1.8, 5.6], [206, 83, 'Prescot'], [223, 24, 'Liverpool']]),
  tdf(3, '2027-07-04', 'Welshpool', 'Cardiff', 223, 'hilly', 3000,
    'Komplett durch Wales mit acht Bergwertungen, die meisten im letzten Drittel durch die Rhondda-Täler: Rhigos, Penrhys (1,3 km, 10,1 %), Maerdy, Hengoed (0,7 km, 11 %) und 12,5 km vor dem Ziel die Côte de Caerphilly (2 km, 8,2 %, bis 11,8 %).',
    [[0, 72, 'Welshpool'], [15.5, 104, 'Newtown'], [59.5, 201, 'Llandrindod Wells'], [72, 123, 'Builth Wells'],
      [85.5, 450, "Côte d'Epynt", 3.7, 7.9], [107, 190, 'Brecon'], [121.5, 441, 'Côte de Bannau Brycheiniog', 6.6, 3.5],
      [138.5, 199, 'Hirwaun'], [145.5, 486, 'Côte de Rhigos', 4.6, 5.8], [154.5, 170, 'Treorchy'],
      [160.5, 284, 'Côte de Penrhys', 1.3, 10.1], [163, 224, 'Ferndale'], [169, 408, 'Côte de Maerdy', 1.5, 8.7],
      [174, 204, 'Aberdare'], [188.5, 138, 'Nelson'], [197.5, 194, 'Côte de Hengoed', 0.7, 11], [206, 84, 'Caerphilly'],
      [210.5, 249, 'Côte de Caerphilly', 2, 8.2, 11.8], [223, 14, 'Cardiff']]),
  tdf(4, '2027-07-06', 'Cherbourg-en-Cotentin', 'Cherbourg-en-Cotentin', 171, 'hilly', 2200,
    'Erste Etappe in Frankreich, ein Rundkurs über die Halbinsel Cotentin: erst durch La Hague im Westen, dann an der Ostküste über Saint-Vaast-la-Hougue und Barfleur zurück. Keine Bergwertung, aber ständig wellig.',
    [[0, 6, 'Cherbourg-en-Cotentin'], [22, 65, 'Saint-Germain-des-Vaux'], [34.5, 163, 'Beaumont-Hague'], [47, 101, 'Vasteville'],
      [66.5, 108, 'Les Pieux'], [82, 43, 'Bricquebec-en-Cotentin'], [94, 33, 'Valognes'], [113, 3, 'Saint-Vaast-la-Hougue'],
      [124, 4, 'Barfleur'], [135, 15, 'Quettehou'], [146.5, 108, 'Saint-Pierre-Église'], [171, 83, 'Cherbourg-en-Cotentin']]),
  tdf(5, '2027-07-07', 'Pontorson', 'Plumelec', 178, 'hilly', 1900,
    'Start an der Bucht des Mont-Saint-Michel, quer durch die Bretagne. Im Finale zweimal die Côte de Cadoudal (1,7 km, 6,2 %): bei km 164 und als Zielanstieg in Plumelec.',
    [[0, 9, 'Pontorson'], [2.5, 6, 'Baie du Mont-Saint-Michel'], [15, 49, 'Pleine-Fougères'], [34, 81, 'Combourg'],
      [57, 138, 'Bécherel'], [87.5, 108, 'Saint-Méen-le-Grand'], [122.5, 63, 'Ploërmel'], [142.5, 66, 'Sérent'],
      [164, 153, 'Côte de Cadoudal', 1.7, 6.2, 7.2], [178, 153, 'Plumelec – Côte de Cadoudal', 1.7, 6.2, 7.2]]),
  tdf(6, '2027-07-08', 'Vannes', 'Angers', 193, 'hilly', 1500,
    'Von der Bretagne an die Loire, ohne Bergwertung und mit nur 1.500 Höhenmetern – eine Chance für die Sprinter.',
    [[0, 11, 'Vannes'], [11, 131, 'Sulniac'], [30.5, 62, 'Rochefort-en-Terre'], [54, 16, 'Redon'], [74, 7, 'Guémené-Penfao'],
      [93.5, 67, 'Nozay'], [143.5, 38, 'Candé'], [184, 29, 'Bouchemaine'], [193, 41, 'Angers']]),
  tdf(7, '2027-07-09', 'Blois', 'Chambord', 38, 'itt', 200,
    'Flaches Einzelzeitfahren durch das Loiretal über Cellettes, Cour-Cheverny und Mont-près-Chambord zum Schloss Chambord.',
    [[0, 106, 'Blois'], [8, 100, 'Cellettes'], [18.5, 90, 'Cour-Cheverny'], [26, 93, 'Mont-près-Chambord'], [38, 85, 'Chambord']]),
  tdf(8, '2027-07-10', 'Bourges', 'Le Creusot', 224.5, 'hilly', 3100,
    'Längste Etappe der Tour. Flach bis Nevers, dann durch den Morvan (Col de la Gravelle, 774 m). Im Finale die Côte de la Croix de la Libération (4,6 km, 5,3 %) und 18 km vor dem Ziel der Signal d’Uchon (5,7 km, 5,7 %, Rampe mit 18 %).',
    [[0, 150, 'Bourges'], [19, 171, 'Avord'], [43, 179, "La Guerche-sur-l'Aubois"], [62.5, 172, 'Nevers'],
      [83.5, 236, "Saint-Benin-d'Azy"], [105, 250, 'Châtillon-en-Bazois'], [129, 495, 'Château-Chinon'],
      [143.5, 774, 'Col de la Gravelle'], [153.5, 675, 'Glux-en-Glenne'], [162.5, 439, 'Saint-Léger-sous-Beuvray'],
      [180.5, 282, 'Autun'], [189, 577, 'Côte de la Croix de la Libération', 4.6, 5.3], [198, 304, 'Mesvres'],
      [206.5, 635, "Signal d'Uchon", 5.7, 5.7, 18], [224.5, 371, 'Le Creusot']]),
  tdf(9, '2027-07-11', 'Villars-les-Dombes', 'Grand Colombier', 162, 'mountain', 3750,
    'Erste Bergankunft. Nach Col du Berthiand, Côte des Neyrolles und Col de Richemond geht es von Culoz hinauf zum Grand Colombier: 17,4 km mit 7,1 %, Abschnitte mit 12 %.',
    [[0, 279, 'Villars-les-Dombes (Parc des Oiseaux)'], [10.5, 299, 'Chalamont'], [26.5, 238, "Pont-d'Ain"], [37, 265, 'Poncin'],
      [47, 361, 'Hautecourt-Romanèche'], [57.5, 780, 'Col du Berthiand', 6.3, 7.5], [69.5, 479, 'Nantua'],
      [77, 825, 'Côte des Neyrolles', 3.6, 7.7], [84, 1144, 'Col de Bérentin'], [89.5, 1181, 'Col de Cuvéry'],
      [97.5, 753, 'Ochiaz'], [106.5, 542, 'Injoux'], [115, 1036, 'Col de Richemond', 7.7, 6], [136, 285, 'Artemare'],
      [144, 263, 'Culoz'], [162, 1501, 'Grand Colombier', 17.4, 7.1, 12]]),
  tdf(10, '2027-07-13', 'Annecy', 'Sallanches', 171, 'mountain', 3750,
    'Sechs Bergwertungen in Hochsavoyen: Col du Plan du Salève und Montée de Brison, dann ab Sallanches eine Schleife mit Côte de Domancy, Montée du Bettex und Côte du Plateau d’Assy. Die zweite Auffahrt zur Côte de Domancy (2,5 km, 9,4 %) endet 9 km vor dem Ziel.',
    [[0, 519, 'Annecy'], [4.5, 782, 'Ferrières'], [16, 785, 'Cruseilles'], [26, 1300, 'Col du Plan du Salève', 9.6, 5.4],
      [39.5, 677, 'La Muraz'], [55, 582, 'La Roche-sur-Foron'], [64, 452, 'Bonneville'], [74, 991, 'Montée de Brison', 5, 10.2],
      [87, 486, 'Cluses'], [107, 546, 'Sallanches (1. Zieldurchfahrt)'], [111.5, 810, 'Côte de Domancy', 2.5, 9.4, 11],
      [116.5, 1040, 'La Demi-Lune'], [126.5, 1353, 'Montée du Bettex', 5.5, 8], [132.5, 916, 'Saint-Gervais-les-Bains'],
      [140.5, 590, 'Chedde'], [147.5, 990, "Côte du Plateau d'Assy", 5.1, 7.5], [154, 737, 'Passy'],
      [162, 810, 'Côte de Domancy', 2.5, 9.4, 11], [171, 546, 'Sallanches']]),
  tdf(11, '2027-07-14', 'Cluses', 'Les Saisies', 150, 'mountain', 4750,
    'Kurze, schwere Bergetappe am Nationalfeiertag mit fünf Anstiegen: Col de la Colombière (15,9 km, 7 %), Col de la Croix Fry, Col de la Forclaz de Queige, Col du Pré (12,6 km, 7,8 %) und zum Schluss die Montée de Bisanne (12,4 km, 8,3 %) – das Ziel in Les Saisies liegt 4 km nach dem Gipfel.',
    [[0, 506, 'Cluses'], [16, 1618, 'Col de la Colombière', 15.9, 7], [26, 1003, 'Le Grand-Bornand'], [33, 1040, 'La Clusaz'],
      [40, 1477, 'Col de la Croix Fry', 7.2, 5.5], [52, 656, 'Thônes'], [67, 532, 'Saint-Ferréol'], [76, 422, 'Ugine'],
      [85, 853, 'Col de la Forclaz de Queige', 5.1, 8.2], [99.5, 726, 'Beaufort'], [113, 1748, 'Col du Pré', 12.6, 7.8, 11.3],
      [117.5, 1605, 'Col du Méraillet'], [130, 761, 'Beaufort'], [134, 711, 'Villard-sur-Doron'],
      [146, 1723, 'Montée de Bisanne', 12.4, 8.3, 10], [150, 1650, 'Les Saisies']]),
  tdf(12, '2027-07-15', 'Chambéry', 'Valence', 162, 'flat', 1600,
    'Aus den Alpen über Voiron und Roybon hinunter ins Rhonetal nach Valence, ohne Bergwertung – eine Etappe für die Sprinter.',
    [[0, 436, 'Chambéry'], [19.5, 400, 'Saint-Laurent-du-Pont'], [35.5, 347, 'Voiron'], [56, 236, 'Tullins-Fures'], [70.5, 267, 'Vinay'],
      [90, 541, 'Roybon'], [107.5, 312, 'Hauterives'], [133, 169, 'Romans-sur-Isère'], [162, 150, 'Valence']]),
  tdf(13, '2027-07-16', 'Aubenas', 'Montpellier', 164, 'flat', 1500,
    'Aus der Ardèche über Alès und Anduze ans Mittelmeer nach Montpellier, ohne Bergwertung.',
    [[0, 179, 'Aubenas'], [11, 273, 'Largentière'], [27, 248, 'Lablachère'], [56, 141, 'Saint-Ambroix'], [76, 136, 'Alès'],
      [91.5, 143, 'Anduze'], [112, 96, 'Quissac'], [133, 113, 'Saint-Mathieu-de-Tréviers'], [157, 54, 'Castelnau-le-Lez'],
      [164, 19, 'Montpellier']]),
  tdf(14, '2027-07-17', 'Montpellier', 'Mende', 199, 'mountain', 4300,
    'Durch den Cirque de Navacelles in die Cevennen: Col du Vent, Col de la Lusette (11,6 km, 7,3 %) und Mont Aigoual (1.552 m). Im Finale die Côte de l’Estrade und die Montée Jalabert (Côte de la Croix Neuve, 3 km, 10,1 %), deren Gipfel 1,5 km vor dem Ziel liegt.',
    [[0, 87, 'Montpellier'], [20, 106, 'Aniane'], [40.5, 703, 'Col du Vent', 8.4, 5.8], [55, 575, 'Saint-Maurice-Navacelles'],
      [64.5, 340, 'Cirque de Navacelles'], [87, 230, 'Le Vigan'], [108.5, 1351, 'Col de la Lusette', 11.6, 7.3],
      [122, 1552, 'Mont Aigoual'], [157, 554, 'Florac-Trois-Rivières'], [175, 1002, "Côte de l'Estrade", 5.7, 8.3],
      [197.5, 1055, 'Côte de la Croix Neuve (Montée Jalabert)', 3, 10.1, 10.9], [199, 1030, 'Mende']]),
  tdf(15, '2027-07-18', 'Rodez', 'Albi', 168, 'hilly', 2500,
    'Ständig auf und ab durch Aveyron und Tarn, ohne Bergwertung, zum Schluss hinunter nach Albi.',
    [[0, 634, 'Rodez'], [39, 510, 'Naucelle'], [66.5, 715, 'Rieupeyroux'], [88.5, 364, 'Villefranche-de-Rouergue'],
      [125, 195, 'Laguépie'], [152.5, 211, 'Monestiés'], [168, 178, 'Albi']]),
  tdf(16, '2027-07-20', 'Toulouse', 'Toulouse', 33, 'itt', 200,
    'Flaches Einzelzeitfahren südlich von Toulouse entlang der Garonne – mit einer Ausnahme: der Côte de Pech David (0,8 km, 12,4 %) 9 km vor dem Ziel.',
    [[0, 140, 'Toulouse'], [6, 149, 'Portet-sur-Garonne'], [11, 145, 'Pinsaguel'], [15, 155, 'Lacroix-Falgarde'],
      [24, 249, 'Côte de Pech David', 0.8, 12.4], [26, 144, 'Toulouse-Empalot'], [33, 142, 'Toulouse']]),
  tdf(17, '2027-07-21', 'Muret', 'Pau', 186, 'flat', 2000,
    'Über die Hügel von Comminges und Bigorre nach Pau, ohne Bergwertung.',
    [[0, 183, 'Muret'], [20, 209, 'Carbonne'], [58, 423, 'Aurignac'], [80.5, 310, 'Boulogne-sur-Gesse'], [93, 289, 'Castelnau-Magnoac'],
      [109, 240, 'Trie-sur-Baïse'], [133, 221, 'Rabastens-de-Bigorre'], [140, 217, 'Vic-en-Bigorre'], [170.5, 289, 'Morlaàs'],
      [186, 203, 'Pau']]),
  tdf(18, '2027-07-22', 'Pau', 'Saint-Lary-Soulan (Col du Portet)', 174, 'mountain', 5400,
    'Königsetappe mit 5.400 Höhenmetern: Col du Soulor, Col du Tourmalet (19 km, 7,4 %, Souvenir Jacques Goddet), Hourquette d’Ancizan und als Ziel der Col du Portet (16 km, 8,7 %) auf 2.215 m – der höchste Punkt der Tour (Souvenir Henri Desgrange).',
    [[0, 207, 'Pau'], [21, 301, 'Asson'], [50, 1474, 'Col du Soulor', 11.8, 7.3], [70.5, 447, 'Argelès-Gazost'],
      [87.5, 714, 'Luz-Saint-Sauveur'], [106.5, 2115, 'Col du Tourmalet (Souvenir Jacques Goddet)', 19, 7.4, 10.9],
      [123.5, 867, 'Sainte-Marie-de-Campan'], [140.5, 1564, "Hourquette d'Ancizan", 8.2, 5.1], [156, 808, 'Saint-Lary-Soulan'],
      [174, 2215, 'Col du Portet (Souvenir Henri Desgrange)', 16, 8.7]]),
  tdf(19, '2027-07-23', 'Hasparren', 'Laruns', 160, 'mountain', 4300,
    'Letzte Bergetappe durch das Baskenland und das Béarn: Col de Burdincurutcheta (8,7 km, 9,3 %, Rampen mit 15 %), Col de Bagargui, Col de Soudet (15,1 km, 7,2 %) und 18,5 km vor dem Ziel der Col de Marie Blanque (7,7 km, 8,6 %).',
    [[0, 129, 'Hasparren'], [25, 190, 'Saint-Jean-le-Vieux'], [44.5, 1135, 'Col de Burdincurutcheta', 8.7, 9.3, 15],
      [52.5, 1330, 'Col de Bagargui', 4.8, 6.4, 9.7], [64.5, 624, 'Larrau'], [83.5, 593, 'Sainte-Engrâce'],
      [95.5, 1540, 'Col de Soudet', 15.1, 7.2], [116, 338, 'Arette'], [132, 325, 'Escot'],
      [141.5, 1035, 'Col de Marie Blanque', 7.7, 8.6], [160, 495, 'Laruns']]),
  tdf(20, '2027-07-24', 'Maubourguet', 'Libourne', 198, 'flat', 1700,
    'Flach durch Gers und Lot-et-Garonne in die Gironde nach Libourne.',
    [[0, 166, 'Maubourguet'], [12.5, 141, 'Plaisance du Gers'], [48.5, 166, 'Eauze'], [74, 106, 'Sos'], [109, 73, 'Casteljaloux'],
      [128.5, 122, 'Cocumont'], [148.5, 48, 'La Réole'], [161.5, 67, 'Sauveterre-de-Guyenne'], [180, 61, 'Saint-Quentin-de-Baron'],
      [198, 16, 'Libourne']]),
  tdf(21, '2027-07-25', 'Saint-Quentin-en-Yvelines', 'Paris (Champs-Élysées)', 116, 'flat', 800,
    'Schlussetappe von Saint-Quentin-en-Yvelines nach Paris, Ziel auf den Champs-Élysées.'),
];

export const SEASON_2027: SeasonTour[] = [
  {
    id: 'giro-2027',
    name: "Giro d'Italia 2027",
    source: 'RCS Sport: 8.–30. Mai, Start in Triest; Strecke folgt am 3.11.2026',
    // Reglement wie 2026 (Bergpunkte, Zwischensprints, Zeitbonus, Red Bull KM)
    info: {
      kom: { '1': [40, 18, 12, 9, 6, 4, 2, 1], '2': [18, 8, 6, 4, 2, 1], '3': [9, 4, 2, 1], '4': [3, 2, 1], CC: [50, 30, 20, 14, 10, 6, 4, 2, 1] },
      sprint_points: [12, 8, 5, 3, 1],
      finish_bonus: [10, 6, 4],
      redbull_bonus: [6, 4, 2],
      redbull_points: [15, 8, 5, 3, 1],
      stage_points: {
        'A/B (flach)': [50, 35, 25, 18, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1],
        'C (mittel)': [25, 18, 12, 8, 6, 5, 4, 3, 2, 1],
        'D/E (Berg, Zeitfahren)': [15, 12, 9, 7, 6, 5, 4, 3, 2, 1],
      },
    },
    stages: [],
  },
  {
    id: 'tour-2027',
    name: 'Tour de France 2027',
    source: 'Profil letour.fr (Streckenpräsentation 22.10.2026)',
    routeSource: 'offizielle Streckenpräsentation vom 22.10.2026 (Profile auf letour.fr)',
    // Reglement 2026 (das von 2027 erscheint erst kurz vor der Tour)
    info: {
      kom: { HC: [20, 15, 12, 10, 8, 6, 4, 2], '1': [10, 8, 6, 4, 2, 1], '2': [5, 3, 2, 1], '3': [2, 1], '4': [1] },
      sprint_points: [25, 20, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1],
      finish_bonus: [10, 6, 4],
      stage_points: {
        'Flach (Massensprint)': [70, 50, 40, 35, 30, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2],
        'Leicht wellig': [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2],
        'Hügelig, Berg': [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
        Zeitfahren: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      },
    },
    stages: TOUR,
  },
  {
    id: 'vuelta-2027',
    name: 'La Vuelta 2027',
    source: 'Unipublic: 4.–26. September, Start in Santiago de Compostela, Ziel in Madrid; Strecke folgt im Dezember 2026',
    stages: [],
  },
];

/** Höhenprofil aus den Durchfahrtsorten, ergänzt um den Fuß jedes Anstiegs (Gipfelhöhe − Länge × Steigung) */
export function profilePoints(stage: SeasonStage): [number, number][] {
  const pts = new Map<number, number>();
  for (const w of stage.waypoints ?? []) pts.set(w.km, w.alt);
  for (const c of stage.climbs ?? []) {
    if (c.len === undefined || c.grad === undefined || c.alt === undefined) continue;
    const foot = Math.round((c.km - c.len) * 10) / 10;
    const footAlt = Math.round(c.alt - c.len * c.grad * 10);
    // nur, wenn kein Durchfahrtsort im Anstieg liegt (sonst ist das Profil dort schon genauer)
    const inside = [...pts.keys()].some((k) => k > foot && k < c.km);
    if (foot > 0.5 && !inside && !pts.has(foot)) pts.set(foot, Math.max(0, footAlt));
  }
  return [...pts.entries()].sort((a, b) => a[0] - b[0]);
}
