-- =====================================================================
-- Testrunde „Giro d'Italia 2026“ – echte Fahrer, Etappen und Ergebnisse
-- Erzeugt von scripts/giro2026/build-sql.mjs – nicht von Hand bearbeiten.
--
-- Voraussetzung: supabase/schema.sql ist in der aktuellen Version eingespielt.
-- Danach diese Datei komplett im SQL Editor ausführen.
--
-- • 184 Fahrer in 23 Teams mit Startnummer, Nation, Alter, Nachwuchs-Status
-- • 21 Etappen, ab morgen eine pro Tag, Start jeweils 12:00 Uhr
--   (mit echten Anstiegen, Kategorien, Zwischensprints, Höhenmetern)
-- • Das echte Ergebnis (Top 10) erscheint etwa zur echten Zielankunft:
--   Start + Siegerzeit + 15 Minuten (Zeitfahren: nach 4 Stunden)
-- • Ausstiege passieren wie im echten Rennen
-- • Bonuswertungen: Zwischenstand nach jeder Etappe (Gesamt, Best of the Rest,
--   Nachwuchs), nach Etappe 21 der echte Endstand aller Wertungen
--
-- Die alte Testrunde (Köln–Dortmund) wird dabei gelöscht.
-- Automatik beenden:  select cron.unschedule('giro2026-replay');
-- Sofort prüfen:      select public.replay_giro2026();
-- =====================================================================

begin;

-- Passt das Schema? (sonst zuerst supabase/schema.sql neu ausführen)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stages' and column_name = 'climbs')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'riders' and column_name = 'nationality')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tours' and column_name = 'tip_limit') then
    raise exception 'Bitte zuerst supabase/schema.sql (aktuelle Version) im SQL Editor ausführen.';
  end if;
end $$;

-- Alte Testrunde entfernen
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('testrunde-ergebnisse', 'giro2026-replay');
  end if;
end $$;
delete from public.tours where id in ('testrunde', 'giro-2026');

-- Rundfahrt: ab morgen, 21 Tage
insert into public.tours (id, name, short_name, theme, year, start_date, end_date, is_visible, pcs_slug, tip_limit)
values ('giro-2026', 'Giro d''Italia 2026 · Testrunde', 'Giro 26', 'giro',
        extract(year from now())::int,
        (now() at time zone 'Europe/Berlin')::date + 1,
        (now() at time zone 'Europe/Berlin')::date + 21,
        true, 'giro-d-italia/2026', 3);

-- Etappen
insert into public.stages (tour_id, number, starts_at, kind, departure, arrival, distance_km, elevation_m, climbs, sprints) values
  ('giro-2026', 1, ((((now() at time zone 'Europe/Berlin')::date + 1)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Nessebar', 'Burgas', 147, null, '[{"name":"Kap Agalina","cat":"4","km":84.3},{"name":"Kap Agalina","cat":"4","km":106.4}]'::jsonb, '[{"km":114.7}]'::jsonb),
  ('giro-2026', 2, ((((now() at time zone 'Europe/Berlin')::date + 2)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Burgas', 'Veliko Tarnovo', 221, null, '[{"name":"Byala-Pass","cat":"3","km":116.3},{"name":"Vratnik-Pass","cat":"3","km":134.1},{"name":"Lyaskovets-Kloster","cat":"3","km":210.6,"len":3.5,"grad":7.5}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 3, ((((now() at time zone 'Europe/Berlin')::date + 3)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Plovdiv', 'Sofia', 175, null, '[{"name":"Borovets-Pass","cat":"2","km":103.2,"len":9.2,"grad":5.4}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 4, ((((now() at time zone 'Europe/Berlin')::date + 4)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Catanzaro', 'Cosenza', 138, null, '[{"name":"Cozzo Tunno","cat":"2","km":95,"len":14.4,"grad":5.9}]'::jsonb, '[{"km":126.4}]'::jsonb),
  ('giro-2026', 5, ((((now() at time zone 'Europe/Berlin')::date + 5)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Praia a Mare', 'Potenza', 203, null, '[{"name":"Prestieri","cat":"3","km":27,"len":13.6,"grad":4.8},{"name":"Montagna Grande di Viggiano","cat":"2","km":154,"len":6.6,"grad":9.1}]'::jsonb, '[{"km":174.2}]'::jsonb),
  ('giro-2026', 6, ((((now() at time zone 'Europe/Berlin')::date + 6)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Paestum', 'Neapel', 142, null, '[{"name":"Cava de'' Tirreni","cat":"4","km":40.1}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 7, ((((now() at time zone 'Europe/Berlin')::date + 7)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Formia', 'Blockhaus', 244, 4600, '[{"name":"Roccaraso","cat":"2","km":166.4,"len":6.9,"grad":6.5},{"name":"Blockhaus","cat":"1","km":244,"len":13.6,"grad":8.4}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 8, ((((now() at time zone 'Europe/Berlin')::date + 8)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Chieti', 'Fermo', 156, null, '[{"name":"Montefiore dell''Aso","cat":"3","km":107},{"name":"Monterubbiano","cat":"4","km":118.8},{"name":"Capodarco","cat":"4","km":150.1},{"name":"Fermo","cat":"4","km":156,"len":3.4,"grad":6.1}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 9, ((((now() at time zone 'Europe/Berlin')::date + 9)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Cervia', 'Corno alle Scale', 184, null, '[{"name":"Querciola","cat":"3","km":167.4},{"name":"Corno alle Scale","cat":"1","km":184,"len":10.8,"grad":6.1}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 10, ((((now() at time zone 'Europe/Berlin')::date + 10)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'itt', 'Viareggio', 'Massa', 42, null, '[]'::jsonb, '[]'::jsonb),
  ('giro-2026', 11, ((((now() at time zone 'Europe/Berlin')::date + 11)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Porcari', 'Chiavari', 195, null, '[{"name":"Passo del Termine","cat":"3","km":115.9},{"name":"Colle di Guaitarola","cat":"2","km":135.7},{"name":"Colla dei Scioli","cat":"3","km":167.1}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 12, ((((now() at time zone 'Europe/Berlin')::date + 12)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Imperia', 'Novi Ligure', 175, null, '[{"name":"Colle Giovo","cat":"3","km":107.5},{"name":"Bric Berton","cat":"3","km":123}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 13, ((((now() at time zone 'Europe/Berlin')::date + 13)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Alessandria', 'Verbania', 189, null, '[{"name":"Bieno","cat":"4","km":167.7},{"name":"Ungiasca","cat":"3","km":175.7}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 14, ((((now() at time zone 'Europe/Berlin')::date + 14)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Aosta', 'Pila', 133, null, '[{"name":"Saint-Barthélemy","cat":"1","km":18.1,"len":15.8,"grad":6.1},{"name":"Doues","cat":"3","km":61.8,"len":5.8,"grad":6.2},{"name":"Lin Noir","cat":"1","km":82.3,"len":7.4,"grad":7.9},{"name":"Verrogne","cat":"2","km":92.1,"len":5.6,"grad":6.9},{"name":"Pila","cat":"1","km":133,"len":16.5,"grad":7.1}]'::jsonb, '[{"km":116}]'::jsonb),
  ('giro-2026', 15, ((((now() at time zone 'Europe/Berlin')::date + 15)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Voghera', 'Mailand', 157, null, '[]'::jsonb, '[]'::jsonb),
  ('giro-2026', 16, ((((now() at time zone 'Europe/Berlin')::date + 16)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Bellinzona', 'Carì', 113, null, '[{"name":"Torre","cat":"3","km":32.2},{"name":"Leontica","cat":"2","km":43.5},{"name":"Torre","cat":"3","km":54.2},{"name":"Leontica","cat":"2","km":65.5},{"name":"Carì","cat":"1","km":113,"len":11.8,"grad":8}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 17, ((((now() at time zone 'Europe/Berlin')::date + 17)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Cassano d''Adda', 'Andalo', 202, 3300, '[{"name":"Passo dei Tre Termini","cat":"3","km":63.9},{"name":"Cocca di Lodrino","cat":"3","km":88.1},{"name":"Andalo","cat":"3","km":191.3}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 18, ((((now() at time zone 'Europe/Berlin')::date + 18)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Fai della Paganella', 'Pieve di Soligo', 171, null, '[{"name":"Fastro","cat":"3","km":84.7},{"name":"Muro di Ca'' del Poggio","cat":"4","km":158.7}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 19, ((((now() at time zone 'Europe/Berlin')::date + 19)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Feltre', 'Alleghe (Piani di Pezzè)', 151, 5000, '[{"name":"Passo Duran","cat":"1","km":58.7},{"name":"Coi","cat":"2","km":72.9},{"name":"Forcella Staulanza","cat":"2","km":82},{"name":"Passo Giau","cat":"CC","km":101.6},{"name":"Passo Falzarego","cat":"2","km":122.2},{"name":"Piani di Pezzè","cat":"2","km":151,"len":4.9,"grad":9.8}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 20, ((((now() at time zone 'Europe/Berlin')::date + 20)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Gemona del Friuli', 'Piancavallo', 200, 3750, '[{"name":"Clauzetto","cat":"3","km":85.8,"len":6.7,"grad":5.6},{"name":"Piancavallo","cat":"1","km":147.3,"len":14.4,"grad":7.8},{"name":"Piancavallo","cat":"1","km":200,"len":14.4,"grad":7.8}]'::jsonb, '[]'::jsonb),
  ('giro-2026', 21, ((((now() at time zone 'Europe/Berlin')::date + 21)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Rom', 'Rom', 131, null, '[]'::jsonb, '[]'::jsonb);

-- Startliste (184 Fahrer)
insert into public.riders (tour_id, bib, name, team, nationality, age, young, excluded_from_rest) values
  ('giro-2026', 1, 'Kaden Groves', 'Alpecin–Premier Tech', 'AU', 27, false, false),
  ('giro-2026', 2, 'Tobias Bayer', 'Alpecin–Premier Tech', 'AT', 26, false, false),
  ('giro-2026', 3, 'Francesco Busatto', 'Alpecin–Premier Tech', 'IT', 23, true, false),
  ('giro-2026', 4, 'Jonas Geens', 'Alpecin–Premier Tech', 'BE', 27, false, false),
  ('giro-2026', 5, 'Edward Planckaert', 'Alpecin–Premier Tech', 'BE', 31, false, false),
  ('giro-2026', 6, 'Jensen Plowright', 'Alpecin–Premier Tech', 'AU', 25, false, false),
  ('giro-2026', 7, 'Johan Price-Pejtersen', 'Alpecin–Premier Tech', 'DK', 26, false, false),
  ('giro-2026', 8, 'Luca Vergallito', 'Alpecin–Premier Tech', 'IT', 28, false, false),
  ('giro-2026', 11, 'Santiago Buitrago', 'Team Bahrain Victorious', 'CO', 26, false, false),
  ('giro-2026', 12, 'Damiano Caruso', 'Team Bahrain Victorious', 'IT', 38, false, false),
  ('giro-2026', 13, 'Robert Stannard', 'Team Bahrain Victorious', 'AU', 27, false, false),
  ('giro-2026', 14, 'Fran Miholjević', 'Team Bahrain Victorious', 'HR', 23, true, false),
  ('giro-2026', 15, 'Afonso Eulálio', 'Team Bahrain Victorious', 'PT', 24, true, false),
  ('giro-2026', 16, 'Mathijs Paasschens', 'Team Bahrain Victorious', 'NL', 30, false, false),
  ('giro-2026', 17, 'Alec Segaert', 'Team Bahrain Victorious', 'BE', 23, true, false),
  ('giro-2026', 18, 'Edoardo Zambanini', 'Team Bahrain Victorious', 'IT', 25, true, false),
  ('giro-2026', 21, 'Filippo Magli', 'Bardiani–CSF 7 Saber', 'IT', 27, false, false),
  ('giro-2026', 22, 'Martin Marcellusi', 'Bardiani–CSF 7 Saber', 'IT', 26, false, false),
  ('giro-2026', 23, 'Luca Paletti', 'Bardiani–CSF 7 Saber', 'IT', 21, true, false),
  ('giro-2026', 24, 'Vicente Rojas', 'Bardiani–CSF 7 Saber', 'CL', 24, true, false),
  ('giro-2026', 25, 'Manuele Tarozzi', 'Bardiani–CSF 7 Saber', 'IT', 27, false, false),
  ('giro-2026', 26, 'Nikita Tsvetkov', 'Bardiani–CSF 7 Saber', 'UZ', 21, true, false),
  ('giro-2026', 27, 'Filippo Turconi', 'Bardiani–CSF 7 Saber', 'IT', 20, true, false),
  ('giro-2026', 28, 'Enrico Zanoncello', 'Bardiani–CSF 7 Saber', 'IT', 28, false, false),
  ('giro-2026', 31, 'Felix Gall', 'Decathlon CMA CGM', 'AT', 28, false, false),
  ('giro-2026', 32, 'Tobias Lund Andresen', 'Decathlon CMA CGM', 'DK', 23, true, false),
  ('giro-2026', 33, 'Tord Gudmestad', 'Decathlon CMA CGM', 'NO', 25, true, false),
  ('giro-2026', 34, 'Gregor Mühlberger', 'Decathlon CMA CGM', 'AT', 32, false, false),
  ('giro-2026', 35, 'Oliver Naesen', 'Decathlon CMA CGM', 'BE', 35, false, false),
  ('giro-2026', 36, 'Rasmus Søjberg Pedersen', 'Decathlon CMA CGM', 'DK', 23, true, false),
  ('giro-2026', 37, 'Callum Scotson', 'Decathlon CMA CGM', 'AU', 29, false, false),
  ('giro-2026', 38, 'Johannes Staune-Mittet', 'Decathlon CMA CGM', 'NO', 24, true, false),
  ('giro-2026', 41, 'Jefferson Alexander Cepeda', 'EF Education–EasyPost', 'EC', 27, false, false),
  ('giro-2026', 42, 'Samuele Battistella', 'EF Education–EasyPost', 'IT', 27, false, false),
  ('giro-2026', 43, 'Markel Beloki', 'EF Education–EasyPost', 'ES', 20, true, false),
  ('giro-2026', 44, 'Madis Mihkels', 'EF Education–EasyPost', 'EE', 22, true, false),
  ('giro-2026', 45, 'Darren Rafferty', 'EF Education–EasyPost', 'IE', 22, true, false),
  ('giro-2026', 46, 'James Shaw', 'EF Education–EasyPost', 'GB', 29, false, false),
  ('giro-2026', 47, 'Michael Valgren', 'EF Education–EasyPost', 'DK', 34, false, false),
  ('giro-2026', 48, 'Jardi Christiaan van der Lee', 'EF Education–EasyPost', 'NL', 24, true, false),
  ('giro-2026', 51, 'Rémi Cavagna', 'Groupama–FDJ United', 'FR', 30, false, false),
  ('giro-2026', 52, 'Cyril Barthe', 'Groupama–FDJ United', 'FR', 30, false, false),
  ('giro-2026', 53, 'Axel Huens', 'Groupama–FDJ United', 'FR', 24, true, false),
  ('giro-2026', 54, 'Johan Jacobs', 'Groupama–FDJ United', 'CH', 29, false, false),
  ('giro-2026', 55, 'Josh Kench', 'Groupama–FDJ United', 'NZ', 25, true, false),
  ('giro-2026', 56, 'Paul Penhoët', 'Groupama–FDJ United', 'FR', 24, true, false),
  ('giro-2026', 57, 'Rémy Rochas', 'Groupama–FDJ United', 'FR', 29, false, false),
  ('giro-2026', 58, 'Brieuc Rolland', 'Groupama–FDJ United', 'FR', 22, true, false),
  ('giro-2026', 61, 'Giulio Ciccone', 'Lidl–Trek', 'IT', 31, false, false),
  ('giro-2026', 62, 'Simone Consonni', 'Lidl–Trek', 'IT', 31, false, false),
  ('giro-2026', 63, 'Derek Gee-West', 'Lidl–Trek', 'CA', 28, false, false),
  ('giro-2026', 64, 'Amanuel Ghebreigzabhier', 'Lidl–Trek', 'ER', 31, false, false),
  ('giro-2026', 65, 'Jonathan Milan', 'Lidl–Trek', 'IT', 25, false, false),
  ('giro-2026', 66, 'Matteo Sobrero', 'Lidl–Trek', 'IT', 28, false, false),
  ('giro-2026', 67, 'Tim Torn Teutenberg', 'Lidl–Trek', 'DE', 23, true, false),
  ('giro-2026', 68, 'Max Walscheid', 'Lidl–Trek', 'DE', 32, false, false),
  ('giro-2026', 71, 'Arnaud De Lie', 'Lotto–Intermarché', 'BE', 24, true, false),
  ('giro-2026', 72, 'Toon Aerts', 'Lotto–Intermarché', 'BE', 32, false, false),
  ('giro-2026', 73, 'Joshua Giddings', 'Lotto–Intermarché', 'GB', 22, true, false),
  ('giro-2026', 74, 'Simone Gualdi', 'Lotto–Intermarché', 'IT', 21, true, false),
  ('giro-2026', 75, 'Milan Menten', 'Lotto–Intermarché', 'BE', 29, false, false),
  ('giro-2026', 76, 'Lorenzo Rota', 'Lotto–Intermarché', 'IT', 30, false, false),
  ('giro-2026', 77, 'Jonas Rutsch', 'Lotto–Intermarché', 'DE', 28, false, false),
  ('giro-2026', 78, 'Lennert Van Eetvelt', 'Lotto–Intermarché', 'BE', 24, true, false),
  ('giro-2026', 81, 'Enric Mas', 'Movistar Team', 'ES', 31, false, false),
  ('giro-2026', 82, 'Orluis Aular', 'Movistar Team', 'VE', 29, false, false),
  ('giro-2026', 83, 'Iván García Cortina', 'Movistar Team', 'ES', 30, false, false),
  ('giro-2026', 84, 'Juan Pedro López', 'Movistar Team', 'ES', 28, false, false),
  ('giro-2026', 85, 'Lorenzo Milesi', 'Movistar Team', 'IT', 24, true, false),
  ('giro-2026', 86, 'Nelson Oliveira', 'Movistar Team', 'PT', 37, false, false),
  ('giro-2026', 87, 'Javier Romo', 'Movistar Team', 'ES', 27, false, false),
  ('giro-2026', 88, 'Einer Rubio', 'Movistar Team', 'CO', 28, false, false),
  ('giro-2026', 91, 'Egan Bernal', 'Netcompany INEOS', 'CO', 29, false, false),
  ('giro-2026', 92, 'Thymen Arensman', 'Netcompany INEOS', 'NL', 26, false, false),
  ('giro-2026', 93, 'Filippo Ganna', 'Netcompany INEOS', 'IT', 29, false, false),
  ('giro-2026', 94, 'Jack Haig', 'Netcompany INEOS', 'AU', 32, false, false),
  ('giro-2026', 95, 'Magnus Sheffield', 'Netcompany INEOS', 'US', 24, true, false),
  ('giro-2026', 96, 'Embret Svestad-Bårdseng', 'Netcompany INEOS', 'NO', 23, true, false),
  ('giro-2026', 97, 'Connor Swift', 'Netcompany INEOS', 'GB', 30, false, false),
  ('giro-2026', 98, 'Ben Turner', 'Netcompany INEOS', 'GB', 26, false, false),
  ('giro-2026', 101, 'Alessandro Pinarello', 'NSN Cycling Team', 'IT', 22, true, false),
  ('giro-2026', 102, 'Jan Hirt', 'NSN Cycling Team', 'CZ', 35, false, false),
  ('giro-2026', 103, 'Ryan Mullen', 'NSN Cycling Team', 'IE', 31, false, false),
  ('giro-2026', 104, 'Nick Schultz', 'NSN Cycling Team', 'AU', 31, false, false),
  ('giro-2026', 105, 'Dion Smith', 'NSN Cycling Team', 'NZ', 33, false, false),
  ('giro-2026', 106, 'Jake Stewart', 'NSN Cycling Team', 'GB', 26, false, false),
  ('giro-2026', 107, 'Corbin Strong', 'NSN Cycling Team', 'NZ', 26, false, false),
  ('giro-2026', 109, 'Ethan Vernon', 'NSN Cycling Team', 'GB', 25, false, false),
  ('giro-2026', 111, 'Sjoerd Bax', 'Pinarello–Q36.5 Pro Cycling Team', 'NL', 30, false, false),
  ('giro-2026', 112, 'Fabio Christen', 'Pinarello–Q36.5 Pro Cycling Team', 'CH', 23, true, false),
  ('giro-2026', 113, 'David de la Cruz', 'Pinarello–Q36.5 Pro Cycling Team', 'ES', 37, false, false),
  ('giro-2026', 114, 'Mark Donovan', 'Pinarello–Q36.5 Pro Cycling Team', 'GB', 27, false, false),
  ('giro-2026', 115, 'David González', 'Pinarello–Q36.5 Pro Cycling Team', 'ES', 30, false, false),
  ('giro-2026', 116, 'Chris Harper', 'Pinarello–Q36.5 Pro Cycling Team', 'AU', 31, false, false),
  ('giro-2026', 117, 'Matteo Moschetti', 'Pinarello–Q36.5 Pro Cycling Team', 'IT', 29, false, false),
  ('giro-2026', 118, 'Nickolas Zukowsky', 'Pinarello–Q36.5 Pro Cycling Team', 'CA', 27, false, false),
  ('giro-2026', 121, 'Jai Hindley', 'Red Bull–Bora–Hansgrohe', 'AU', 30, false, false),
  ('giro-2026', 122, 'Giovanni Aleotti', 'Red Bull–Bora–Hansgrohe', 'IT', 26, false, false),
  ('giro-2026', 123, 'Nico Denz', 'Red Bull–Bora–Hansgrohe', 'DE', 32, false, false),
  ('giro-2026', 124, 'Gianni Moscon', 'Red Bull–Bora–Hansgrohe', 'IT', 32, false, false),
  ('giro-2026', 125, 'Giulio Pellizzari', 'Red Bull–Bora–Hansgrohe', 'IT', 22, true, false),
  ('giro-2026', 126, 'Mick van Dijke', 'Red Bull–Bora–Hansgrohe', 'NL', 26, false, false),
  ('giro-2026', 127, 'Aleksandr Vlasov', 'Red Bull–Bora–Hansgrohe', null, 30, false, false),
  ('giro-2026', 128, 'Ben Zwiehoff', 'Red Bull–Bora–Hansgrohe', 'DE', 32, false, false),
  ('giro-2026', 131, 'Paul Magnier', 'Soudal–Quick-Step', 'FR', 22, true, false),
  ('giro-2026', 132, 'Ayco Bastiaens', 'Soudal–Quick-Step', 'BE', 29, false, false),
  ('giro-2026', 133, 'Gianmarco Garofoli', 'Soudal–Quick-Step', 'IT', 23, true, false),
  ('giro-2026', 134, 'Andrea Raccagni Noviero', 'Soudal–Quick-Step', 'IT', 22, true, false),
  ('giro-2026', 135, 'Jasper Stuyven', 'Soudal–Quick-Step', 'BE', 34, false, false),
  ('giro-2026', 136, 'Fabio Van den Bossche', 'Soudal–Quick-Step', 'BE', 25, false, false),
  ('giro-2026', 137, 'Dries Van Gestel', 'Soudal–Quick-Step', 'BE', 31, false, false),
  ('giro-2026', 138, 'Filippo Zana', 'Soudal–Quick-Step', 'IT', 27, false, false),
  ('giro-2026', 141, 'Ben O''Connor', 'Team Jayco–AlUla', 'AU', 30, false, false),
  ('giro-2026', 142, 'Pascal Ackermann', 'Team Jayco–AlUla', 'DE', 32, false, false),
  ('giro-2026', 143, 'Koen Bouwman', 'Team Jayco–AlUla', 'NL', 32, false, false),
  ('giro-2026', 144, 'Robert Donaldson', 'Team Jayco–AlUla', 'GB', 24, true, false),
  ('giro-2026', 145, 'Felix Engelhardt', 'Team Jayco–AlUla', 'DE', 25, false, false),
  ('giro-2026', 146, 'Alan Hatherly', 'Team Jayco–AlUla', 'ZA', 30, false, false),
  ('giro-2026', 147, 'Christopher Juul-Jensen', 'Team Jayco–AlUla', 'DK', 36, false, false),
  ('giro-2026', 148, 'Andrea Vendrame', 'Team Jayco–AlUla', 'IT', 31, false, false),
  ('giro-2026', 151, 'Warren Barguil', 'Team Picnic–PostNL', 'FR', 34, false, false),
  ('giro-2026', 152, 'Timo de Jong', 'Team Picnic–PostNL', 'NL', 27, false, false),
  ('giro-2026', 153, 'Sean Flynn', 'Team Picnic–PostNL', 'GB', 26, false, false),
  ('giro-2026', 154, 'Chris Hamilton', 'Team Picnic–PostNL', 'AU', 30, false, false),
  ('giro-2026', 155, 'Gijs Leemreize', 'Team Picnic–PostNL', 'NL', 26, false, false),
  ('giro-2026', 156, 'Tim Naberman', 'Team Picnic–PostNL', 'NL', 26, false, false),
  ('giro-2026', 157, 'Frank van den Broek', 'Team Picnic–PostNL', 'NL', 25, false, false),
  ('giro-2026', 158, 'Casper van Uden', 'Team Picnic–PostNL', 'NL', 24, true, false),
  ('giro-2026', 161, 'Mattia Bais', 'Team Polti VisitMalta', 'IT', 29, false, false),
  ('giro-2026', 162, 'Ludovico Crescioli', 'Team Polti VisitMalta', 'IT', 22, true, false),
  ('giro-2026', 163, 'Giovanni Lonardi', 'Team Polti VisitMalta', 'IT', 29, false, false),
  ('giro-2026', 164, 'Mirco Maestri', 'Team Polti VisitMalta', 'IT', 34, false, false),
  ('giro-2026', 165, 'Andrea Mifsud', 'Team Polti VisitMalta', 'MT', 26, false, false),
  ('giro-2026', 166, 'Thomas Pesenti', 'Team Polti VisitMalta', 'IT', 26, false, false),
  ('giro-2026', 167, 'Diego Pablo Sevilla', 'Team Polti VisitMalta', 'ES', 30, false, false),
  ('giro-2026', 168, 'Alessandro Tonelli', 'Team Polti VisitMalta', 'IT', 33, false, false),
  ('giro-2026', 171, 'Jonas Vingegaard', 'Visma–Lease a Bike', 'DK', 29, false, true),
  ('giro-2026', 172, 'Victor Campenaerts', 'Visma–Lease a Bike', 'BE', 34, false, false),
  ('giro-2026', 173, 'Wilco Kelderman', 'Visma–Lease a Bike', 'NL', 35, false, false),
  ('giro-2026', 174, 'Timo Kielich', 'Visma–Lease a Bike', 'BE', 26, false, false),
  ('giro-2026', 175, 'Sepp Kuss', 'Visma–Lease a Bike', 'US', 31, false, false),
  ('giro-2026', 176, 'Bart Lemmen', 'Visma–Lease a Bike', 'NL', 30, false, false),
  ('giro-2026', 177, 'Davide Piganzoli', 'Visma–Lease a Bike', 'IT', 23, true, false),
  ('giro-2026', 178, 'Tim Rex', 'Visma–Lease a Bike', 'BE', 22, true, false),
  ('giro-2026', 181, 'Michael Storer', 'Tudor Pro Cycling Team', 'AU', 29, false, false),
  ('giro-2026', 182, 'Will Barta', 'Tudor Pro Cycling Team', 'US', 30, false, false),
  ('giro-2026', 183, 'Robin Froidevaux', 'Tudor Pro Cycling Team', 'CH', 27, false, false),
  ('giro-2026', 184, 'Fabian Lienhard', 'Tudor Pro Cycling Team', 'CH', 32, false, false),
  ('giro-2026', 185, 'Luca Mozzato', 'Tudor Pro Cycling Team', 'IT', 28, false, false),
  ('giro-2026', 186, 'Mathys Rondel', 'Tudor Pro Cycling Team', 'FR', 22, true, false),
  ('giro-2026', 187, 'Florian Stork', 'Tudor Pro Cycling Team', 'DE', 29, false, false),
  ('giro-2026', 188, 'Larry Warbasse', 'Tudor Pro Cycling Team', 'US', 35, false, false),
  ('giro-2026', 191, 'Adam Yates', 'UAE Team Emirates XRG', 'GB', 33, false, false),
  ('giro-2026', 192, 'Igor Arrieta', 'UAE Team Emirates XRG', 'ES', 23, true, false),
  ('giro-2026', 193, 'Mikkel Bjerg', 'UAE Team Emirates XRG', 'DK', 27, false, false),
  ('giro-2026', 194, 'Jan Christen', 'UAE Team Emirates XRG', 'CH', 21, true, false),
  ('giro-2026', 195, 'Jhonatan Narváez', 'UAE Team Emirates XRG', 'EC', 29, false, false),
  ('giro-2026', 196, 'Marc Soler', 'UAE Team Emirates XRG', 'ES', 32, false, false),
  ('giro-2026', 197, 'António Morgado', 'UAE Team Emirates XRG', 'PT', 22, true, false),
  ('giro-2026', 198, 'Jay Vine', 'UAE Team Emirates XRG', 'AU', 30, false, false),
  ('giro-2026', 201, 'Dylan Groenewegen', 'Unibet Rose Rockets', 'NL', 32, false, false),
  ('giro-2026', 202, 'Hartthijs de Vries', 'Unibet Rose Rockets', 'NL', 29, false, false),
  ('giro-2026', 203, 'Matyáš Kopecký', 'Unibet Rose Rockets', 'CZ', 23, true, false),
  ('giro-2026', 204, 'Tomáš Kopecký', 'Unibet Rose Rockets', 'CZ', 26, false, false),
  ('giro-2026', 205, 'Lukáš Kubiš', 'Unibet Rose Rockets', 'SK', 26, false, false),
  ('giro-2026', 206, 'Niklas Larsen', 'Unibet Rose Rockets', 'DK', 29, false, false),
  ('giro-2026', 207, 'Wout Poels', 'Unibet Rose Rockets', 'NL', 38, false, false),
  ('giro-2026', 208, 'Elmar Reinders', 'Unibet Rose Rockets', 'NL', 34, false, false),
  ('giro-2026', 211, 'Erlend Blikra', 'Uno-X Mobility', 'NO', 29, false, false),
  ('giro-2026', 212, 'Markus Hoelgaard', 'Uno-X Mobility', 'NO', 31, false, false),
  ('giro-2026', 213, 'Ådne Holter', 'Uno-X Mobility', 'NO', 25, false, false),
  ('giro-2026', 214, 'Johannes Kulset', 'Uno-X Mobility', 'NO', 22, true, false),
  ('giro-2026', 215, 'Fredrik Dversnes', 'Uno-X Mobility', 'NO', 29, false, false),
  ('giro-2026', 216, 'Andreas Leknessund', 'Uno-X Mobility', 'NO', 26, false, false),
  ('giro-2026', 217, 'Sakarias Koller Løland', 'Uno-X Mobility', 'NO', 24, true, false),
  ('giro-2026', 218, 'Martin Tjøtta', 'Uno-X Mobility', 'NO', 25, true, false),
  ('giro-2026', 221, 'Davide Ballerini', 'XDS Astana Team', 'IT', 31, false, false),
  ('giro-2026', 222, 'Alberto Bettiol', 'XDS Astana Team', 'IT', 32, false, false),
  ('giro-2026', 223, 'Arjen Livyns', 'XDS Astana Team', 'BE', 31, false, false),
  ('giro-2026', 224, 'Harold Martín López', 'XDS Astana Team', 'EC', 25, false, false),
  ('giro-2026', 225, 'Matteo Malucelli', 'XDS Astana Team', 'IT', 32, false, false),
  ('giro-2026', 226, 'Christian Scaroni', 'XDS Astana Team', 'IT', 28, false, false),
  ('giro-2026', 227, 'Guillermo Thomas Silva', 'XDS Astana Team', 'UY', 24, true, false),
  ('giro-2026', 228, 'Diego Ulissi', 'XDS Astana Team', 'IT', 36, false, false);

-- ---------------------------------------------------------------------
-- Versteckte Daten für das Nachspielen (für die App nicht lesbar)
-- ---------------------------------------------------------------------
create table if not exists public.replay_stage (
  tour_id text not null, number int not null, reveal_after interval not null,
  primary key (tour_id, number));
create table if not exists public.replay_result (
  tour_id text not null, number int not null, kind text not null, position int not null, rider text not null,
  primary key (tour_id, number, kind, position));
create table if not exists public.replay_out (
  tour_id text not null, after_stage int not null, rider text not null);
create table if not exists public.replay_final (
  tour_id text not null, category text not null, position int not null, rider text, team text);
alter table public.replay_stage  enable row level security;
alter table public.replay_result enable row level security;
alter table public.replay_out    enable row level security;
alter table public.replay_final  enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.replay_stage, public.replay_result, public.replay_out, public.replay_final from anon, authenticated';
  end if;
end $$;
delete from public.replay_stage  where tour_id = 'giro-2026';
delete from public.replay_result where tour_id = 'giro-2026';
delete from public.replay_out    where tour_id = 'giro-2026';
delete from public.replay_final  where tour_id = 'giro-2026';

insert into public.replay_stage (tour_id, number, reveal_after) values
  ('giro-2026', 1, interval '12968 seconds'),
  ('giro-2026', 2, interval '21265 seconds'),
  ('giro-2026', 3, interval '15882 seconds'),
  ('giro-2026', 4, interval '12226 seconds'),
  ('giro-2026', 5, interval '19371 seconds'),
  ('giro-2026', 6, interval '12870 seconds'),
  ('giro-2026', 7, interval '23055 seconds'),
  ('giro-2026', 8, interval '13346 seconds'),
  ('giro-2026', 9, interval '16521 seconds'),
  ('giro-2026', 10, interval '14400 seconds'),
  ('giro-2026', 11, interval '17323 seconds'),
  ('giro-2026', 12, interval '14880 seconds'),
  ('giro-2026', 13, interval '14793 seconds'),
  ('giro-2026', 14, interval '14881 seconds'),
  ('giro-2026', 15, interval '11898 seconds'),
  ('giro-2026', 16, interval '11560 seconds'),
  ('giro-2026', 17, interval '17793 seconds'),
  ('giro-2026', 18, interval '14510 seconds'),
  ('giro-2026', 19, interval '17013 seconds'),
  ('giro-2026', 20, interval '19135 seconds'),
  ('giro-2026', 21, interval '12050 seconds');

insert into public.replay_result (tour_id, number, kind, position, rider) values
  ('giro-2026', 1, 'stage', 1, 'Paul Magnier'),
  ('giro-2026', 1, 'stage', 2, 'Tobias Lund Andresen'),
  ('giro-2026', 1, 'stage', 3, 'Ethan Vernon'),
  ('giro-2026', 1, 'stage', 4, 'Jonathan Milan'),
  ('giro-2026', 1, 'stage', 5, 'Madis Mihkels'),
  ('giro-2026', 1, 'stage', 6, 'Giovanni Lonardi'),
  ('giro-2026', 1, 'stage', 7, 'Pascal Ackermann'),
  ('giro-2026', 1, 'stage', 8, 'Tord Gudmestad'),
  ('giro-2026', 1, 'stage', 9, 'Max Walscheid'),
  ('giro-2026', 1, 'stage', 10, 'Dries Van Gestel'),
  ('giro-2026', 1, 'gc', 1, 'Paul Magnier'),
  ('giro-2026', 1, 'gc', 2, 'Tobias Lund Andresen'),
  ('giro-2026', 1, 'gc', 3, 'Manuele Tarozzi'),
  ('giro-2026', 1, 'gc', 4, 'Ethan Vernon'),
  ('giro-2026', 1, 'gc', 5, 'Diego Pablo Sevilla'),
  ('giro-2026', 1, 'gc', 6, 'António Morgado'),
  ('giro-2026', 1, 'gc', 7, 'Jonathan Milan'),
  ('giro-2026', 1, 'gc', 8, 'Madis Mihkels'),
  ('giro-2026', 1, 'gc', 9, 'Giovanni Lonardi'),
  ('giro-2026', 1, 'gc', 10, 'Pascal Ackermann'),
  ('giro-2026', 2, 'stage', 1, 'Guillermo Thomas Silva'),
  ('giro-2026', 2, 'stage', 2, 'Florian Stork'),
  ('giro-2026', 2, 'stage', 3, 'Giulio Ciccone'),
  ('giro-2026', 2, 'stage', 4, 'Christian Scaroni'),
  ('giro-2026', 2, 'stage', 5, 'Giulio Pellizzari'),
  ('giro-2026', 2, 'stage', 6, 'Matteo Sobrero'),
  ('giro-2026', 2, 'stage', 7, 'Andreas Leknessund'),
  ('giro-2026', 2, 'stage', 8, 'Jan Christen'),
  ('giro-2026', 2, 'stage', 9, 'Martin Tjøtta'),
  ('giro-2026', 2, 'stage', 10, 'Mathys Rondel'),
  ('giro-2026', 2, 'gc', 1, 'Guillermo Thomas Silva'),
  ('giro-2026', 2, 'gc', 2, 'Florian Stork'),
  ('giro-2026', 2, 'gc', 3, 'Egan Bernal'),
  ('giro-2026', 2, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 2, 'gc', 5, 'Giulio Ciccone'),
  ('giro-2026', 2, 'gc', 6, 'Jan Christen'),
  ('giro-2026', 2, 'gc', 7, 'Johannes Kulset'),
  ('giro-2026', 2, 'gc', 8, 'Martin Tjøtta'),
  ('giro-2026', 2, 'gc', 9, 'Lennert Van Eetvelt'),
  ('giro-2026', 2, 'gc', 10, 'Darren Rafferty'),
  ('giro-2026', 3, 'stage', 1, 'Paul Magnier'),
  ('giro-2026', 3, 'stage', 2, 'Jonathan Milan'),
  ('giro-2026', 3, 'stage', 3, 'Dylan Groenewegen'),
  ('giro-2026', 3, 'stage', 4, 'Madis Mihkels'),
  ('giro-2026', 3, 'stage', 5, 'Matteo Malucelli'),
  ('giro-2026', 3, 'stage', 6, 'Erlend Blikra'),
  ('giro-2026', 3, 'stage', 7, 'Pascal Ackermann'),
  ('giro-2026', 3, 'stage', 8, 'Davide Ballerini'),
  ('giro-2026', 3, 'stage', 9, 'Tobias Lund Andresen'),
  ('giro-2026', 3, 'stage', 10, 'Enrico Zanoncello'),
  ('giro-2026', 3, 'gc', 1, 'Guillermo Thomas Silva'),
  ('giro-2026', 3, 'gc', 2, 'Florian Stork'),
  ('giro-2026', 3, 'gc', 3, 'Egan Bernal'),
  ('giro-2026', 3, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 3, 'gc', 5, 'Giulio Ciccone'),
  ('giro-2026', 3, 'gc', 6, 'Jan Christen'),
  ('giro-2026', 3, 'gc', 7, 'Martin Tjøtta'),
  ('giro-2026', 3, 'gc', 8, 'Johannes Kulset'),
  ('giro-2026', 3, 'gc', 9, 'Enric Mas'),
  ('giro-2026', 3, 'gc', 10, 'Lennert Van Eetvelt'),
  ('giro-2026', 4, 'stage', 1, 'Jhonatan Narváez'),
  ('giro-2026', 4, 'stage', 2, 'Orluis Aular'),
  ('giro-2026', 4, 'stage', 3, 'Giulio Ciccone'),
  ('giro-2026', 4, 'stage', 4, 'Ben Turner'),
  ('giro-2026', 4, 'stage', 5, 'Alessandro Pinarello'),
  ('giro-2026', 4, 'stage', 6, 'Afonso Eulálio'),
  ('giro-2026', 4, 'stage', 7, 'Lennert Van Eetvelt'),
  ('giro-2026', 4, 'stage', 8, 'Diego Ulissi'),
  ('giro-2026', 4, 'stage', 9, 'Andrea Raccagni Noviero'),
  ('giro-2026', 4, 'stage', 10, 'Michael Valgren'),
  ('giro-2026', 4, 'gc', 1, 'Giulio Ciccone'),
  ('giro-2026', 4, 'gc', 2, 'Jan Christen'),
  ('giro-2026', 4, 'gc', 3, 'Florian Stork'),
  ('giro-2026', 4, 'gc', 4, 'Egan Bernal'),
  ('giro-2026', 4, 'gc', 5, 'Thymen Arensman'),
  ('giro-2026', 4, 'gc', 6, 'Giulio Pellizzari'),
  ('giro-2026', 4, 'gc', 7, 'Lennert Van Eetvelt'),
  ('giro-2026', 4, 'gc', 8, 'Enric Mas'),
  ('giro-2026', 4, 'gc', 9, 'Markel Beloki'),
  ('giro-2026', 4, 'gc', 10, 'Jan Hirt'),
  ('giro-2026', 5, 'stage', 1, 'Igor Arrieta'),
  ('giro-2026', 5, 'stage', 2, 'Afonso Eulálio'),
  ('giro-2026', 5, 'stage', 3, 'Guillermo Thomas Silva'),
  ('giro-2026', 5, 'stage', 4, 'Lorenzo Milesi'),
  ('giro-2026', 5, 'stage', 5, 'Christian Scaroni'),
  ('giro-2026', 5, 'stage', 6, 'Gianmarco Garofoli'),
  ('giro-2026', 5, 'stage', 7, 'Koen Bouwman'),
  ('giro-2026', 5, 'stage', 8, 'Johannes Kulset'),
  ('giro-2026', 5, 'stage', 9, 'Andrea Raccagni Noviero'),
  ('giro-2026', 5, 'stage', 10, 'Ludovico Crescioli'),
  ('giro-2026', 5, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 5, 'gc', 2, 'Igor Arrieta'),
  ('giro-2026', 5, 'gc', 3, 'Christian Scaroni'),
  ('giro-2026', 5, 'gc', 4, 'Andrea Raccagni Noviero'),
  ('giro-2026', 5, 'gc', 5, 'Johannes Kulset'),
  ('giro-2026', 5, 'gc', 6, 'Giulio Ciccone'),
  ('giro-2026', 5, 'gc', 7, 'Jan Christen'),
  ('giro-2026', 5, 'gc', 8, 'Florian Stork'),
  ('giro-2026', 5, 'gc', 9, 'Egan Bernal'),
  ('giro-2026', 5, 'gc', 10, 'Thymen Arensman'),
  ('giro-2026', 6, 'stage', 1, 'Davide Ballerini'),
  ('giro-2026', 6, 'stage', 2, 'Jasper Stuyven'),
  ('giro-2026', 6, 'stage', 3, 'Paul Magnier'),
  ('giro-2026', 6, 'stage', 4, 'Jensen Plowright'),
  ('giro-2026', 6, 'stage', 5, 'Ben Turner'),
  ('giro-2026', 6, 'stage', 6, 'Alec Segaert'),
  ('giro-2026', 6, 'stage', 7, 'Luca Mozzato'),
  ('giro-2026', 6, 'stage', 8, 'Filippo Magli'),
  ('giro-2026', 6, 'stage', 9, 'Enrico Zanoncello'),
  ('giro-2026', 6, 'stage', 10, 'Casper van Uden'),
  ('giro-2026', 6, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 6, 'gc', 2, 'Igor Arrieta'),
  ('giro-2026', 6, 'gc', 3, 'Christian Scaroni'),
  ('giro-2026', 6, 'gc', 4, 'Andrea Raccagni Noviero'),
  ('giro-2026', 6, 'gc', 5, 'Johannes Kulset'),
  ('giro-2026', 6, 'gc', 6, 'Giulio Ciccone'),
  ('giro-2026', 6, 'gc', 7, 'Jan Christen'),
  ('giro-2026', 6, 'gc', 8, 'Florian Stork'),
  ('giro-2026', 6, 'gc', 9, 'Egan Bernal'),
  ('giro-2026', 6, 'gc', 10, 'Thymen Arensman'),
  ('giro-2026', 7, 'stage', 1, 'Jonas Vingegaard'),
  ('giro-2026', 7, 'stage', 2, 'Felix Gall'),
  ('giro-2026', 7, 'stage', 3, 'Jai Hindley'),
  ('giro-2026', 7, 'stage', 4, 'Giulio Pellizzari'),
  ('giro-2026', 7, 'stage', 5, 'Ben O''Connor'),
  ('giro-2026', 7, 'stage', 6, 'Mathys Rondel'),
  ('giro-2026', 7, 'stage', 7, 'Giulio Ciccone'),
  ('giro-2026', 7, 'stage', 8, 'Derek Gee-West'),
  ('giro-2026', 7, 'stage', 9, 'Michael Storer'),
  ('giro-2026', 7, 'stage', 10, 'Thymen Arensman'),
  ('giro-2026', 7, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 7, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 7, 'gc', 3, 'Felix Gall'),
  ('giro-2026', 7, 'gc', 4, 'Jai Hindley'),
  ('giro-2026', 7, 'gc', 5, 'Giulio Pellizzari'),
  ('giro-2026', 7, 'gc', 6, 'Ben O''Connor'),
  ('giro-2026', 7, 'gc', 7, 'Mathys Rondel'),
  ('giro-2026', 7, 'gc', 8, 'Giulio Ciccone'),
  ('giro-2026', 7, 'gc', 9, 'Thymen Arensman'),
  ('giro-2026', 7, 'gc', 10, 'Michael Storer'),
  ('giro-2026', 8, 'stage', 1, 'Jhonatan Narváez'),
  ('giro-2026', 8, 'stage', 2, 'Andreas Leknessund'),
  ('giro-2026', 8, 'stage', 3, 'Martin Tjøtta'),
  ('giro-2026', 8, 'stage', 4, 'Guillermo Thomas Silva'),
  ('giro-2026', 8, 'stage', 5, 'Lorenzo Milesi'),
  ('giro-2026', 8, 'stage', 6, 'Christian Scaroni'),
  ('giro-2026', 8, 'stage', 7, 'Corbin Strong'),
  ('giro-2026', 8, 'stage', 8, 'Juan Pedro López'),
  ('giro-2026', 8, 'stage', 9, 'Wout Poels'),
  ('giro-2026', 8, 'stage', 10, 'Markel Beloki'),
  ('giro-2026', 8, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 8, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 8, 'gc', 3, 'Felix Gall'),
  ('giro-2026', 8, 'gc', 4, 'Christian Scaroni'),
  ('giro-2026', 8, 'gc', 5, 'Jai Hindley'),
  ('giro-2026', 8, 'gc', 6, 'Giulio Pellizzari'),
  ('giro-2026', 8, 'gc', 7, 'Ben O''Connor'),
  ('giro-2026', 8, 'gc', 8, 'Mathys Rondel'),
  ('giro-2026', 8, 'gc', 9, 'Thymen Arensman'),
  ('giro-2026', 8, 'gc', 10, 'Michael Storer'),
  ('giro-2026', 9, 'stage', 1, 'Jonas Vingegaard'),
  ('giro-2026', 9, 'stage', 2, 'Felix Gall'),
  ('giro-2026', 9, 'stage', 3, 'Davide Piganzoli'),
  ('giro-2026', 9, 'stage', 4, 'Thymen Arensman'),
  ('giro-2026', 9, 'stage', 5, 'Afonso Eulálio'),
  ('giro-2026', 9, 'stage', 6, 'Derek Gee-West'),
  ('giro-2026', 9, 'stage', 7, 'Mathys Rondel'),
  ('giro-2026', 9, 'stage', 8, 'Sepp Kuss'),
  ('giro-2026', 9, 'stage', 9, 'Jai Hindley'),
  ('giro-2026', 9, 'stage', 10, 'Michael Storer'),
  ('giro-2026', 9, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 9, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 9, 'gc', 3, 'Felix Gall'),
  ('giro-2026', 9, 'gc', 4, 'Jai Hindley'),
  ('giro-2026', 9, 'gc', 5, 'Christian Scaroni'),
  ('giro-2026', 9, 'gc', 6, 'Thymen Arensman'),
  ('giro-2026', 9, 'gc', 7, 'Mathys Rondel'),
  ('giro-2026', 9, 'gc', 8, 'Ben O''Connor'),
  ('giro-2026', 9, 'gc', 9, 'Giulio Pellizzari'),
  ('giro-2026', 9, 'gc', 10, 'Michael Storer'),
  ('giro-2026', 10, 'stage', 1, 'Filippo Ganna'),
  ('giro-2026', 10, 'stage', 2, 'Thymen Arensman'),
  ('giro-2026', 10, 'stage', 3, 'Rémi Cavagna'),
  ('giro-2026', 10, 'stage', 4, 'Sjoerd Bax'),
  ('giro-2026', 10, 'stage', 5, 'Derek Gee-West'),
  ('giro-2026', 10, 'stage', 6, 'Max Walscheid'),
  ('giro-2026', 10, 'stage', 7, 'Johan Price-Pejtersen'),
  ('giro-2026', 10, 'stage', 8, 'Mikkel Bjerg'),
  ('giro-2026', 10, 'stage', 9, 'Lorenzo Milesi'),
  ('giro-2026', 10, 'stage', 10, 'Niklas Larsen'),
  ('giro-2026', 10, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 10, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 10, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 10, 'gc', 4, 'Felix Gall'),
  ('giro-2026', 10, 'gc', 5, 'Ben O''Connor'),
  ('giro-2026', 10, 'gc', 6, 'Jai Hindley'),
  ('giro-2026', 10, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 10, 'gc', 8, 'Derek Gee-West'),
  ('giro-2026', 10, 'gc', 9, 'Giulio Pellizzari'),
  ('giro-2026', 10, 'gc', 10, 'Markel Beloki'),
  ('giro-2026', 11, 'stage', 1, 'Jhonatan Narváez'),
  ('giro-2026', 11, 'stage', 2, 'Enric Mas'),
  ('giro-2026', 11, 'stage', 3, 'Diego Ulissi'),
  ('giro-2026', 11, 'stage', 4, 'Chris Harper'),
  ('giro-2026', 11, 'stage', 5, 'Aleksandr Vlasov'),
  ('giro-2026', 11, 'stage', 6, 'Christian Scaroni'),
  ('giro-2026', 11, 'stage', 7, 'Ludovico Crescioli'),
  ('giro-2026', 11, 'stage', 8, 'Simone Gualdi'),
  ('giro-2026', 11, 'stage', 9, 'Warren Barguil'),
  ('giro-2026', 11, 'stage', 10, 'Andrea Raccagni Noviero'),
  ('giro-2026', 11, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 11, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 11, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 11, 'gc', 4, 'Felix Gall'),
  ('giro-2026', 11, 'gc', 5, 'Ben O''Connor'),
  ('giro-2026', 11, 'gc', 6, 'Jai Hindley'),
  ('giro-2026', 11, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 11, 'gc', 8, 'Derek Gee-West'),
  ('giro-2026', 11, 'gc', 9, 'Giulio Pellizzari'),
  ('giro-2026', 11, 'gc', 10, 'Chris Harper'),
  ('giro-2026', 12, 'stage', 1, 'Alec Segaert'),
  ('giro-2026', 12, 'stage', 2, 'Toon Aerts'),
  ('giro-2026', 12, 'stage', 3, 'Guillermo Thomas Silva'),
  ('giro-2026', 12, 'stage', 4, 'Ethan Vernon'),
  ('giro-2026', 12, 'stage', 5, 'Jasper Stuyven'),
  ('giro-2026', 12, 'stage', 6, 'Orluis Aular'),
  ('giro-2026', 12, 'stage', 7, 'Madis Mihkels'),
  ('giro-2026', 12, 'stage', 8, 'Jhonatan Narváez'),
  ('giro-2026', 12, 'stage', 9, 'Edoardo Zambanini'),
  ('giro-2026', 12, 'stage', 10, 'Sakarias Koller Løland'),
  ('giro-2026', 12, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 12, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 12, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 12, 'gc', 4, 'Felix Gall'),
  ('giro-2026', 12, 'gc', 5, 'Ben O''Connor'),
  ('giro-2026', 12, 'gc', 6, 'Jai Hindley'),
  ('giro-2026', 12, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 12, 'gc', 8, 'Derek Gee-West'),
  ('giro-2026', 12, 'gc', 9, 'Giulio Pellizzari'),
  ('giro-2026', 12, 'gc', 10, 'Chris Harper'),
  ('giro-2026', 13, 'stage', 1, 'Alberto Bettiol'),
  ('giro-2026', 13, 'stage', 2, 'Andreas Leknessund'),
  ('giro-2026', 13, 'stage', 3, 'Jasper Stuyven'),
  ('giro-2026', 13, 'stage', 4, 'Michael Valgren'),
  ('giro-2026', 13, 'stage', 5, 'Mark Donovan'),
  ('giro-2026', 13, 'stage', 6, 'Josh Kench'),
  ('giro-2026', 13, 'stage', 7, 'Mikkel Bjerg'),
  ('giro-2026', 13, 'stage', 8, 'Francesco Busatto'),
  ('giro-2026', 13, 'stage', 9, 'Markus Hoelgaard'),
  ('giro-2026', 13, 'stage', 10, 'Diego Pablo Sevilla'),
  ('giro-2026', 13, 'gc', 1, 'Afonso Eulálio'),
  ('giro-2026', 13, 'gc', 2, 'Jonas Vingegaard'),
  ('giro-2026', 13, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 13, 'gc', 4, 'Felix Gall'),
  ('giro-2026', 13, 'gc', 5, 'Ben O''Connor'),
  ('giro-2026', 13, 'gc', 6, 'Jai Hindley'),
  ('giro-2026', 13, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 13, 'gc', 8, 'Derek Gee-West'),
  ('giro-2026', 13, 'gc', 9, 'Giulio Pellizzari'),
  ('giro-2026', 13, 'gc', 10, 'Chris Harper'),
  ('giro-2026', 14, 'stage', 1, 'Jonas Vingegaard'),
  ('giro-2026', 14, 'stage', 2, 'Felix Gall'),
  ('giro-2026', 14, 'stage', 3, 'Jai Hindley'),
  ('giro-2026', 14, 'stage', 4, 'Davide Piganzoli'),
  ('giro-2026', 14, 'stage', 5, 'Giulio Pellizzari'),
  ('giro-2026', 14, 'stage', 6, 'Thymen Arensman'),
  ('giro-2026', 14, 'stage', 7, 'Michael Storer'),
  ('giro-2026', 14, 'stage', 8, 'Wout Poels'),
  ('giro-2026', 14, 'stage', 9, 'Jan Hirt'),
  ('giro-2026', 14, 'stage', 10, 'Egan Bernal'),
  ('giro-2026', 14, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 14, 'gc', 2, 'Afonso Eulálio'),
  ('giro-2026', 14, 'gc', 3, 'Felix Gall'),
  ('giro-2026', 14, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 14, 'gc', 5, 'Jai Hindley'),
  ('giro-2026', 14, 'gc', 6, 'Giulio Pellizzari'),
  ('giro-2026', 14, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 14, 'gc', 8, 'Ben O''Connor'),
  ('giro-2026', 14, 'gc', 9, 'Derek Gee-West'),
  ('giro-2026', 14, 'gc', 10, 'Davide Piganzoli'),
  ('giro-2026', 15, 'stage', 1, 'Fredrik Dversnes'),
  ('giro-2026', 15, 'stage', 2, 'Mirco Maestri'),
  ('giro-2026', 15, 'stage', 3, 'Martin Marcellusi'),
  ('giro-2026', 15, 'stage', 4, 'Mattia Bais'),
  ('giro-2026', 15, 'stage', 5, 'Paul Magnier'),
  ('giro-2026', 15, 'stage', 6, 'Dylan Groenewegen'),
  ('giro-2026', 15, 'stage', 7, 'Tobias Lund Andresen'),
  ('giro-2026', 15, 'stage', 8, 'Ethan Vernon'),
  ('giro-2026', 15, 'stage', 9, 'Paul Penhoët'),
  ('giro-2026', 15, 'stage', 10, 'Luca Mozzato'),
  ('giro-2026', 15, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 15, 'gc', 2, 'Afonso Eulálio'),
  ('giro-2026', 15, 'gc', 3, 'Felix Gall'),
  ('giro-2026', 15, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 15, 'gc', 5, 'Jai Hindley'),
  ('giro-2026', 15, 'gc', 6, 'Giulio Pellizzari'),
  ('giro-2026', 15, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 15, 'gc', 8, 'Ben O''Connor'),
  ('giro-2026', 15, 'gc', 9, 'Derek Gee-West'),
  ('giro-2026', 15, 'gc', 10, 'Davide Piganzoli'),
  ('giro-2026', 16, 'stage', 1, 'Jonas Vingegaard'),
  ('giro-2026', 16, 'stage', 2, 'Felix Gall'),
  ('giro-2026', 16, 'stage', 3, 'Jai Hindley'),
  ('giro-2026', 16, 'stage', 4, 'Thymen Arensman'),
  ('giro-2026', 16, 'stage', 5, 'Derek Gee-West'),
  ('giro-2026', 16, 'stage', 6, 'Davide Piganzoli'),
  ('giro-2026', 16, 'stage', 7, 'Egan Bernal'),
  ('giro-2026', 16, 'stage', 8, 'Michael Storer'),
  ('giro-2026', 16, 'stage', 9, 'Mathys Rondel'),
  ('giro-2026', 16, 'stage', 10, 'Wout Poels'),
  ('giro-2026', 16, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 16, 'gc', 2, 'Felix Gall'),
  ('giro-2026', 16, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 16, 'gc', 4, 'Jai Hindley'),
  ('giro-2026', 16, 'gc', 5, 'Afonso Eulálio'),
  ('giro-2026', 16, 'gc', 6, 'Derek Gee-West'),
  ('giro-2026', 16, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 16, 'gc', 8, 'Davide Piganzoli'),
  ('giro-2026', 16, 'gc', 9, 'Ben O''Connor'),
  ('giro-2026', 16, 'gc', 10, 'Egan Bernal'),
  ('giro-2026', 17, 'stage', 1, 'Michael Valgren'),
  ('giro-2026', 17, 'stage', 2, 'Andreas Leknessund'),
  ('giro-2026', 17, 'stage', 3, 'Damiano Caruso'),
  ('giro-2026', 17, 'stage', 4, 'Aleksandr Vlasov'),
  ('giro-2026', 17, 'stage', 5, 'Einer Rubio'),
  ('giro-2026', 17, 'stage', 6, 'Igor Arrieta'),
  ('giro-2026', 17, 'stage', 7, 'Gianmarco Garofoli'),
  ('giro-2026', 17, 'stage', 8, 'David de la Cruz'),
  ('giro-2026', 17, 'stage', 9, 'Jhonatan Narváez'),
  ('giro-2026', 17, 'stage', 10, 'Mark Donovan'),
  ('giro-2026', 17, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 17, 'gc', 2, 'Felix Gall'),
  ('giro-2026', 17, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 17, 'gc', 4, 'Jai Hindley'),
  ('giro-2026', 17, 'gc', 5, 'Afonso Eulálio'),
  ('giro-2026', 17, 'gc', 6, 'Derek Gee-West'),
  ('giro-2026', 17, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 17, 'gc', 8, 'Davide Piganzoli'),
  ('giro-2026', 17, 'gc', 9, 'Damiano Caruso'),
  ('giro-2026', 17, 'gc', 10, 'Ben O''Connor'),
  ('giro-2026', 18, 'stage', 1, 'Paul Magnier'),
  ('giro-2026', 18, 'stage', 2, 'Edoardo Zambanini'),
  ('giro-2026', 18, 'stage', 3, 'Jonathan Milan'),
  ('giro-2026', 18, 'stage', 4, 'Francesco Busatto'),
  ('giro-2026', 18, 'stage', 5, 'Corbin Strong'),
  ('giro-2026', 18, 'stage', 6, 'Guillermo Thomas Silva'),
  ('giro-2026', 18, 'stage', 7, 'Madis Mihkels'),
  ('giro-2026', 18, 'stage', 8, 'Filippo Magli'),
  ('giro-2026', 18, 'stage', 9, 'Sakarias Koller Løland'),
  ('giro-2026', 18, 'stage', 10, 'Lukáš Kubiš'),
  ('giro-2026', 18, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 18, 'gc', 2, 'Felix Gall'),
  ('giro-2026', 18, 'gc', 3, 'Thymen Arensman'),
  ('giro-2026', 18, 'gc', 4, 'Jai Hindley'),
  ('giro-2026', 18, 'gc', 5, 'Afonso Eulálio'),
  ('giro-2026', 18, 'gc', 6, 'Derek Gee-West'),
  ('giro-2026', 18, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 18, 'gc', 8, 'Davide Piganzoli'),
  ('giro-2026', 18, 'gc', 9, 'Damiano Caruso'),
  ('giro-2026', 18, 'gc', 10, 'Ben O''Connor'),
  ('giro-2026', 19, 'stage', 1, 'Sepp Kuss'),
  ('giro-2026', 19, 'stage', 2, 'Derek Gee-West'),
  ('giro-2026', 19, 'stage', 3, 'Giulio Ciccone'),
  ('giro-2026', 19, 'stage', 4, 'Felix Gall'),
  ('giro-2026', 19, 'stage', 5, 'Jonas Vingegaard'),
  ('giro-2026', 19, 'stage', 6, 'Jai Hindley'),
  ('giro-2026', 19, 'stage', 7, 'Damiano Caruso'),
  ('giro-2026', 19, 'stage', 8, 'Davide Piganzoli'),
  ('giro-2026', 19, 'stage', 9, 'Einer Rubio'),
  ('giro-2026', 19, 'stage', 10, 'Michael Storer'),
  ('giro-2026', 19, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 19, 'gc', 2, 'Felix Gall'),
  ('giro-2026', 19, 'gc', 3, 'Jai Hindley'),
  ('giro-2026', 19, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 19, 'gc', 5, 'Derek Gee-West'),
  ('giro-2026', 19, 'gc', 6, 'Afonso Eulálio'),
  ('giro-2026', 19, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 19, 'gc', 8, 'Davide Piganzoli'),
  ('giro-2026', 19, 'gc', 9, 'Damiano Caruso'),
  ('giro-2026', 19, 'gc', 10, 'Egan Bernal'),
  ('giro-2026', 20, 'stage', 1, 'Jonas Vingegaard'),
  ('giro-2026', 20, 'stage', 2, 'Felix Gall'),
  ('giro-2026', 20, 'stage', 3, 'Jai Hindley'),
  ('giro-2026', 20, 'stage', 4, 'Derek Gee-West'),
  ('giro-2026', 20, 'stage', 5, 'Thymen Arensman'),
  ('giro-2026', 20, 'stage', 6, 'Egan Bernal'),
  ('giro-2026', 20, 'stage', 7, 'Afonso Eulálio'),
  ('giro-2026', 20, 'stage', 8, 'Damiano Caruso'),
  ('giro-2026', 20, 'stage', 9, 'Michael Storer'),
  ('giro-2026', 20, 'stage', 10, 'Davide Piganzoli'),
  ('giro-2026', 20, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 20, 'gc', 2, 'Felix Gall'),
  ('giro-2026', 20, 'gc', 3, 'Jai Hindley'),
  ('giro-2026', 20, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 20, 'gc', 5, 'Derek Gee-West'),
  ('giro-2026', 20, 'gc', 6, 'Afonso Eulálio'),
  ('giro-2026', 20, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 20, 'gc', 8, 'Davide Piganzoli'),
  ('giro-2026', 20, 'gc', 9, 'Damiano Caruso'),
  ('giro-2026', 20, 'gc', 10, 'Egan Bernal'),
  ('giro-2026', 21, 'stage', 1, 'Jonathan Milan'),
  ('giro-2026', 21, 'stage', 2, 'Giovanni Lonardi'),
  ('giro-2026', 21, 'stage', 3, 'Paul Penhoët'),
  ('giro-2026', 21, 'stage', 4, 'Dylan Groenewegen'),
  ('giro-2026', 21, 'stage', 5, 'Madis Mihkels'),
  ('giro-2026', 21, 'stage', 6, 'Jensen Plowright'),
  ('giro-2026', 21, 'stage', 7, 'Tobias Lund Andresen'),
  ('giro-2026', 21, 'stage', 8, 'Corbin Strong'),
  ('giro-2026', 21, 'stage', 9, 'Toon Aerts'),
  ('giro-2026', 21, 'stage', 10, 'Luca Mozzato'),
  ('giro-2026', 21, 'gc', 1, 'Jonas Vingegaard'),
  ('giro-2026', 21, 'gc', 2, 'Felix Gall'),
  ('giro-2026', 21, 'gc', 3, 'Jai Hindley'),
  ('giro-2026', 21, 'gc', 4, 'Thymen Arensman'),
  ('giro-2026', 21, 'gc', 5, 'Derek Gee-West'),
  ('giro-2026', 21, 'gc', 6, 'Afonso Eulálio'),
  ('giro-2026', 21, 'gc', 7, 'Michael Storer'),
  ('giro-2026', 21, 'gc', 8, 'Davide Piganzoli'),
  ('giro-2026', 21, 'gc', 9, 'Damiano Caruso'),
  ('giro-2026', 21, 'gc', 10, 'Egan Bernal');

insert into public.replay_out (tour_id, after_stage, rider) values
  ('giro-2026', 1, 'Matteo Moschetti'),
  ('giro-2026', 2, 'Santiago Buitrago'),
  ('giro-2026', 2, 'Andrea Vendrame'),
  ('giro-2026', 2, 'Adam Yates'),
  ('giro-2026', 2, 'Marc Soler'),
  ('giro-2026', 2, 'Jay Vine'),
  ('giro-2026', 2, 'Ådne Holter'),
  ('giro-2026', 3, 'Wilco Kelderman'),
  ('giro-2026', 4, 'Kaden Groves'),
  ('giro-2026', 4, 'Arnaud De Lie'),
  ('giro-2026', 4, 'Milan Menten'),
  ('giro-2026', 5, 'Samuele Battistella'),
  ('giro-2026', 5, 'Joshua Giddings'),
  ('giro-2026', 5, 'Felix Engelhardt'),
  ('giro-2026', 5, 'Timo de Jong'),
  ('giro-2026', 8, 'Jake Stewart'),
  ('giro-2026', 8, 'Fabio Christen'),
  ('giro-2026', 11, 'Edward Planckaert'),
  ('giro-2026', 11, 'Lennert Van Eetvelt'),
  ('giro-2026', 11, 'Sjoerd Bax'),
  ('giro-2026', 11, 'Erlend Blikra'),
  ('giro-2026', 11, 'Martin Tjøtta'),
  ('giro-2026', 11, 'Davide Ballerini'),
  ('giro-2026', 12, 'Javier Romo'),
  ('giro-2026', 14, 'Christian Scaroni'),
  ('giro-2026', 15, 'Enrico Zanoncello'),
  ('giro-2026', 15, 'Pascal Ackermann'),
  ('giro-2026', 17, 'Nickolas Zukowsky'),
  ('giro-2026', 18, 'James Shaw'),
  ('giro-2026', 18, 'Michael Valgren'),
  ('giro-2026', 19, 'Ethan Vernon'),
  ('giro-2026', 19, 'Jhonatan Narváez'),
  ('giro-2026', 20, 'Sean Flynn');

insert into public.replay_final (tour_id, category, position, rider, team) values
  ('giro-2026', 'gc', 1, 'Jonas Vingegaard', null),
  ('giro-2026', 'gc', 2, 'Felix Gall', null),
  ('giro-2026', 'gc', 3, 'Jai Hindley', null),
  ('giro-2026', 'rest', 1, 'Felix Gall', null),
  ('giro-2026', 'rest', 2, 'Jai Hindley', null),
  ('giro-2026', 'rest', 3, 'Thymen Arensman', null),
  ('giro-2026', 'points', 1, 'Paul Magnier', null),
  ('giro-2026', 'points', 2, 'Jonathan Milan', null),
  ('giro-2026', 'points', 3, 'Guillermo Thomas Silva', null),
  ('giro-2026', 'mountains', 1, 'Giulio Ciccone', null),
  ('giro-2026', 'mountains', 2, 'Jonas Vingegaard', null),
  ('giro-2026', 'mountains', 3, 'Einer Rubio', null),
  ('giro-2026', 'youth', 1, 'Afonso Eulálio', null),
  ('giro-2026', 'youth', 2, 'Davide Piganzoli', null),
  ('giro-2026', 'youth', 3, 'Mathys Rondel', null),
  ('giro-2026', 'combative', 1, 'Damiano Caruso', null),
  ('giro-2026', 'team', 1, null, 'Visma–Lease a Bike'),
  ('giro-2026', 'team', 2, null, 'Netcompany INEOS'),
  ('giro-2026', 'team', 3, null, 'Red Bull–Bora–Hansgrohe');

-- ---------------------------------------------------------------------
-- Nachspielen: veröffentlicht fällige Etappen mit dem echten Ergebnis
-- ---------------------------------------------------------------------
create or replace function public.replay_giro2026()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tour  text := 'giro-2026';
  v_stage record;
  v_count int := 0;
  v_last  int;
begin
  for v_stage in
    select s.id, s.number from stages s join replay_stage rs on rs.tour_id = s.tour_id and rs.number = s.number
     where s.tour_id = v_tour and not s.results_published and s.starts_at + rs.reveal_after <= now()
     order by s.number
  loop
    delete from stage_results where stage_id = v_stage.id;
    insert into stage_results (stage_id, position, rider_id)
    select v_stage.id, x.position, r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'stage';
    update stages set results_published = true where id = v_stage.id;

    -- Ausstiege wie im echten Rennen
    update riders r set status = 'out'
      from replay_out o
     where o.tour_id = v_tour and o.after_stage = v_stage.number and r.tour_id = v_tour and r.name = o.rider;

    -- Zwischenstand der Bonuswertungen aus der Gesamtwertung nach dieser Etappe
    delete from bonus_results where tour_id = v_tour;
    insert into bonus_results (tour_id, category, position, rider_id)
    select v_tour, 'gc', x.position, r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc' and x.position <= 3;
    insert into bonus_results (tour_id, category, position, rider_id)
    select v_tour, 'rest', row_number() over (order by x.position), r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc' and not r.excluded_from_rest
     order by x.position limit 3;
    insert into bonus_results (tour_id, category, position, rider_id)
    select v_tour, 'youth', row_number() over (order by x.position), r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc' and r.young
     order by x.position limit 3;

    v_count := v_count + 1;
  end loop;

  -- Nach der letzten Etappe: echter Endstand aller Wertungen
  select max(number) into v_last from stages where tour_id = v_tour;
  if v_count > 0 and not exists (select 1 from stages where tour_id = v_tour and not results_published) then
    delete from bonus_results where tour_id = v_tour;
    insert into bonus_results (tour_id, category, position, rider_id, team)
    select v_tour, f.category, f.position, r.id, f.team
      from replay_final f left join riders r on r.tour_id = v_tour and r.name = f.rider
     where f.tour_id = v_tour;
    update tours set bonus_final = true where id = v_tour;
  end if;

  return v_count;
end;
$fn$;

revoke all on function public.replay_giro2026() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.replay_giro2026() from anon, authenticated';
  end if;
end $$;

commit;

-- Automatik: alle 5 Minuten prüfen (pg_cron ist bei Supabase dabei)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('giro2026-replay', '*/5 * * * *', 'select public.replay_giro2026()');
    raise notice 'Giro 2026 Testrunde angelegt – Ergebnisse kommen etwa zur echten Zielankunft.';
  else
    raise notice 'pg_cron nicht verfügbar – Ergebnisse mit select public.replay_giro2026(); auslösen.';
  end if;
end $$;
