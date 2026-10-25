// Giro d'Italia 2026 – echte Renndaten für die Testrunde.
// Quellen: Wikipedia (Etappen, Top 10, Gesamtwertung je Etappe, Endwertungen, Startliste),
// kirolakeitb.eus (Anstiege mit Kategorie und Kilometer), cyclingstage.com / Sky Sport /
// giroditalia.it, oasport.it (Längen, Steigungen, Maximalsteigung), Eurosport (Höhenmeter),
// tuttobiciweb.it (Reglement: Neutralisation, 3-Sekunden-Regel), Sky Sport (Fahrplan).
// Kilometer, Höhen und Kategorien der Bergwertungen, Sprints und Red Bull KM kommen beim Erzeugen
// aus roadbook.json (offizielles Roadbook „Garibaldi“) und überschreiben die Werte hier.
// cat: '1'–'4' Bergwertung, 'CC' = Cima Coppi (höchster Punkt des Giro)

// len/grad/max: Länge (km), Ø- und Maximalsteigung (%), alt: Gipfelhöhe (m, wo bekannt)
// info: Startzeit km 0 und Zielankunft (Fahrplan), neutral: Neutralisationszone bei Stürzen (km),
// threeSec: 3-Sekunden-Regel im Ziel
export const STAGES = [
  { n: 1, date: '2026-05-08', from: 'Nessebar', to: 'Burgas', km: 147, kind: 'flat', time: '3:21:08', elevation: 500, neutral: 5, threeSec: true,
    climbs: [{ name: 'Kap Agalina', cat: '4', km: 84.3, len: 1.2, grad: 2.2, max: 6 }, { name: 'Kap Agalina', cat: '4', km: 106.4, len: 1.2, grad: 2.2, max: 6 }],
    sprints: [{ km: 114.7 }] },
  { n: 2, date: '2026-05-09', from: 'Burgas', to: 'Veliko Tarnovo', km: 221, kind: 'hilly', time: '5:39:25', elevation: 2600,
    climbs: [{ name: 'Byala-Pass', cat: '3', km: 116.3, len: 7.7, grad: 4.6, max: 10 }, { name: 'Vratnik-Pass', cat: '3', km: 134.1, len: 9.1, grad: 4.4, max: 11 },
      { name: 'Lyaskovets-Kloster', cat: '3', km: 210.6, len: 3.9, grad: 6.8, max: 14 }] },
  { n: 3, date: '2026-05-10', from: 'Plovdiv', to: 'Sofia', km: 175, kind: 'flat', time: '4:09:42', elevation: 1600, neutral: 3, threeSec: true,
    climbs: [{ name: 'Borovets-Pass', cat: '2', km: 103.2, len: 9.2, grad: 5.4, max: 11 }] },
  { n: 4, date: '2026-05-12', from: 'Catanzaro', to: 'Cosenza', km: 138, kind: 'flat', time: '3:08:46', elevation: 1800, neutral: 5, threeSec: true,
    climbs: [{ name: 'Cozzo Tunno', cat: '2', km: 95, len: 14.5, grad: 5.9, max: 11 }],
    sprints: [{ km: 126.4 }] },
  { n: 5, date: '2026-05-13', from: 'Praia a Mare', to: 'Potenza', km: 203, kind: 'hilly', time: '5:07:51', elevation: 4100, neutral: 3,
    climbs: [{ name: 'Prestieri', cat: '3', km: 27, len: 13, grad: 5, max: 9 },
      { name: 'Montagna Grande di Viggiano', cat: '2', km: 154, len: 6.6, grad: 9.1, max: 15 }],
    sprints: [{ km: 174.2 }] },
  { n: 6, date: '2026-05-14', from: 'Paestum', to: 'Neapel', km: 141, kind: 'flat', time: '3:19:30', elevation: 500, neutral: 5, threeSec: true,
    climbs: [{ name: "Cava de' Tirreni", cat: '4', km: 40.1, len: 7.1, grad: 2.7, max: 8 }] },
  { n: 7, date: '2026-05-15', from: 'Formia', to: 'Blockhaus', km: 244, kind: 'mountain', time: '6:09:15', elevation: 4600,
    info: { start: '10:55', finish: 'ca. 17:15' },
    climbs: [{ name: 'Roccaraso', cat: '2', km: 166.4, len: 6.9, grad: 6.5, max: 12 },
      { name: 'Blockhaus', cat: '1', km: 244, len: 13.6, grad: 8.4, max: 14, alt: 1665 }] },
  { n: 8, date: '2026-05-16', from: 'Chieti', to: 'Fermo', km: 156, kind: 'hilly', time: '3:27:26', elevation: 1900,
    climbs: [{ name: "Montefiore dell'Aso", cat: '3', km: 107, len: 10, grad: 3.6, max: 12 }, { name: 'Monterubbiano', cat: '4', km: 118.8, len: 4.7, grad: 5.8, max: 12 },
      { name: 'Capodarco', cat: '4', km: 150.1, len: 2.5, grad: 6.3, max: 18 }, { name: 'Fermo', cat: '4', km: 156, len: 3.5, grad: 6.2, max: 22 }] },
  { n: 9, date: '2026-05-17', from: 'Cervia', to: 'Corno alle Scale', km: 184, kind: 'mountain', time: '4:20:21', elevation: 2400,
    info: { start: '12:50', finish: '17:00–17:27' },
    climbs: [{ name: 'Querciola', cat: '3', km: 167.4, len: 11.5, grad: 4.3, max: 15 }, { name: 'Corno alle Scale', cat: '1', km: 184, len: 10.8, grad: 6.1, max: 15, alt: 1471 }] },
  { n: 10, date: '2026-05-19', from: 'Viareggio', to: 'Massa', km: 42, kind: 'itt', time: '0:45:53', reveal: '4:00:00', elevation: 50,
    climbs: [] },
  { n: 11, date: '2026-05-20', from: 'Porcari', to: 'Chiavari', km: 195, kind: 'hilly', time: '4:33:43', elevation: 2850, neutral: 3,
    climbs: [{ name: 'Passo del Termine', cat: '3', km: 115.9, len: 7.4, grad: 5, max: 10 }, { name: 'Colle di Guaitarola', cat: '2', km: 135.7, len: 9.9, grad: 6.2, max: 11 },
      { name: 'Colla dei Scioli', cat: '3', km: 167.1, len: 5.7, grad: 6.4, max: 15 }] },
  { n: 12, date: '2026-05-21', from: 'Imperia', to: 'Novi Ligure', km: 175, kind: 'flat', time: '3:53:00', elevation: 2250, neutral: 5, threeSec: true,
    climbs: [{ name: 'Colle Giovo', cat: '3', km: 107.5, len: 11.5, grad: 4.2, max: 10 }, { name: 'Bric Berton', cat: '3', km: 123, len: 5.5, grad: 6, max: 10 }] },
  { n: 13, date: '2026-05-22', from: 'Alessandria', to: 'Verbania', km: 189, kind: 'hilly', time: '3:51:33', elevation: 1400, neutral: 3,
    climbs: [{ name: 'Bieno', cat: '4', km: 167.7, len: 2.4, grad: 5.5, max: 9 }, { name: 'Ungiasca', cat: '3', km: 175.7, len: 4.7, grad: 7.1, max: 13 }] },
  { n: 14, date: '2026-05-23', from: 'Aosta', to: 'Pila', km: 133, kind: 'mountain', time: '3:53:01', elevation: 4350,
    info: { start: '13:05', finish: '16:58–17:34' },
    climbs: [{ name: 'Saint-Barthélemy', cat: '1', km: 18.1, len: 15.8, grad: 6.1, max: 13 },
      { name: 'Doues', cat: '3', km: 61.8, len: 5.8, grad: 6.2, max: 13 }, { name: 'Lin Noir', cat: '1', km: 82.3, len: 7.4, grad: 7.9, max: 12 },
      { name: 'Verrogne', cat: '2', km: 92.1, len: 5.6, grad: 6.9, max: 12 }, { name: 'Pila', cat: '1', km: 133, len: 16.5, grad: 7.1, max: 11, alt: 1793 }],
    sprints: [{ km: 116 }] },
  { n: 15, date: '2026-05-24', from: 'Voghera', to: 'Mailand', km: 157, kind: 'flat', time: '3:03:18', elevation: 200, neutral: 5, threeSec: true,
    climbs: [] },
  { n: 16, date: '2026-05-26', from: 'Bellinzona', to: 'Carì', km: 113, kind: 'mountain', time: '2:57:40', elevation: 3000,
    info: { start: '14:00', finish: '17:01–17:28' },
    climbs: [{ name: 'Torre', cat: '3', km: 32.2, len: 4.7, grad: 5.5, max: 10 }, { name: 'Leontica', cat: '2', km: 43.5, len: 3, grad: 8.5, max: 14 },
      { name: 'Torre', cat: '3', km: 54.2, len: 4.7, grad: 5.5, max: 10 }, { name: 'Leontica', cat: '2', km: 65.5, len: 3, grad: 8.5, max: 14 },
      { name: 'Carì', cat: '1', km: 113, len: 11.7, grad: 7.9, max: 13, alt: 1650 }] },
  { n: 17, date: '2026-05-27', from: "Cassano d'Adda", to: 'Andalo', km: 202, kind: 'hilly', time: '4:41:33', elevation: 3300,
    climbs: [{ name: 'Passo dei Tre Termini', cat: '3', km: 63.9, len: 8.2, grad: 5.9, max: 10 }, { name: 'Cocca di Lodrino', cat: '3', km: 88.1, len: 8.2, grad: 4, max: 10 },
      { name: 'Andalo', cat: '3', km: 191.3, len: 8.3, grad: 3.9, max: 9 }] },
  { n: 18, date: '2026-05-28', from: 'Fai della Paganella', to: 'Pieve di Soligo', km: 171, kind: 'flat', time: '3:46:50', elevation: 2050, neutral: 3,
    climbs: [{ name: 'Fastro', cat: '3', km: 84.7, len: 3.2, grad: 4.1, max: 9 }, { name: "Muro di Ca' del Poggio", cat: '4', km: 158.7, len: 1.1, grad: 12.3, max: 19 }] },
  { n: 19, date: '2026-05-29', from: 'Feltre', to: 'Alleghe (Piani di Pezzè)', km: 151, kind: 'mountain', time: '4:28:33', elevation: 5000,
    info: { start: '12:45', finish: '16:54–17:32' },
    climbs: [{ name: 'Passo Duran', cat: '1', km: 58.7, len: 12.1, grad: 8.2, max: 14 }, { name: 'Coi', cat: '2', km: 72.9, len: 5.8, grad: 9.7, max: 19 },
      { name: 'Forcella Staulanza', cat: '2', km: 82, len: 6.3, grad: 6.7, max: 10 }, { name: 'Passo Giau', cat: 'CC', km: 101.6, len: 9.9, grad: 9.3, max: 14, alt: 2233 },
      { name: 'Passo Falzarego', cat: '2', km: 122.2, len: 10.1, grad: 5.6, max: 10 }, { name: 'Piani di Pezzè', cat: '2', km: 151, len: 5, grad: 9.6, max: 15 }] },
  { n: 20, date: '2026-05-30', from: 'Gemona del Friuli', to: 'Piancavallo', km: 200, kind: 'mountain', time: '5:03:55', elevation: 3750,
    info: { start: '11:00', finish: '15:55–16:18' },
    climbs: [{ name: 'Clauzetto', cat: '3', km: 85.8, len: 6.9, grad: 5.7, max: 9 },
      { name: 'Piancavallo', cat: '1', km: 147.3, len: 14.5, grad: 7.8, max: 14 }, { name: 'Piancavallo', cat: '1', km: 200, len: 14.5, grad: 7.8, max: 14 }] },
  { n: 21, date: '2026-05-31', from: 'Rom', to: 'Rom', km: 131, kind: 'flat', time: '3:05:50', elevation: 500, neutral: 5, threeSec: true,
    climbs: [] },
];

// Top 10 je Etappe
export const RESULTS = {
  1: ['Paul Magnier', 'Tobias Lund Andresen', 'Ethan Vernon', 'Jonathan Milan', 'Madis Mihkels', 'Giovanni Lonardi', 'Pascal Ackermann', 'Tord Gudmestad', 'Max Walscheid', 'Dries Van Gestel'],
  2: ['Guillermo Thomas Silva', 'Florian Stork', 'Giulio Ciccone', 'Christian Scaroni', 'Giulio Pellizzari', 'Matteo Sobrero', 'Andreas Leknessund', 'Jan Christen', 'Martin Tjøtta', 'Mathys Rondel'],
  3: ['Paul Magnier', 'Jonathan Milan', 'Dylan Groenewegen', 'Madis Mihkels', 'Matteo Malucelli', 'Erlend Blikra', 'Pascal Ackermann', 'Davide Ballerini', 'Tobias Lund Andresen', 'Enrico Zanoncello'],
  4: ['Jhonatan Narváez', 'Orluis Aular', 'Giulio Ciccone', 'Ben Turner', 'Alessandro Pinarello', 'Afonso Eulálio', 'Lennert Van Eetvelt', 'Diego Ulissi', 'Andrea Raccagni Noviero', 'Michael Valgren'],
  5: ['Igor Arrieta', 'Afonso Eulálio', 'Guillermo Thomas Silva', 'Lorenzo Milesi', 'Christian Scaroni', 'Gianmarco Garofoli', 'Koen Bouwman', 'Johannes Kulset', 'Andrea Raccagni Noviero', 'Ludovico Crescioli'],
  6: ['Davide Ballerini', 'Jasper Stuyven', 'Paul Magnier', 'Jensen Plowright', 'Ben Turner', 'Alec Segaert', 'Luca Mozzato', 'Filippo Magli', 'Enrico Zanoncello', 'Casper van Uden'],
  7: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Giulio Pellizzari', "Ben O'Connor", 'Mathys Rondel', 'Giulio Ciccone', 'Derek Gee-West', 'Michael Storer', 'Thymen Arensman'],
  8: ['Jhonatan Narváez', 'Andreas Leknessund', 'Martin Tjøtta', 'Guillermo Thomas Silva', 'Lorenzo Milesi', 'Christian Scaroni', 'Corbin Strong', 'Juan Pedro López', 'Wout Poels', 'Markel Beloki'],
  9: ['Jonas Vingegaard', 'Felix Gall', 'Davide Piganzoli', 'Thymen Arensman', 'Afonso Eulálio', 'Derek Gee-West', 'Mathys Rondel', 'Sepp Kuss', 'Jai Hindley', 'Michael Storer'],
  10: ['Filippo Ganna', 'Thymen Arensman', 'Rémi Cavagna', 'Sjoerd Bax', 'Derek Gee-West', 'Max Walscheid', 'Johan Price-Pejtersen', 'Mikkel Bjerg', 'Lorenzo Milesi', 'Niklas Larsen'],
  11: ['Jhonatan Narváez', 'Enric Mas', 'Diego Ulissi', 'Chris Harper', 'Aleksandr Vlasov', 'Christian Scaroni', 'Ludovico Crescioli', 'Simone Gualdi', 'Warren Barguil', 'Andrea Raccagni Noviero'],
  12: ['Alec Segaert', 'Toon Aerts', 'Guillermo Thomas Silva', 'Ethan Vernon', 'Jasper Stuyven', 'Orluis Aular', 'Madis Mihkels', 'Jhonatan Narváez', 'Edoardo Zambanini', 'Sakarias Koller Løland'],
  13: ['Alberto Bettiol', 'Andreas Leknessund', 'Jasper Stuyven', 'Michael Valgren', 'Mark Donovan', 'Josh Kench', 'Mikkel Bjerg', 'Francesco Busatto', 'Markus Hoelgaard', 'Diego Pablo Sevilla'],
  14: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Davide Piganzoli', 'Giulio Pellizzari', 'Thymen Arensman', 'Michael Storer', 'Wout Poels', 'Jan Hirt', 'Egan Bernal'],
  15: ['Fredrik Dversnes', 'Mirco Maestri', 'Martin Marcellusi', 'Mattia Bais', 'Paul Magnier', 'Dylan Groenewegen', 'Tobias Lund Andresen', 'Ethan Vernon', 'Paul Penhoët', 'Luca Mozzato'],
  16: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Thymen Arensman', 'Derek Gee-West', 'Davide Piganzoli', 'Egan Bernal', 'Michael Storer', 'Mathys Rondel', 'Wout Poels'],
  17: ['Michael Valgren', 'Andreas Leknessund', 'Damiano Caruso', 'Aleksandr Vlasov', 'Einer Rubio', 'Igor Arrieta', 'Gianmarco Garofoli', 'David de la Cruz', 'Jhonatan Narváez', 'Mark Donovan'],
  18: ['Paul Magnier', 'Edoardo Zambanini', 'Jonathan Milan', 'Francesco Busatto', 'Corbin Strong', 'Guillermo Thomas Silva', 'Madis Mihkels', 'Filippo Magli', 'Sakarias Koller Løland', 'Lukáš Kubiš'],
  19: ['Sepp Kuss', 'Derek Gee-West', 'Giulio Ciccone', 'Felix Gall', 'Jonas Vingegaard', 'Jai Hindley', 'Damiano Caruso', 'Davide Piganzoli', 'Einer Rubio', 'Michael Storer'],
  20: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Derek Gee-West', 'Thymen Arensman', 'Egan Bernal', 'Afonso Eulálio', 'Damiano Caruso', 'Michael Storer', 'Davide Piganzoli'],
  21: ['Jonathan Milan', 'Giovanni Lonardi', 'Paul Penhoët', 'Dylan Groenewegen', 'Madis Mihkels', 'Jensen Plowright', 'Tobias Lund Andresen', 'Corbin Strong', 'Toon Aerts', 'Luca Mozzato'],
};

// Gesamtwertung (Top 10) nach jeder Etappe
export const GC = {
  1: ['Paul Magnier', 'Tobias Lund Andresen', 'Manuele Tarozzi', 'Ethan Vernon', 'Diego Pablo Sevilla', 'António Morgado', 'Jonathan Milan', 'Madis Mihkels', 'Giovanni Lonardi', 'Pascal Ackermann'],
  2: ['Guillermo Thomas Silva', 'Florian Stork', 'Egan Bernal', 'Thymen Arensman', 'Giulio Ciccone', 'Jan Christen', 'Johannes Kulset', 'Martin Tjøtta', 'Lennert Van Eetvelt', 'Darren Rafferty'],
  3: ['Guillermo Thomas Silva', 'Florian Stork', 'Egan Bernal', 'Thymen Arensman', 'Giulio Ciccone', 'Jan Christen', 'Martin Tjøtta', 'Johannes Kulset', 'Enric Mas', 'Lennert Van Eetvelt'],
  4: ['Giulio Ciccone', 'Jan Christen', 'Florian Stork', 'Egan Bernal', 'Thymen Arensman', 'Giulio Pellizzari', 'Lennert Van Eetvelt', 'Enric Mas', 'Markel Beloki', 'Jan Hirt'],
  5: ['Afonso Eulálio', 'Igor Arrieta', 'Christian Scaroni', 'Andrea Raccagni Noviero', 'Johannes Kulset', 'Giulio Ciccone', 'Jan Christen', 'Florian Stork', 'Egan Bernal', 'Thymen Arensman'],
  6: ['Afonso Eulálio', 'Igor Arrieta', 'Christian Scaroni', 'Andrea Raccagni Noviero', 'Johannes Kulset', 'Giulio Ciccone', 'Jan Christen', 'Florian Stork', 'Egan Bernal', 'Thymen Arensman'],
  7: ['Afonso Eulálio', 'Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Giulio Pellizzari', "Ben O'Connor", 'Mathys Rondel', 'Giulio Ciccone', 'Thymen Arensman', 'Michael Storer'],
  8: ['Afonso Eulálio', 'Jonas Vingegaard', 'Felix Gall', 'Christian Scaroni', 'Jai Hindley', 'Giulio Pellizzari', "Ben O'Connor", 'Mathys Rondel', 'Thymen Arensman', 'Michael Storer'],
  9: ['Afonso Eulálio', 'Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Christian Scaroni', 'Thymen Arensman', 'Mathys Rondel', "Ben O'Connor", 'Giulio Pellizzari', 'Michael Storer'],
  10: ['Afonso Eulálio', 'Jonas Vingegaard', 'Thymen Arensman', 'Felix Gall', "Ben O'Connor", 'Jai Hindley', 'Michael Storer', 'Derek Gee-West', 'Giulio Pellizzari', 'Markel Beloki'],
  11: ['Afonso Eulálio', 'Jonas Vingegaard', 'Thymen Arensman', 'Felix Gall', "Ben O'Connor", 'Jai Hindley', 'Michael Storer', 'Derek Gee-West', 'Giulio Pellizzari', 'Chris Harper'],
  12: ['Afonso Eulálio', 'Jonas Vingegaard', 'Thymen Arensman', 'Felix Gall', "Ben O'Connor", 'Jai Hindley', 'Michael Storer', 'Derek Gee-West', 'Giulio Pellizzari', 'Chris Harper'],
  13: ['Afonso Eulálio', 'Jonas Vingegaard', 'Thymen Arensman', 'Felix Gall', "Ben O'Connor", 'Jai Hindley', 'Michael Storer', 'Derek Gee-West', 'Giulio Pellizzari', 'Chris Harper'],
  14: ['Jonas Vingegaard', 'Afonso Eulálio', 'Felix Gall', 'Thymen Arensman', 'Jai Hindley', 'Giulio Pellizzari', 'Michael Storer', "Ben O'Connor", 'Derek Gee-West', 'Davide Piganzoli'],
  15: ['Jonas Vingegaard', 'Afonso Eulálio', 'Felix Gall', 'Thymen Arensman', 'Jai Hindley', 'Giulio Pellizzari', 'Michael Storer', "Ben O'Connor", 'Derek Gee-West', 'Davide Piganzoli'],
  16: ['Jonas Vingegaard', 'Felix Gall', 'Thymen Arensman', 'Jai Hindley', 'Afonso Eulálio', 'Derek Gee-West', 'Michael Storer', 'Davide Piganzoli', "Ben O'Connor", 'Egan Bernal'],
  17: ['Jonas Vingegaard', 'Felix Gall', 'Thymen Arensman', 'Jai Hindley', 'Afonso Eulálio', 'Derek Gee-West', 'Michael Storer', 'Davide Piganzoli', 'Damiano Caruso', "Ben O'Connor"],
  18: ['Jonas Vingegaard', 'Felix Gall', 'Thymen Arensman', 'Jai Hindley', 'Afonso Eulálio', 'Derek Gee-West', 'Michael Storer', 'Davide Piganzoli', 'Damiano Caruso', "Ben O'Connor"],
  19: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Thymen Arensman', 'Derek Gee-West', 'Afonso Eulálio', 'Michael Storer', 'Davide Piganzoli', 'Damiano Caruso', 'Egan Bernal'],
  20: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Thymen Arensman', 'Derek Gee-West', 'Afonso Eulálio', 'Michael Storer', 'Davide Piganzoli', 'Damiano Caruso', 'Egan Bernal'],
  21: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley', 'Thymen Arensman', 'Derek Gee-West', 'Afonso Eulálio', 'Michael Storer', 'Davide Piganzoli', 'Damiano Caruso', 'Egan Bernal'],
};

// Endwertungen (Top 3) – Kategorien wie in der App
export const FINAL = {
  gc: ['Jonas Vingegaard', 'Felix Gall', 'Jai Hindley'],
  rest: ['Felix Gall', 'Jai Hindley', 'Thymen Arensman'],
  points: ['Paul Magnier', 'Jonathan Milan', 'Guillermo Thomas Silva'],
  mountains: ['Giulio Ciccone', 'Jonas Vingegaard', 'Einer Rubio'],
  youth: ['Afonso Eulálio', 'Davide Piganzoli', 'Mathys Rondel'],
  combative: ['Damiano Caruso'],
  team: ['Visma–Lease a Bike', 'Netcompany INEOS', 'Red Bull–Bora–Hansgrohe'],
};

// Favoriten, die bei „Best of the Rest“ ausgeklammert werden
export const EXCLUDED_FROM_REST = ['Jonas Vingegaard'];

export const COUNTRY = {
  AU: 'Australien', AT: 'Österreich', IT: 'Italien', BE: 'Belgien', DK: 'Dänemark', CO: 'Kolumbien', HR: 'Kroatien',
  PT: 'Portugal', NL: 'Niederlande', CL: 'Chile', UZ: 'Usbekistan', NO: 'Norwegen', EC: 'Ecuador', ES: 'Spanien',
  EE: 'Estland', IE: 'Irland', GB: 'Großbritannien', FR: 'Frankreich', CH: 'Schweiz', NZ: 'Neuseeland', CA: 'Kanada',
  ER: 'Eritrea', DE: 'Deutschland', VE: 'Venezuela', US: 'USA', CZ: 'Tschechien', ZA: 'Südafrika', MT: 'Malta',
  SK: 'Slowakei', UY: 'Uruguay',
};

// Reglement Giro d'Italia 2026 (tuttobiciweb.it)
export const REGULATIONS = {
  kom: { CC: [50, 30, 20, 14, 10, 6, 4, 2, 1], '1': [40, 18, 12, 9, 6, 4, 2, 1], '2': [18, 8, 6, 4, 2, 1], '3': [9, 4, 2, 1], '4': [3, 2, 1] },
  sprint_points: [12, 8, 5, 3, 1],
  finish_bonus: [10, 6, 4],
  redbull_bonus: [6, 4, 2],
  redbull_points: [15, 8, 5, 3, 1],
  stage_points: {
    'A/B (flach)': [50, 35, 25, 18, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1],
    'C (mittel)': [25, 18, 12, 8, 6, 5, 4, 3, 2, 1],
    'D/E (Berg, Zeitfahren)': [15, 12, 9, 7, 6, 5, 4, 3, 2, 1],
  },
};
