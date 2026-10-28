/**
 * Regionen: die Landschaft der Finale richtet sich nach der Gegend der echten Etappe – Zypressen und
 * Olivenhaine in der Toskana, Palmen und Meer an der Riviera, Pappelreihen und Reisfelder in der
 * Po-Ebene, Apfelplantagen in Südtirol, grüne Weiden in den Pyrenäen, trockene Hänge in Spanien.
 * Abgeleitet aus Rundfahrt, Start- und Zielort; ohne Treffer entscheidet die Etappenart.
 */
import type { StageKind } from '../../lib/types';

export type Region = 'dolomiten' | 'suedtirol' | 'po' | 'toskana' | 'riviera' | 'apennin' | 'alpen' | 'pyrenaeen' | 'provence' | 'nord' | 'spanien' | 'andalusien';

export interface RegionLook {
  /** Bäume im Tal (Seeufer, Weinberge, Dorf): Art → Gewicht */
  valley: [string, number][];
  /** Bäume in Wäldern des Tals */
  forest: [string, number][];
  /** Farbton der Wiesen (RGB, 0–255) und der Felder */
  meadow: [number, number, number];
  field: [number, number, number];
  /** Boden neben der Straße in den Tälern: Reihen aus Reben, Äpfeln oder Sonnenblumen bevorzugt */
  rows: 'vines' | 'apples' | 'sunflower' | 'none';
  /** Hausstile (Schlüssel aus facade.ts) für Städte */
  town: string[];
  /** Anteil Berghäuser (Chalet, Bruchstein) in Weilern */
  alpine: number;
  /** Küste: Seen werden zum Meer, Palmen an der Promenade */
  coast: boolean;
  /** Trockenes Land: weniger Wald, mehr Fels und Felder */
  dry: boolean;
  /** Beschreibung für die Startkarte */
  label: string;
}

export const LOOKS: Record<Region, RegionLook> = {
  dolomiten: { valley: [['tree', 0.4], ['treeRound', 0.3], ['larch', 0.3]], forest: [['pine', 0.6], ['larch', 0.4]], meadow: [111, 174, 63], field: [201, 178, 90], rows: 'none', town: ['ocker', 'creme', 'gelb', 'chalet', 'bruchstein'], alpine: 0.45, coast: false, dry: false, label: 'Dolomiten' },
  suedtirol: { valley: [['apple', 0.55], ['treeRound', 0.25], ['tree', 0.2]], forest: [['pine', 0.6], ['larch', 0.4]], meadow: [118, 178, 70], field: [150, 182, 86], rows: 'apples', town: ['creme', 'ocker', 'gelb', 'chalet', 'lachs'], alpine: 0.5, coast: false, dry: false, label: 'Südtirol' },
  po: { valley: [['poplar', 0.6], ['tree', 0.25], ['treeRound', 0.15]], forest: [['poplar', 0.5], ['tree', 0.5]], meadow: [124, 176, 78], field: [206, 186, 96], rows: 'sunflower', town: ['creme', 'gelb', 'ocker', 'lachs', 'terrakotta'], alpine: 0.02, coast: false, dry: false, label: 'Po-Ebene' },
  toskana: { valley: [['cypress', 0.45], ['olive', 0.35], ['treeRound', 0.2]], forest: [['tree', 0.5], ['cypress', 0.3], ['pine', 0.2]], meadow: [150, 168, 78], field: [214, 184, 98], rows: 'vines', town: ['ocker', 'terrakotta', 'creme', 'ocker', 'gelb'], alpine: 0.0, coast: false, dry: true, label: 'Toskana' },
  riviera: { valley: [['palm', 0.4], ['cypress', 0.25], ['olive', 0.2], ['treeRound', 0.15]], forest: [['pine', 0.6], ['olive', 0.4]], meadow: [136, 170, 82], field: [206, 190, 110], rows: 'vines', town: ['lachs', 'gelb', 'creme', 'ocker', 'terrakotta'], alpine: 0.0, coast: true, dry: true, label: 'Küste' },
  apennin: { valley: [['tree', 0.4], ['olive', 0.25], ['cypress', 0.2], ['treeRound', 0.15]], forest: [['tree', 0.6], ['pine', 0.4]], meadow: [128, 170, 72], field: [200, 180, 96], rows: 'vines', town: ['ocker', 'creme', 'terrakotta', 'bruchstein', 'gelb'], alpine: 0.2, coast: false, dry: false, label: 'Apennin' },
  alpen: { valley: [['tree', 0.4], ['treeRound', 0.3], ['larch', 0.3]], forest: [['pine', 0.5], ['larch', 0.5]], meadow: [112, 172, 66], field: [196, 176, 92], rows: 'none', town: ['creme', 'haussmann', 'ocker', 'chalet', 'gelb'], alpine: 0.5, coast: false, dry: false, label: 'Alpen' },
  pyrenaeen: { valley: [['tree', 0.5], ['treeRound', 0.35], ['larch', 0.15]], forest: [['tree', 0.6], ['pine', 0.4]], meadow: [96, 168, 72], field: [160, 184, 92], rows: 'none', town: ['bruchstein', 'creme', 'ocker', 'haussmann', 'bruchstein'], alpine: 0.55, coast: false, dry: false, label: 'Pyrenäen' },
  provence: { valley: [['cypress', 0.35], ['olive', 0.35], ['tree', 0.3]], forest: [['pine', 0.6], ['tree', 0.4]], meadow: [152, 164, 84], field: [216, 188, 104], rows: 'vines', town: ['ocker', 'creme', 'lachs', 'gelb', 'haussmann'], alpine: 0.0, coast: false, dry: true, label: 'Provence' },
  nord: { valley: [['tree', 0.5], ['poplar', 0.3], ['treeRound', 0.2]], forest: [['tree', 0.7], ['pine', 0.3]], meadow: [104, 170, 70], field: [196, 182, 104], rows: 'none', town: ['backstein', 'backstein', 'creme', 'haussmann', 'fachwerk'], alpine: 0.0, coast: false, dry: false, label: 'Norden' },
  spanien: { valley: [['olive', 0.5], ['cypress', 0.2], ['treeRound', 0.3]], forest: [['pine', 0.6], ['olive', 0.4]], meadow: [160, 160, 80], field: [218, 190, 110], rows: 'vines', town: ['creme', 'ocker', 'terrakotta', 'gelb', 'creme'], alpine: 0.1, coast: false, dry: true, label: 'Spanien' },
  andalusien: { valley: [['olive', 0.6], ['palm', 0.2], ['treeRound', 0.2]], forest: [['pine', 0.5], ['olive', 0.5]], meadow: [168, 162, 84], field: [222, 196, 118], rows: 'none', town: ['creme', 'creme', 'ocker', 'gelb', 'terrakotta'], alpine: 0.0, coast: true, dry: true, label: 'Andalusien' },
};

const T: [RegionExp, Region][] = [];
type RegionExp = RegExp;
const add = (re: RegExp, r: Region) => T.push([re, r]);
// Italien
add(/siena|firenze|florenz|lucca|pisa|viareggio|massa|montalcino|arezzo|chianti|volterra|san gimignano|prato|pistoia|grosseto|livorno|pienza|cortona/i, 'toskana');
add(/sanremo|san remo|imperia|genova|genua|chiavari|savona|napoli|neapel|salerno|amalfi|sorrento|bari|brindisi|rimini|pesaro|ancona|cervia|ravenna|catanzaro|paestum|formia|gaeta|terracina|nessebar|burgas|sozopol|varna|lido|jesolo|trieste|portofino|alassio|finale ligure|reggio calabria|messina|taormina|catania|cagliari|olbia|alghero|porto|fermo|senigallia|fano/i, 'riviera');
add(/novara|pavia|cremona|piacenza|parma|modena|bologna|verona|mantova|vicenza|treviso|novi ligure|alessandria|asti|torino|turin|vercelli|lodi|brescia|bergamo|padova|padua|ferrara|reggio emilia|carpi|milano|mailand|monza|udine|pordenone|gorizia|rovigo|chioggia/i, 'po');
add(/bolzano|bozen|brixen|bressanone|merano|meran|trento|trient|rovereto|kaltern|caldaro|eppan|appiano|sterzing|vipiteno|bruneck|brunico|lana|schlanders|silandro/i, 'suedtirol');
add(/cortina|alleghe|corvara|gardena|gröden|bormio|livigno|aosta|pila|sestriere|selva|canazei|arabba|madonna di campiglio|andalo|ponte di legno|aprica|cervinia|courmayeur|stelvio|gavia|mortirolo|san pellegrino|fedaia|giau|pordoi|tre cime|lavaredo|monte bondone|cima grappa|asiago|folgaria|lago laceno|passo/i, 'dolomiten');
add(/blockhaus|potenza|corno alle scale|abetone|carpegna|perugia|chieti|l'aquila|aquila|campo imperatore|gran sasso|terminillo|roccaraso|spoleto|assisi|urbino|gubbio|norcia|cosenza|lagonegro|maratea|sila|pescasseroli|tivoli|rieti|frascati|viterbo|roma|rom\b/i, 'apennin');
// Frankreich
add(/pau|lourdes|laruns|tourmalet|hautacam|luz|foix|bagn[eè]res|peyragudes|superbagn[eè]res|plateau de beille|cauterets|saint-lary|pla d'adet|lannemezan|tarbes|carcassonne|ax 3|andorra|andorre|col du portet|aspin|peyresourde|marie-blanque|aubisque/i, 'pyrenaeen');
add(/alpe d'huez|courchevel|briançon|briancon|grenoble|annecy|morzine|meg[eè]ve|isola|galibier|izoard|madeleine|croix de fer|glandon|chamonix|albertville|bourg|valloire|la plagne|tignes|val thorens|les arcs|saint-gervais|col de la loze|joux plane|semnoz|chambéry|chambery|aix-les-bains|gap|embrun|barcelonnette|vars|superdévoluy|superdevoluy/i, 'alpen');
add(/ventoux|nîmes|nimes|avignon|montpellier|marseille|nice|nizza|toulon|aix-en-provence|arles|orange|apt|digne|manosque|cannes|antibes|menton|fréjus|frejus|carpentras|b[ée]doin|malaucène|malaucene|gordes|sisteron|narbonne|béziers|beziers|perpignan|sète|sete|agde/i, 'provence');
add(/lille|roubaix|dunkerque|dunkirk|arras|reims|amiens|calais|boulogne|lens|valenciennes|cambrai|saint-quentin|laon|compiègne|compiegne|paris|rouen|le havre|caen|cherbourg|bruxelles|brussels|brüssel|antwerpen|gent|brugge|bruges|leuven|liège|lüttich|oudenaarde|kortrijk|ypres|ieper|mons|charleroi|namur|copenhagen|kopenhagen|roskilde|nyborg|sønderborg|bilbao|san sebastián|san sebastian|vitoria|amorebieta|edinburgh|carlisle|keswick|liverpool|welshpool|cardiff|london|leeds|harrogate|york|sheffield|glasgow|manchester|cambridge|brighton|dundee|aberdeen|basel|freiburg|mulhouse|strasbourg|straßburg|colmar|metz|nancy|verdun|épernay|epernay|troyes|dijon|besançon|besancon|belfort|la planche|ballon d'alsace|markstein|grand ballon/i, 'nord');
// Spanien
add(/sevilla|seville|granada|córdoba|cordoba|málaga|malaga|cádiz|cadiz|jaén|jaen|almería|almeria|huelva|marbella|ronda|jerez|sierra nevada|antequera|úbeda|ubeda|baeza|estepona|motril|lanjarón|velefique|alto de velefique|murcia|cartagena|alicante|benidorm|elche|valencia|castellón|castellon/i, 'andalusien');

function kindRegion(tour: string, kind: StageKind | null | undefined): Region {
  if (/giro/i.test(tour)) return kind === 'mountain' ? 'dolomiten' : kind === 'hilly' ? 'apennin' : 'po';
  if (/vuelta/i.test(tour)) return 'spanien';
  if (/tour/i.test(tour)) return kind === 'mountain' ? 'alpen' : kind === 'hilly' ? 'provence' : 'nord';
  return 'dolomiten';
}

/** Region einer Etappe aus Rundfahrt und Orten (Ziel zählt vor Start) */
export function regionOf(tour: string, from: string, to: string, kind: StageKind | null | undefined): Region {
  for (const place of [to, from]) {
    if (!place) continue;
    for (const [re, r] of T) if (re.test(place)) return r;
  }
  return kindRegion(tour, kind);
}

/** gewichtete Auswahl aus einer Artenliste (x in 0…1) */
export function pickWeighted(list: [string, number][], x: number): string {
  let s = 0;
  for (const [, w] of list) s += w;
  let acc = x * s;
  for (const [k, w] of list) { acc -= w; if (acc <= 0) return k; }
  return list[list.length - 1][0];
}
