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
insert into public.tours (id, name, short_name, theme, year, start_date, end_date, is_visible, pcs_slug, tip_limit, info)
values ('giro-2026', 'Giro d''Italia 2026 · Testrunde', 'Giro 26', 'giro',
        extract(year from now())::int,
        (now() at time zone 'Europe/Berlin')::date + 1,
        (now() at time zone 'Europe/Berlin')::date + 21,
        true, 'giro-d-italia/2026', 3, '{"kom":{"1":[40,18,12,9,6,4,2,1],"2":[18,8,6,4,2,1],"3":[9,4,2,1],"4":[3,2,1],"CC":[50,30,20,14,10,6,4,2,1]},"sprint_points":[12,8,5,3,1],"finish_bonus":[10,6,4],"redbull_bonus":[6,4,2],"redbull_points":[15,8,5,3,1],"stage_points":{"A/B (flach)":[50,35,25,18,14,12,10,8,7,6,5,4,3,2,1],"C (mittel)":[25,18,12,8,6,5,4,3,2,1],"D/E (Berg, Zeitfahren)":[15,12,9,7,6,5,4,3,2,1]}}'::jsonb);

-- Etappen
insert into public.stages (tour_id, number, starts_at, kind, departure, arrival, distance_km, elevation_m, climbs, sprints, info) values
  ('giro-2026', 1, ((((now() at time zone 'Europe/Berlin')::date + 1)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Nessebar', 'Burgas', 147, 500, '[{"name":"Kap Agalina","cat":"4","km":84.3,"len":1.2,"grad":2.2,"max":6,"alt":42},{"name":"Kap Agalina","cat":"4","km":106.4,"len":1.2,"grad":2.2,"max":6,"alt":42}]'::jsonb, '[{"km":90,"name":"Sozopol","kind":"sprint"},{"km":114.7,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-08","neutral_km":5,"three_sec":true,"route":"Flache Etappe mit kurzen Wellen, konzentriert auf einen 22 km langen Rundkurs, der etwa zur Hälfte zweimal gefahren wird. Die Strecke folgt der Küste, passiert einmal das Ziel und führt nach Sozopol zu zwei Runden auf einem schnellen, welligen Kurs mit der Bergwertung am Kap Agalina (zwei Durchfahrten). Zurück nach Burgas geht es über eine schnelle Küstenstraße bis ins Zentrum.","finale":"Breite, überwiegend gerade Straßen. Der letzte Kilometer steigt leicht an, letzte Kurve 300 m vor dem Ziel, Zielgerade 8 m breit.","feed":"114.7"}'::jsonb),
  ('giro-2026', 2, ((((now() at time zone 'Europe/Berlin')::date + 2)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Burgas', 'Veliko Tarnovo', 221, 2600, '[{"name":"Byala-Pass","cat":"3","km":116.3,"len":7.7,"grad":4.6,"max":10,"alt":712},{"name":"Vratnik-Pass","cat":"3","km":134.1,"len":9.1,"grad":4.4,"max":11,"alt":920},{"name":"Lyaskovets-Kloster","cat":"3","km":210.6,"len":3.9,"grad":6.8,"max":14,"alt":452}]'::jsonb, '[{"km":100.4,"name":"Sliven","kind":"sprint"},{"km":205.5,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-09","route":"Bewegte Etappe durch Täler des Balkans. Zunächst flach auf breiten Straßen, nach Sliven folgen mehrere Anstiege und Abfahrten. Kurz vor Veliko Tarnovo geht es durch Lyaskovets und 11 km vor dem Ziel hinauf zum Kloster-Pass. Danach Abfahrt nach Veliko Tarnovo und ein schweres Finale.","finale":"Die letzten 3 km zuerst flach, dann steil (bis 9 %) durch Tsarevets, teils auf Porphyr-Pflaster. Letzter Kilometer fast flach mit kurzer Abfahrt vor der Rampe ins Ziel; die letzten 500 m schnurgerade, 8 m breit.","feed":"205.5"}'::jsonb),
  ('giro-2026', 3, ((((now() at time zone 'Europe/Berlin')::date + 3)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Plovdiv', 'Sofia', 175, 1600, '[{"name":"Borovets-Pass","cat":"2","km":103.2,"len":9.2,"grad":5.4,"max":11,"alt":1334}]'::jsonb, '[{"km":85.8,"name":"Dolna Banja","kind":"sprint"},{"km":162,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-10","neutral_km":3,"three_sec":true,"route":"Die Etappe teilt sich in zwei Hälften: erst stetig leicht bergauf bis zum Skiort Borovets, dann stetig leicht bergab bis Sofia. Auch in den Bergen sind die Straßen breit, zum Schluss geht es auf schnellen Ausfallstraßen in die Hauptstadt.","finale":"Die letzten 8 km praktisch gerade und ganz leicht abfallend, der letzte Kilometer flach. Ziel auf 8 m breiter Straße.","feed":"162.0"}'::jsonb),
  ('giro-2026', 4, ((((now() at time zone 'Europe/Berlin')::date + 4)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Catanzaro', 'Cosenza', 138, 1800, '[{"name":"Cozzo Tunno","cat":"2","km":95,"len":14.5,"grad":5.9,"max":11,"alt":921}]'::jsonb, '[{"km":80.5,"name":"San Lucido","kind":"sprint"},{"km":126.4,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-12","neutral_km":5,"three_sec":true,"route":"Kurz und schnell, aber mit einem langen, nicht allzu schweren Anstieg in der Mitte. Von Catanzaro ohne Höhenmeter nach Lamezia Terme, dann auf breiter, leicht welliger Straße die tyrrhenische Küste entlang (SS 18). Nach San Lucido folgt Cozzo Tunno: fast 15 km lang, aber ohne steile Rampen. Lange Abfahrt in die Crati-Ebene, dann leicht ansteigend ins Ziel nach Cosenza.","finale":"Die letzten 3 km auf breiten Stadtstraßen mit einigen Kurven, leicht steigend bis zur Brücke über den Crati. Über weite Kurven auf die Zielgerade (450 m, 3,7 % Steigung), 8 m breit.","feed":"126.4"}'::jsonb),
  ('giro-2026', 5, ((((now() at time zone 'Europe/Berlin')::date + 5)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Praia a Mare', 'Potenza', 203, 4100, '[{"name":"Prestieri","cat":"3","km":27,"len":13,"grad":5,"max":9,"alt":843},{"name":"Montagna Grande di Viggiano","cat":"2","km":154,"len":6.6,"grad":9.1,"max":15,"alt":1405}]'::jsonb, '[{"km":68.4,"name":"Francavilla in Sinni","kind":"sprint"},{"km":174.2,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-13","neutral_km":3,"route":"Sehr unruhige Etappe komplett im Hinterland zwischen Kalabrien und Basilikata. Gleich zu Beginn bergauf in den Pollino-Nationalpark zur Bergwertung Prestieri (über 12 km, aber moderat). Durch das Sinni-Tal meist bergab, mit Gegenanstiegen in den Orten. Nach Francavilla in Sinni ins Agri-Tal bis Viggiano und auf den härtesten Anstieg der ersten Woche: Montagna Grande di Viggiano (6,6 km, max. 15 %). Wellig weiter zum Skigebiet Pierfaone, dann Abfahrt nach Potenza.","finale":"Erst bergauf ins Zentrum von Potenza, dann bergab bis zur Flamme Rouge, wo es wieder steigt (etwa 2–5 %). Zielgerade 700 m, 7 m breit, leicht ansteigend.","feed":"174.2"}'::jsonb),
  ('giro-2026', 6, ((((now() at time zone 'Europe/Berlin')::date + 6)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Paestum', 'Neapel', 141, 500, '[{"name":"Cava de'' Tirreni","cat":"4","km":40.1,"len":7.1,"grad":2.7,"max":8,"alt":202}]'::jsonb, '[{"km":92,"name":"Brusciano","kind":"sprint"},{"km":117.2,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-14","neutral_km":5,"three_sec":true,"route":"Kurz und flach. Zuerst die tyrrhenische Küste entlang bis Salerno, dann hinauf nach Cava de'' Tirreni (einzige Bergwertung) und hinein in die Ebene am Vesuv. Ab Nola sind die letzten 70 km praktisch durchgehend Ortsgebiet mit Verkehrsinseln und Stadtmobiliar. Vor Neapel rund 20 km Schnellstraße, Finale auf breiten, asphaltierten Straßen.","finale":"Die letzten 3 km gerade am Hafen entlang. Linkskurve 650 m vor dem Ziel in einen leichten Anstieg (4 %) über die gepflasterte Via Acton, zwei Rechtskurven 400 m vor dem Ziel auf die 8 m breite, gepflasterte Zielgerade.","feed":"117.2"}'::jsonb),
  ('giro-2026', 7, ((((now() at time zone 'Europe/Berlin')::date + 7)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Formia', 'Blockhaus', 244, 4600, '[{"name":"Roccaraso","cat":"2","km":166.4,"len":6.9,"grad":6.5,"max":12,"alt":1245},{"name":"Blockhaus","cat":"1","km":244,"len":13.6,"grad":8.4,"max":14,"alt":1665}]'::jsonb, '[{"km":112.4,"name":"Venafro","kind":"sprint"},{"km":232.1,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-15","start_real":"10:55","finish_real":"ca. 17:15","route":"Königsetappe im Apennin und längste Etappe des Giro. Erst die Küste des südlichen Latium entlang über Sperlonga und Gaeta, zurück nach Formia und nach Norden. Ab Venafro auf schneller Straße nach Rionero Sannitico und Castel di Sangro. Bergwertung in Roccaraso, dann über den Passo San Leonardo und lange Abfahrt nach Roccamorice, wo der 13 km lange Schlussanstieg beginnt.","finale":"13 km stetig bergauf auf schmaler Straße mit vielen Kehren. Fast 10 km lang über 9 %, Spitzen bis 14 %. 500 m vor dem Ziel ein ganz kurzes Flachstück, Zielgerade 200 m bei etwa 8 %, 6 m breit.","feed":"36.6 - 70.6 - 103.1- 133.9 - 198.7"}'::jsonb),
  ('giro-2026', 8, ((((now() at time zone 'Europe/Berlin')::date + 8)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Chieti', 'Fermo', 156, 1900, '[{"name":"Montefiore dell''Aso","cat":"3","km":107.3,"len":10,"grad":3.6,"max":12,"alt":367},{"name":"Monterubbiano","cat":"4","km":119.2,"len":4.7,"grad":5.8,"max":12,"alt":379},{"name":"Capodarco","cat":"4","km":149,"len":2.5,"grad":6.3,"max":18,"alt":225},{"name":"Fermo","cat":"4","km":156,"len":3.5,"grad":6.2,"max":22,"alt":318}]'::jsonb, '[{"km":96.3,"name":"Cupra Marittima","kind":"sprint"},{"km":132,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-16","route":"Gemischte Etappe: erst flach und auf breiten, geraden Straßen an der Adria, dann ins Hinterland von Fermo mit ständigem Auf und Ab und mehreren steilen „Muri“, vor allem im Finale. Nach Cupra Marittima ins Landesinnere zu den Bergwertungen Montefiore dell''Aso und Monterubbiano. Erste Durchfahrt in Fermo mit der Mauer der Via Cardarelli, hinunter zur SS 16 und schnell hintereinander Capodarco (Bergwertung) und Fermo-Reputolo bis ins Ziel.","finale":"Steiles Finale. Nach dem Reputolo-Anstieg nach Fermo hinein (max. 22 %) auf schmalen Porphyr-Gassen mit harten Rampen. Kurze Abfahrt bis 750 m vor dem Ziel, dann wieder rund 10 % bis ins Ziel, 6 m breit.","feed":"132.0"}'::jsonb),
  ('giro-2026', 9, ((((now() at time zone 'Europe/Berlin')::date + 9)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Cervia', 'Corno alle Scale', 184, 2400, '[{"name":"Querciola","cat":"3","km":167.4,"len":11.5,"grad":4.3,"max":15,"alt":823},{"name":"Corno alle Scale","cat":"1","km":184,"len":10.8,"grad":6.1,"max":15,"alt":1471}]'::jsonb, '[{"km":125.2,"name":"Marzabotto","kind":"sprint"},{"km":172.6,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-17","start_real":"12:50","finish_real":"17:00–17:27","route":"Praktisch eine Ein-Berg-Etappe. Flach vom Start bis Silla, ab Sasso Marconi schon leicht ansteigend entlang der Porrettana. In Silla beginnt die erste Bergwertung, die mit dem Schlussanstieg fast eins ist – nur eine kurze Abfahrt trennt sie. Über die steilste Seite durch Gaggio Montano nach Querciola, kurz hinunter nach Villaggio Europa (Lizzano in Belvedere) und dann der Schlussanstieg.","finale":"12 km stetig bergauf auf schmaler, kurviger Bergstraße mit einigen Kehren. Die letzten 3 km über 10 %, Spitzen bis 15 %, danach etwas flacher. Zielgerade 150 m bei etwa 7 %, 7 m breit.","feed":"172.6"}'::jsonb),
  ('giro-2026', 10, ((((now() at time zone 'Europe/Berlin')::date + 10)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'itt', 'Viareggio', 'Massa', 42, 50, '[]'::jsonb, '[]'::jsonb, '{"original_date":"2026-05-19","route":"Flaches, fast schnurgerades Zeitfahren mit zwei Wendepunkten. Von Viareggio Richtung Süden durch den Pinienwald über den Viale dei Tigli, Wende in Marina di Torre del Lago und auf demselben Weg zurück. Dann die Uferpromenade Richtung Norden entlang der Versilia-Küste bis Marina di Massa, landeinwärts zur zweiten Wende in Rinchiostra, noch rund 800 m Promenade und landeinwärts ins Ziel.","finale":"Nur zwei Kurven im Finale: rechts auf die Uferpromenade 1 km vor dem Ziel und ein letzter kleiner Anstieg 150 m vor dem Ziel auf die 8 m breite Zielgerade."}'::jsonb),
  ('giro-2026', 11, ((((now() at time zone 'Europe/Berlin')::date + 11)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Porcari', 'Chiavari', 195, 2850, '[{"name":"Passo del Termine","cat":"3","km":115.9,"len":7.4,"grad":5,"max":10,"alt":548},{"name":"Colle di Guaitarola","cat":"2","km":135.7,"len":9.9,"grad":6.2,"max":11,"alt":619},{"name":"Colla dei Scioli","cat":"3","km":167.1,"len":5.7,"grad":6.4,"max":15,"alt":406}]'::jsonb, '[{"km":68,"name":"Luni","kind":"sprint"},{"km":182.4,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-20","neutral_km":3,"route":"Sehr unruhig, vor allem in der zweiten Hälfte. Erst fast flach, aber verwinkelt zwischen Lucca und Camaiore, dann lange auf der Via Aurelia (SS 1). Vor La Spezia ein kurzer Anstieg, danach durch die Cinque Terre über Passo del Termine und Colle di Guaitarola. Nach Sestri Levante zwei kurze, steile Rampen (Colla dei Scioli und Cogorno) ins Finale nach Chiavari.","finale":"Auf den letzten 5 km ein kurzer Anstieg und eine kurze Abfahrt, technische Passagen in die Stadt. Der letzte Kilometer gerade und völlig flach, Zielgerade 400 m, 8 m breit.","feed":"182.4"}'::jsonb),
  ('giro-2026', 12, ((((now() at time zone 'Europe/Berlin')::date + 12)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Imperia', 'Novi Ligure', 175, 2250, '[{"name":"Colle Giovo","cat":"3","km":107.5,"len":11.5,"grad":4.2,"max":10,"alt":514},{"name":"Bric Berton","cat":"3","km":123,"len":5.5,"grad":6,"max":10,"alt":761}]'::jsonb, '[{"km":100.7,"name":"Stella","kind":"sprint"},{"km":161.6,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-21","neutral_km":5,"three_sec":true,"route":"Erst durchs Hinterland von Imperia bis Pieve di Teco, dann von Albenga bis Savona auf der Via Aurelia – in Gegenrichtung zu Mailand–Sanremo, mit einigen „Capi“ und Ortsdurchfahrten. Hinter Savona Colle Giovo und Bric Berton, hinunter in die Po-Ebene und leicht wellig nach Novi Ligure. Im Finale erst schmale, dann breite und gerade Straßen.","finale":"Die letzten 3 km fast gerade mit Kreisverkehren ohne große Umwege. Letzte Kurve 3.000 m vor dem Ziel – die Zielgerade ist 2.800 m lang, 7,5 m breit.","feed":"161.6"}'::jsonb),
  ('giro-2026', 13, ((((now() at time zone 'Europe/Berlin')::date + 13)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Alessandria', 'Verbania', 189, 1400, '[{"name":"Bieno","cat":"4","km":167.7,"len":2.4,"grad":5.5,"max":9,"alt":333},{"name":"Ungiasca","cat":"3","km":175.7,"len":4.7,"grad":7.1,"max":13,"alt":581}]'::jsonb, '[{"km":155.7,"name":"Stresa","kind":"sprint"},{"km":172.3,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-22","neutral_km":3,"route":"160 km flach, dann plötzlich 30 km, in denen alle Höhenmeter stecken. Von Alessandria durch die Po-Ebene nach Norden zum Lago Maggiore, meist auf breiten, geraden Straßen durch Städte wie Casale Monferrato und Vercelli. Nach dem Westufer des Sees zwei kurze Anstiege: erst Bieno (moderat), dann Ungiasca mit einigen Kilometern über 10 %. Abfahrt nach Verbania ins Ziel.","finale":"Die letzten 3 km am See: erst breit und fast gerade, dann kurviger entlang des Ufers und etwas schmaler. Zielgerade 300 m, 7 m breit.","feed":"172.3"}'::jsonb),
  ('giro-2026', 14, ((((now() at time zone 'Europe/Berlin')::date + 14)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Aosta', 'Pila', 133, 4350, '[{"name":"Saint-Barthélemy","cat":"1","km":18.1,"len":15.8,"grad":6.1,"max":13,"alt":1619},{"name":"Doues","cat":"3","km":61.8,"len":5.8,"grad":6.2,"max":13,"alt":1173},{"name":"Lin Noir","cat":"1","km":82.3,"len":7.4,"grad":7.9,"max":12,"alt":1284},{"name":"Verrogne","cat":"2","km":92.1,"len":5.6,"grad":6.9,"max":12,"alt":1587},{"name":"Pila","cat":"1","km":133,"len":16.5,"grad":7.1,"max":11,"alt":1793}]'::jsonb, '[{"km":53.9,"name":"Roisan","kind":"sprint"},{"km":116,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-23","start_real":"13:05","finish_real":"16:58–17:34","route":"Alpine Königsetappe als ununterbrochene Folge von Anstiegen und Abfahrten, kaum Luft zum Atmen. Direkt nach dem Start der lange Anstieg nach Saint-Barthélemy, dann eine breite, schnelle Abfahrt von fast 20 km. Kurz Richtung Aosta und hinauf ins Valpelline nach Doues, der leichteste Anstieg des Tages. Wieder bei Aosta folgen Lin Noir und Verrogne, nur durch eine kurze Abfahrt getrennt, und nach der Abfahrt ins Tal der Schlussanstieg nach Pila (von Gressan).","finale":"Die letzten Kilometer durchgehend bergauf mit etwa 9 %, Spitzen um 11 % bei 3 km vor dem Ziel. Zielgerade 100 m, 7 m breit, ansteigend.","feed":"116.0"}'::jsonb),
  ('giro-2026', 15, ((((now() at time zone 'Europe/Berlin')::date + 15)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Voghera', 'Mailand', 157, 200, '[]'::jsonb, '[{"km":49.6,"name":"Pavia","kind":"sprint"},{"km":114.8,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-24","neutral_km":5,"three_sec":true,"route":"Komplett flach. Von Voghera auf breiten, geraden Straßen nach Pavia, dann auf der historischen Strecke von Mailand–Sanremo nach Mailand. Hinter der Chiesa Rossa beginnt der 16,3 km lange Schlussrundkurs, viermal zu fahren.","finale":"Der 16,3 km lange Rundkurs ist völlig flach, breite Alleen mit wenigen Kurven, die letzte etwa 2 km vor dem Ziel. Zielgerade flach, 8 m breit.","feed":"114.8"}'::jsonb),
  ('giro-2026', 16, ((((now() at time zone 'Europe/Berlin')::date + 16)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Bellinzona', 'Carì', 113, 3000, '[{"name":"Torre","cat":"3","km":32.2,"len":4.7,"grad":5.5,"max":10,"alt":770},{"name":"Leontica","cat":"2","km":43.5,"len":3,"grad":8.5,"max":14,"alt":874},{"name":"Torre","cat":"3","km":54.2,"len":4.7,"grad":5.5,"max":10,"alt":770},{"name":"Leontica","cat":"2","km":65.5,"len":3,"grad":8.5,"max":14,"alt":874},{"name":"Carì","cat":"1","km":113,"len":11.7,"grad":7.9,"max":13,"alt":1644}]'::jsonb, '[{"km":74.7,"name":"Ludiano","kind":"sprint"},{"km":100.6,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-26","start_real":"14:00","finish_real":"17:01–17:28","route":"Sehr kurze Bergetappe, komplett in der Schweiz. Nach leicht ansteigendem Beginn ein 22 km langer Rundkurs, zweimal zu fahren, mit zwei Anstiegen hintereinander – der zweite, Leontica, ist der schwere. Danach ins Gotthard-Tal, stetig bergauf bis Faido, wo der 12 km lange Schlussanstieg beginnt.","finale":"12 km komplett bergauf, nur ein kurzes Flachstück in Campello. Die letzten 3 km um 8 %, auf dem letzten Kilometer bis 13 %. Zielgerade 100 m, 7 m breit.","feed":"100.6"}'::jsonb),
  ('giro-2026', 17, ((((now() at time zone 'Europe/Berlin')::date + 17)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'hilly', 'Cassano d''Adda', 'Andalo', 202, 3300, '[{"name":"Passo dei Tre Termini","cat":"3","km":63.9,"len":8.2,"grad":5.9,"max":10,"alt":681},{"name":"Cocca di Lodrino","cat":"3","km":88.1,"len":8.2,"grad":4,"max":10,"alt":735},{"name":"Andalo","cat":"3","km":191.3,"len":8.3,"grad":3.9,"max":9,"alt":1136}]'::jsonb, '[{"km":143.8,"name":"Roncone","kind":"sprint"},{"km":186.6,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-27","route":"Bewegte Etappe ohne wirklich schwere Anstiege. Flach zum Iseosee, danach Passo dei Tre Termini und Cocca di Lodrino, dann stetig leicht bergauf ins Chiese-Tal. Ab Tione di Trento verwinkelter und schmaler bis San Lorenzo Dorsino; dort beginnt der Anstieg über Molveno nach Andalo und ins Finale.","finale":"Die letzten 11 km in zwei Teilen: erst eine schnelle Abfahrt auf breiten Straßen nach der Bergwertung Andalo-Lever, dann ein leichter, immer steilerer Anstieg (6 km) bis 1,5 km vor dem Ziel. Leicht fallend auf die flache Zielgerade (700 m, 8 m breit).","feed":"186.6"}'::jsonb),
  ('giro-2026', 18, ((((now() at time zone 'Europe/Berlin')::date + 18)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Fai della Paganella', 'Pieve di Soligo', 171, 2050, '[{"name":"Fastro","cat":"3","km":87.7,"len":3.2,"grad":4.1,"max":9,"alt":350},{"name":"Muro di Ca'' del Poggio","cat":"4","km":161.7,"len":1.1,"grad":12.3,"max":19,"alt":242}]'::jsonb, '[{"km":135.4,"name":"Guia","kind":"sprint"},{"km":154.3,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-28","neutral_km":3,"route":"Wellig von Anfang bis Ende. Über den Anstieg von Civezzano vom Etsch- ins Brentatal, dann wellig, aber meist bergab bis Primolano. Kurzer Anstieg der Scale di Primolano ins Piave-Tal, nach Valdobbiadene die kurzen Anstiege von Combai, Tarzo und Ca'' del Poggio (9 km vor dem Ziel) bis Pieve di Soligo.","finale":"Leicht abfallende Schlusskilometer, zwei Kurven auf dem letzten Kilometer, die letzte führt auf die Zielgerade (300 m, 7 m breit, leicht ansteigend).","feed":"154.3"}'::jsonb),
  ('giro-2026', 19, ((((now() at time zone 'Europe/Berlin')::date + 19)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Feltre', 'Alleghe (Piani di Pezzè)', 151, 5000, '[{"name":"Passo Duran","cat":"1","km":58.7,"len":12.1,"grad":8.2,"max":14,"alt":1601},{"name":"Coi","cat":"2","km":72.9,"len":5.8,"grad":9.7,"max":19,"alt":1501},{"name":"Forcella Staulanza","cat":"2","km":82,"len":6.3,"grad":6.7,"max":10,"alt":1766},{"name":"Passo Giau","cat":"CC","km":101.6,"len":9.9,"grad":9.3,"max":14,"alt":2236},{"name":"Passo Falzarego","cat":"2","km":122.2,"len":10.1,"grad":5.6,"max":10,"alt":2105},{"name":"Piani di Pezzè","cat":"2","km":151,"len":5,"grad":9.6,"max":15,"alt":1465}]'::jsonb, '[{"km":78.2,"name":"Palafavera","kind":"sprint"},{"km":118.6,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-29","start_real":"12:45","finish_real":"16:54–17:32","route":"Dolomiten-Königsetappe nur aus Anstiegen und Abfahrten. Nach kurzer Anfahrt stecken in den letzten 100 km rund 5.000 Höhenmeter. Ohne Pause hintereinander: Passo Duran (max. 14 %), Coi (max. 19 %), Forcella Staulanza (max. 10 %), Passo Giau (Cima Coppi, max. 14 %), Passo Falzarego (max. 10 %) und zum Schluss 5 km hinauf zu den Piani di Pezzè.","finale":"Die letzten 5 km konstant um 10 %, in der Mitte bis 15 %. Schmale, kurvige Straße mit 8 Kehren. Der letzte Kilometer hat 11 %, Zielgerade 300 m, 7 m breit.","feed":"118.6"}'::jsonb),
  ('giro-2026', 20, ((((now() at time zone 'Europe/Berlin')::date + 20)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'mountain', 'Gemona del Friuli', 'Piancavallo', 200, 3750, '[{"name":"Clauzetto","cat":"3","km":85.8,"len":6.9,"grad":5.7,"max":9,"alt":558},{"name":"Piancavallo","cat":"1","km":147.3,"len":14.5,"grad":7.8,"max":14,"alt":1290},{"name":"Piancavallo","cat":"1","km":200,"len":14.5,"grad":7.8,"max":14,"alt":1290}]'::jsonb, '[{"km":73.6,"name":"Forgaria nel Friuli","kind":"sprint"},{"km":176.3,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-30","start_real":"11:00","finish_real":"15:55–16:18","route":"Erst wellig durch die Tagliamento-Ebene um Gemona. Nach dem kurzen Anstieg von Forgaria nel Friuli und der Bergwertung Clauzetto ins Val Cosa nach Maniago. In Montereale Valcellina beginnt der etwa 53 km lange Schlussrundkurs mit zwei Auffahrten zum Piancavallo. Nach der ersten Überquerung eine anspruchsvolle Abfahrt zum Lago di Barcis und ein über 4 km langer, gut beleuchteter Tunnel leicht bergab, dann flach bis Aviano, wo der Schlussanstieg beginnt.","finale":"Die letzten 15 km komplett bergauf. Die ersten 10 km sehr steil, um 9 % und bis 14 %. Nach 10,9 km wird es flach, sogar kurz abfallend, dann wieder moderater bergauf (max. 8 %) durch eine Lawinengalerie. Der letzte Kilometer verwinkelt und leicht steigend; die Zielgerade (100 m) liegt in einer weiten Kehre, 7,5 m breit, 1,5 %.","feed":"176.3"}'::jsonb),
  ('giro-2026', 21, ((((now() at time zone 'Europe/Berlin')::date + 21)::timestamp + time '12:00') at time zone 'Europe/Berlin'), 'flat', 'Rom', 'Rom', 131, 500, '[]'::jsonb, '[{"km":23.1,"name":"Fontana dello Zodiaco","kind":"sprint"},{"km":77.7,"name":"Red Bull KM","kind":"redbull"}]'::jsonb, '{"original_date":"2026-05-31","neutral_km":5,"three_sec":true,"route":"Schlussetappe in zwei Teilen: Vom Start in Rom-EUR bis zur ersten Zieldurchfahrt geht es an die Küste nach Ostia und zurück, dann acht Runden auf einem 9,5 km langen Stadtkurs. Kurze Wellen wechseln mit langen Geraden, verbunden durch teils knifflige Kurven; meist Asphalt, mit kurzen Stücken auf „Sanpietrini“-Pflaster.","finale":"Nur wenige sanfte Kurven im Finale. Zielgerade 350 m, 8 m breit; in der Mitte des letzten Kilometers 5 % Steigung.","feed":"77.7"}'::jsonb);

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

-- Höhenprofile aus den Durchfahrtstabellen des Roadbooks
insert into public.stage_profiles (stage_id, points, waypoints, source)
select s.id, x.points, x.waypoints, 'Roadbook Giro d''Italia 2026' from (values
  (1, '[[0,3],[2.7,3],[7.8,34],[11.5,9],[19.2,15],[23.3,8],[27.7,45],[32.3,7],[38.8,24],[42.2,6],[50.2,8],[56.8,22],[65.3,47],[70.9,7],[78.9,12],[84.3,42],[90,24],[93,7],[101,12],[106.4,42],[112,24],[114.7,15],[115,7],[120.5,45],[129,22],[135.4,10],[143.4,6],[147,26]]'::jsonb, '[{"km":0,"alt":3,"name":"NESSEBAR"},{"km":2.7,"alt":3,"name":"Ins. Rd. 9"},{"km":7.8,"alt":34,"name":"Ravda Exit"},{"km":11.5,"alt":9,"name":"Aheloy Exit"},{"km":19.2,"alt":15,"name":"Pomorie Exit"},{"km":23.3,"alt":8,"name":"Pomorie Exit West"},{"km":27.7,"alt":45,"name":"Burgas Airport"},{"km":32.3,"alt":7,"name":"Burgas Centre Exit"},{"km":38.8,"alt":24,"name":"Burgas"},{"km":42.2,"alt":6,"name":"Ins. Rd. 9"},{"km":50.2,"alt":8,"name":"Malko Tarnovo Exit"},{"km":56.8,"alt":22,"name":"Rosen Exit"},{"km":65.3,"alt":47,"name":"Chernomorets Exit"},{"km":70.9,"alt":7,"name":"Circuit Entrance"},{"km":78.9,"alt":12,"name":"Saint Thomas exit"},{"km":84.3,"alt":42,"name":"Cape Agalina"},{"km":90,"alt":24,"name":"Sozopol"},{"km":93,"alt":7,"name":"Circuit Entrance"},{"km":101,"alt":12,"name":"Saint Thomas Exit"},{"km":106.4,"alt":42,"name":"Cape Agalina"},{"km":112,"alt":24,"name":"Sozopol"},{"km":114.7,"alt":15,"name":"Red Bull km"},{"km":115,"alt":7,"name":"Circuit Exit"},{"km":120.5,"alt":45,"name":"Chernomorets Exit"},{"km":129,"alt":22,"name":"Rosen Exit"},{"km":135.4,"alt":10,"name":"Malko Tarnovo Exit"},{"km":143.4,"alt":6,"name":"Burgas Exit"},{"km":147,"alt":26,"name":"BURGAS"}]'::jsonb),
  (2, '[[0,52],[4.3,23],[14.4,104],[21.9,87],[45.6,206],[67.9,161],[74,167],[77.2,182],[89,178],[91.8,175],[100.4,253],[108.6,355],[116.3,712],[120.8,478],[134.1,920],[150.6,405],[158.6,430],[168.2,302],[174.7,268],[191.9,112],[198.3,191],[205.5,201],[206.8,190],[210.6,452],[212.5,341],[215.6,235],[218.9,134],[221,197]]'::jsonb, '[{"km":0,"alt":52,"name":"BURGAS"},{"km":4.3,"alt":23,"name":"A1 Interchange"},{"km":14.4,"alt":104,"name":"Sadievo Exit"},{"km":21.9,"alt":87,"name":"Ajtos"},{"km":45.6,"alt":206,"name":"Karnobat"},{"km":67.9,"alt":161,"name":"Lozenets"},{"km":74,"alt":167,"name":"Gorno Alexandrovo"},{"km":77.2,"alt":182,"name":"Trapoklovo"},{"km":89,"alt":178,"name":"Kaloyanovo"},{"km":91.8,"alt":175,"name":"Exit to Sliven"},{"km":100.4,"alt":253,"name":"Sliven"},{"km":108.6,"alt":355,"name":"Asenovska Bridge"},{"km":116.3,"alt":712,"name":"Byala Pass"},{"km":120.8,"alt":478,"name":"Byala"},{"km":134.1,"alt":920,"name":"Vratnik Pass"},{"km":150.6,"alt":405,"name":"Maysko"},{"km":158.6,"alt":430,"name":"Konstantin"},{"km":168.2,"alt":302,"name":"Maryan"},{"km":174.7,"alt":268,"name":"Milkovtsi"},{"km":191.9,"alt":112,"name":"Mindya"},{"km":198.3,"alt":191,"name":"Merdanya"},{"km":205.5,"alt":201,"name":"Red Bull km"},{"km":206.8,"alt":190,"name":"Lyaskovets"},{"km":210.6,"alt":452,"name":"Lyaskovets Monastery Pass"},{"km":212.5,"alt":341,"name":"Sheremetya"},{"km":215.6,"alt":235,"name":"Exit to Sveta Gora"},{"km":218.9,"alt":134,"name":"Tsarevets"},{"km":221,"alt":197,"name":"VELIKO TARNOVO"}]'::jsonb),
  (3, '[[0,166],[12.8,184],[23.8,294],[31.3,211],[38.8,220],[48.6,245],[58.6,321],[62.6,362],[77.5,505],[85.8,635],[94,842],[103.2,1334],[105.4,1350],[115.4,943],[130.8,824],[145.1,719],[161,608],[162,620],[167,573],[175,555]]'::jsonb, '[{"km":0,"alt":166,"name":"PLOVDIV"},{"km":12.8,"alt":184,"name":"Stamboliyski Exit"},{"km":23.8,"alt":294,"name":"Malo Konare Exit"},{"km":31.3,"alt":211,"name":"Pazardzik"},{"km":38.8,"alt":220,"name":"Zvanichevo"},{"km":48.6,"alt":245,"name":"Semptemvri Exit"},{"km":58.6,"alt":321,"name":"Belovo"},{"km":62.6,"alt":362,"name":"Momina Klisura"},{"km":77.5,"alt":505,"name":"Kostenets"},{"km":85.8,"alt":635,"name":"Dolna Banja"},{"km":94,"alt":842,"name":"Raduil"},{"km":103.2,"alt":1334,"name":"Borovets Pass"},{"km":105.4,"alt":1350,"name":"Borovets"},{"km":115.4,"alt":943,"name":"Samokov"},{"km":130.8,"alt":824,"name":"Lago di Iskar"},{"km":145.1,"alt":719,"name":"Dolni Pasarel"},{"km":161,"alt":608,"name":"Pancharevo"},{"km":162,"alt":620,"name":"Red Bull km"},{"km":167,"alt":573,"name":"Ins. Bul. Taarigradsko shose"},{"km":175,"alt":555,"name":"SOFIA"}]'::jsonb),
  (4, '[[0,82],[5.5,258],[14.6,72],[32.9,6],[41.2,4],[47.2,4],[53.8,13],[56.7,27],[61.3,6],[65.7,15],[73.8,27],[74.1,22],[80.5,67],[95,921],[98.2,942],[104.2,554],[110.3,480],[118.8,168],[122,162],[124,138],[126.4,144],[130.4,174],[135.2,207],[136.8,222],[138,248]]'::jsonb, '[{"km":0,"alt":82,"name":"CATANZARO"},{"km":5.5,"alt":258,"name":"Marcellinara"},{"km":14.6,"alt":72,"name":"Z.I. Pianopoli"},{"km":32.9,"alt":6,"name":"Gizzeria Lido"},{"km":41.2,"alt":4,"name":"Falerna Marina"},{"km":47.2,"alt":4,"name":"Nocera Terinese"},{"km":53.8,"alt":13,"name":"Campora San Giovanni"},{"km":56.7,"alt":27,"name":"galleria"},{"km":61.3,"alt":6,"name":"Amantea"},{"km":65.7,"alt":15,"name":"n.4 gallerie"},{"km":73.8,"alt":27,"name":"Fiumefreddo Marina"},{"km":74.1,"alt":22,"name":"galleria"},{"km":80.5,"alt":67,"name":"San Lucido"},{"km":95,"alt":921,"name":"Cozzo Tunno"},{"km":98.2,"alt":942,"name":"La Crocetta"},{"km":104.2,"alt":554,"name":"San Fili"},{"km":110.3,"alt":480,"name":"San Vincenzo la Costa"},{"km":118.8,"alt":168,"name":"Ins. sp.241"},{"km":122,"alt":162,"name":"Petrozza"},{"km":124,"alt":138,"name":"Bv. di Rose"},{"km":126.4,"alt":144,"name":"Red Bull km"},{"km":130.4,"alt":174,"name":"Bv. di Castiglione Cosentino"},{"km":135.2,"alt":207,"name":"Svinc. ss.107"},{"km":136.8,"alt":222,"name":"Ponte S. Francesco di Paola"},{"km":138,"alt":248,"name":"COSENZA"}]'::jsonb),
  (5, '[[0,15],[0.1,29],[6.1,93],[12.5,195],[12.6,185],[13.1,190],[16,359],[20.7,676],[27,843],[34.2,673],[47,697],[54,499],[65,345],[68.4,422],[70.8,317],[79.3,265],[81.4,284],[100.2,235],[120.5,378],[122.5,410],[127,530],[130.1,565],[135.7,575],[144.9,949],[154,1405],[157.1,1307],[162.8,1148],[174.2,1356],[177.7,1370],[181.7,1255],[189.3,899],[196,673],[198.6,778],[203,709]]'::jsonb, '[{"km":0,"alt":15,"name":"PRAIA A MARE"},{"km":0.1,"alt":29,"name":"Castrocucco"},{"km":6.1,"alt":93,"name":"galleria"},{"km":12.5,"alt":195,"name":"galleria"},{"km":12.6,"alt":185,"name":"Bv. per Lauria"},{"km":13.1,"alt":190,"name":"n.4 gallerie"},{"km":16,"alt":359,"name":"Lauria"},{"km":20.7,"alt":676,"name":"Ins. ss.19"},{"km":27,"alt":843,"name":"Prestieri"},{"km":34.2,"alt":673,"name":"Castelluccio Superiore"},{"km":47,"alt":697,"name":"Agromonte MIleo"},{"km":54,"alt":499,"name":"Ins. ss.653 Sinnica"},{"km":65,"alt":345,"name":"Svinc. di Francavilla in Sinni"},{"km":68.4,"alt":422,"name":"Francavilla in Sinni"},{"km":70.8,"alt":317,"name":"Ins. ss.653 Sinnica"},{"km":79.3,"alt":265,"name":"Svinc. di Noepoli"},{"km":81.4,"alt":284,"name":"Svinc. di Senise Centro"},{"km":100.2,"alt":235,"name":"Ins. ss.598 Fondovalle d''Agri"},{"km":120.5,"alt":378,"name":"Bv. di San Martino d''Agri"},{"km":122.5,"alt":410,"name":"n.2 gallerie"},{"km":127,"alt":530,"name":"Diga del Pertusillo"},{"km":130.1,"alt":565,"name":"galleria"},{"km":135.7,"alt":575,"name":"Svinc. per Viggiano"},{"km":144.9,"alt":949,"name":"Viggiano"},{"km":154,"alt":1405,"name":"Montagna Grande di Viggiano"},{"km":157.1,"alt":1307,"name":"Bv. di Calvello"},{"km":162.8,"alt":1148,"name":"Bv. per Pierfaone"},{"km":174.2,"alt":1356,"name":"Red Bull km"},{"km":177.7,"alt":1370,"name":"Pierfaone"},{"km":181.7,"alt":1255,"name":"La Sellata"},{"km":189.3,"alt":899,"name":"Pignola"},{"km":196,"alt":673,"name":"viale del Basento"},{"km":198.6,"alt":778,"name":"Potenza (centro)"},{"km":203,"alt":709,"name":"POTENZA"}]'::jsonb),
  (6, '[[0,6],[4.2,2],[16.1,3],[23.7,3],[32.2,12],[36.1,90],[40.1,202],[47.4,36],[57,26],[67,50],[72.4,46],[73.3,39],[78.1,80],[81.7,45],[82.9,40],[92,33],[95.6,30],[98.3,30],[104.4,31],[105.8,30],[107.9,27],[110.2,36],[111.8,40],[114.5,44],[117.2,71],[118.2,76],[118.8,85],[122.3,52],[127.6,55],[134,10],[136.7,4],[141,20]]'::jsonb, '[{"km":0,"alt":6,"name":"PAESTUM"},{"km":4.2,"alt":2,"name":"Foce del Sele"},{"km":16.1,"alt":3,"name":"Lido di Spineta"},{"km":23.7,"alt":3,"name":"Torre Picentina"},{"km":32.2,"alt":12,"name":"Salerno"},{"km":36.1,"alt":90,"name":"Vietri sul Mare"},{"km":40.1,"alt":202,"name":"Cava de'' Tirreni"},{"km":47.4,"alt":36,"name":"Nocera Inferiore"},{"km":57,"alt":26,"name":"Sarno"},{"km":67,"alt":50,"name":"Palma Campania"},{"km":72.4,"alt":46,"name":"San Paolo Belsito"},{"km":73.3,"alt":39,"name":"Nola"},{"km":78.1,"alt":80,"name":"Comiziano"},{"km":81.7,"alt":45,"name":"P.L."},{"km":82.9,"alt":40,"name":"Cimitile"},{"km":92,"alt":33,"name":"Brusciano"},{"km":95.6,"alt":30,"name":"Pomigliano d''Arco"},{"km":98.3,"alt":30,"name":"Acerra"},{"km":104.4,"alt":31,"name":"Svinc. Afragola-Cardito"},{"km":105.8,"alt":30,"name":"Cardito"},{"km":107.9,"alt":27,"name":"Caivano"},{"km":110.2,"alt":36,"name":"Frattaminore"},{"km":111.8,"alt":40,"name":"Frattamaggiore"},{"km":114.5,"alt":44,"name":"Afragola"},{"km":117.2,"alt":71,"name":"Red Bull km"},{"km":118.2,"alt":76,"name":"Casoria"},{"km":118.8,"alt":85,"name":"Svinc. per Tangenziale/Napoli"},{"km":122.3,"alt":52,"name":"Svinc. con A1"},{"km":127.6,"alt":55,"name":"Svinc. per Napoli Centro"},{"km":134,"alt":10,"name":"Svinc. per Centro Direzionale"},{"km":136.7,"alt":4,"name":"via Reggia di Portici"},{"km":141,"alt":20,"name":"NAPOLI"}]'::jsonb),
  (7, '[[0,15],[4.1,170],[16.5,11],[25.6,12],[28.3,12],[31.2,50],[44.5,11],[51.2,4],[57.9,17],[63.1,55],[71.6,145],[78.6,46],[86,32],[93.4,62],[97.7,82],[100.5,78],[105.1,283],[112.4,174],[119.9,225],[133.1,331],[137.4,499],[139.2,594],[147.3,1005],[150.3,965],[153.5,820],[157.4,797],[163.5,1124],[166.4,1245],[169.1,1226],[174.8,1258],[177,1260],[180.3,1389],[189.9,1064],[200.8,1282],[211.1,859],[214.7,661],[217.2,541],[220.7,574],[226.7,520],[230.5,524],[232.1,630],[234.8,834],[244,1665]]'::jsonb, '[{"km":0,"alt":15,"name":"FORMIA"},{"km":4.1,"alt":170,"name":"Itri"},{"km":16.5,"alt":11,"name":"Fondi"},{"km":25.6,"alt":12,"name":"Lago San Puoto"},{"km":28.3,"alt":12,"name":"Sperlonga"},{"km":31.2,"alt":50,"name":"n.4 gallerie"},{"km":44.5,"alt":11,"name":"Gaeta"},{"km":51.2,"alt":4,"name":"Formia"},{"km":57.9,"alt":17,"name":"Svinc. ss.630 x ss.7"},{"km":63.1,"alt":55,"name":"Svinc. di Minturno Nord"},{"km":71.6,"alt":145,"name":"Svinc. di Ausonia"},{"km":78.6,"alt":46,"name":"Svinc. per San Giorgio a Liri"},{"km":86,"alt":32,"name":"Sant''Apollinare"},{"km":93.4,"alt":62,"name":"Marsella"},{"km":97.7,"alt":82,"name":"Taverna di San Vittore"},{"km":100.5,"alt":78,"name":"San Pietro Infine"},{"km":105.1,"alt":283,"name":"galleria"},{"km":112.4,"alt":174,"name":"Venafro"},{"km":119.9,"alt":225,"name":"Svinc. per Roccaraso"},{"km":133.1,"alt":331,"name":"Colli al Volturno"},{"km":137.4,"alt":499,"name":"Svinc. di Alfedena"},{"km":139.2,"alt":594,"name":"galleria"},{"km":147.3,"alt":1005,"name":"Svinc. di Rionero Sannitico"},{"km":150.3,"alt":965,"name":"Svinc. per Castel di Sangro"},{"km":153.5,"alt":820,"name":"Ponte Zittola"},{"km":157.4,"alt":797,"name":"Castel di Sangro"},{"km":163.5,"alt":1124,"name":"Ins. ss.17"},{"km":166.4,"alt":1245,"name":"Roccaraso"},{"km":169.1,"alt":1226,"name":"Rivisondoli"},{"km":174.8,"alt":1258,"name":"P.L."},{"km":177,"alt":1260,"name":"Stazione di Palena"},{"km":180.3,"alt":1389,"name":"Serra Malvone"},{"km":189.9,"alt":1064,"name":"Campo di Giove"},{"km":200.8,"alt":1282,"name":"Passo San Leonardo"},{"km":211.1,"alt":859,"name":"Sant''Eufemia a Maiella"},{"km":214.7,"alt":661,"name":"n.3 gallerie"},{"km":217.2,"alt":541,"name":"Svinc. di Caramanico Terme"},{"km":220.7,"alt":574,"name":"Bv. di Salle"},{"km":226.7,"alt":520,"name":"Bv. per Roccamorice"},{"km":230.5,"alt":524,"name":"Roccamorice"},{"km":232.1,"alt":630,"name":"Red Bull km"},{"km":234.8,"alt":834,"name":"Bv. di Santo Spirito"},{"km":244,"alt":1665,"name":"BLOCKHAUS"}]'::jsonb),
  (8, '[[0,20],[3.4,152],[9.6,212],[15.2,127],[24.5,122],[31.5,5],[35.1,4],[43.9,6],[51.5,2],[60.8,11],[68.7,4],[79.1,6],[86.5,5],[91.3,10],[96.3,8],[103.3,255],[107.3,367],[114.4,105],[119.2,379],[126.2,39],[129.4,203],[132,203],[139.4,24],[141.8,3],[145,2],[149,225],[153.1,230],[156,318]]'::jsonb, '[{"km":0,"alt":20,"name":"CHIETI"},{"km":3.4,"alt":152,"name":"Cepagatti"},{"km":9.6,"alt":212,"name":"Pianella"},{"km":15.2,"alt":127,"name":"Pianella Stazione"},{"km":24.5,"alt":122,"name":"Cappelle sul Tavo"},{"km":31.5,"alt":5,"name":"Montesilvano"},{"km":35.1,"alt":4,"name":"Silvi Marina"},{"km":43.9,"alt":6,"name":"Pineto"},{"km":51.5,"alt":2,"name":"Roseto degli Abruzzi"},{"km":60.8,"alt":11,"name":"Giulianova"},{"km":68.7,"alt":4,"name":"Tortoreto Lido"},{"km":79.1,"alt":6,"name":"Martinsicuro"},{"km":86.5,"alt":5,"name":"San Benedetto del Tronto"},{"km":91.3,"alt":10,"name":"Grottammare"},{"km":96.3,"alt":8,"name":"Cupra Marittima"},{"km":103.3,"alt":255,"name":"Massignano"},{"km":107.3,"alt":367,"name":"Montefiore dell''Aso"},{"km":114.4,"alt":105,"name":"Rubbianello"},{"km":119.2,"alt":379,"name":"Monterubbiano"},{"km":126.2,"alt":39,"name":"Ponte d''Ete"},{"km":129.4,"alt":203,"name":"Fermo (Rione Murato)"},{"km":132,"alt":203,"name":"Red Bull km"},{"km":139.4,"alt":24,"name":"San Marco"},{"km":141.8,"alt":3,"name":"Ins. ss.16"},{"km":145,"alt":2,"name":"Bv. per Capodarco"},{"km":149,"alt":225,"name":"Capodarco"},{"km":153.1,"alt":230,"name":"Muro di Via Reputolo"},{"km":156,"alt":318,"name":"FERMO"}]'::jsonb),
  (9, '[[0,1],[3.8,9],[8.2,8],[14.8,10],[22.8,10],[31.1,14],[38.4,19],[44.1,19],[44.6,19],[49,26],[54.3,22],[55.7,22],[69.4,33],[75.5,43],[84.1,45],[92,51],[96.2,61],[97.3,67],[102.2,105],[107.1,139],[110.7,314],[116.2,108],[116.9,125],[125.2,133],[130.7,163],[137.7,201],[142,230],[144.5,243],[146.3,251],[150.8,303],[155.9,329],[161.3,595],[167.4,823],[171.2,716],[172.6,812],[172.9,814],[181.2,1198],[184,1471]]'::jsonb, '[{"km":0,"alt":1,"name":"CERVIA"},{"km":3.8,"alt":9,"name":"Castiglione di Ravenna"},{"km":8.2,"alt":8,"name":"San Zaccaria"},{"km":14.8,"alt":10,"name":"San Pietro in Vincoli"},{"km":22.8,"alt":10,"name":"San Pietro in Trento"},{"km":31.1,"alt":14,"name":"Bv. di Russi"},{"km":38.4,"alt":19,"name":"Cotignola"},{"km":44.1,"alt":19,"name":"Barbiano"},{"km":44.6,"alt":19,"name":"P.L."},{"km":49,"alt":26,"name":"Solarolo"},{"km":54.3,"alt":22,"name":"Bagnara di Romagna"},{"km":55.7,"alt":22,"name":"Mordano"},{"km":69.4,"alt":33,"name":"Castel Guelfo di Bologna"},{"km":75.5,"alt":43,"name":"Poggio Piccolo"},{"km":84.1,"alt":45,"name":"Ponte Rizzoli"},{"km":92,"alt":51,"name":"Loc. Caselle"},{"km":96.2,"alt":61,"name":"San Lazzaro di Savena"},{"km":97.3,"alt":67,"name":"n.2 gallerie"},{"km":102.2,"alt":105,"name":"Rastignano"},{"km":107.1,"alt":139,"name":"Pian di Macina (Musiano)"},{"km":110.7,"alt":314,"name":"Monte della Capanna"},{"km":116.2,"alt":108,"name":"P.L."},{"km":116.9,"alt":125,"name":"Sasso Marconi"},{"km":125.2,"alt":133,"name":"Marzabotto"},{"km":130.7,"alt":163,"name":"Pioppe"},{"km":137.7,"alt":201,"name":"Vergato"},{"km":142,"alt":230,"name":"galleria"},{"km":144.5,"alt":243,"name":"Uscita per Riola"},{"km":146.3,"alt":251,"name":"Riola"},{"km":150.8,"alt":303,"name":"Molinaccio"},{"km":155.9,"alt":329,"name":"Silla"},{"km":161.3,"alt":595,"name":"Gaggio Montano"},{"km":167.4,"alt":823,"name":"Querciola"},{"km":171.2,"alt":716,"name":"Villaggio Europa"},{"km":172.6,"alt":812,"name":"Red Bull km"},{"km":172.9,"alt":814,"name":"Vidiciatico"},{"km":181.2,"alt":1198,"name":"Madonna dell''Acero"},{"km":184,"alt":1471,"name":"CORNO ALLE SCALE"}]'::jsonb),
  (10, '[[0,2],[1.2,3],[1.5,2],[6.4,2],[7.6,3],[8.8,3],[9.8,3],[11.1,2],[15.9,2],[16.2,3],[16.7,2],[18.7,3],[19.6,4],[20.2,3],[21.4,3],[24.6,3],[28.9,2],[31.9,3],[35.8,2],[38.4,21],[41,2],[42,3]]'::jsonb, '[{"km":0,"alt":2,"name":"VIAREGGIO"},{"km":1.2,"alt":3,"name":"Ponte Girante"},{"km":1.5,"alt":2,"name":"viale dei Tigli"},{"km":6.4,"alt":2,"name":"via J.F.Kennedy"},{"km":7.6,"alt":3,"name":"viale Europa"},{"km":8.8,"alt":3,"name":"Marina di Torre del Lago"},{"km":9.8,"alt":3,"name":"viale J.F.Kennedy"},{"km":11.1,"alt":2,"name":"viale dei Tigli"},{"km":15.9,"alt":2,"name":"via G. Oberdan"},{"km":16.2,"alt":3,"name":"Ponte Girante"},{"km":16.7,"alt":2,"name":"viale Regina Margherita"},{"km":18.7,"alt":3,"name":"viale A. Belluomini"},{"km":19.6,"alt":4,"name":"Ponte Fosso Abate"},{"km":20.2,"alt":3,"name":"Lido di Camaiore"},{"km":21.4,"alt":3,"name":"viale Sergio Bernardini"},{"km":24.6,"alt":3,"name":"Marina di Pietrasanta"},{"km":28.9,"alt":2,"name":"Forte dei Marmi"},{"km":31.9,"alt":3,"name":"Cinquale"},{"km":35.8,"alt":2,"name":"viale Roma"},{"km":38.4,"alt":21,"name":"Rinchiostra"},{"km":41,"alt":2,"name":"via Lungomare di Levante"},{"km":42,"alt":3,"name":"MASSA"}]'::jsonb),
  (11, '[[0,12],[4.9,16],[6.7,16],[9.6,21],[12,22],[14.1,30],[22.1,74],[31.2,212],[37.1,39],[41,12],[46.4,10],[49.2,18],[54,27],[57.7,60],[64.8,19],[68,15],[75.7,12],[80.8,90],[91,4],[97.1,234],[104.4,94],[108.5,179],[115.9,548],[125.8,9],[132.3,422],[135.7,619],[140.5,589],[141.8,612],[148.1,412],[158,10],[161,42],[164.7,199],[167.1,406],[169.9,144],[173.7,63],[177.1,21],[182,330],[182.4,334],[188.4,5],[191.2,54],[192.6,6],[195,4]]'::jsonb, '[{"km":0,"alt":12,"name":"PORCARI (Paper District)"},{"km":4.9,"alt":16,"name":"P.L."},{"km":6.7,"alt":16,"name":"Capannori"},{"km":9.6,"alt":21,"name":"Picciorana"},{"km":12,"alt":22,"name":"P.L."},{"km":14.1,"alt":30,"name":"Monte San Quirico"},{"km":22.1,"alt":74,"name":"San Martino in Freddana"},{"km":31.2,"alt":212,"name":"Montemagno"},{"km":37.1,"alt":39,"name":"Camaiore"},{"km":41,"alt":12,"name":"Capezzano Pianore"},{"km":46.4,"alt":10,"name":"Pietrasanta"},{"km":49.2,"alt":18,"name":"Querceta"},{"km":54,"alt":27,"name":"Montignoso (Capanne)"},{"km":57.7,"alt":60,"name":"Massa"},{"km":64.8,"alt":19,"name":"Carrara"},{"km":68,"alt":15,"name":"Luni"},{"km":75.7,"alt":12,"name":"Sarzana"},{"km":80.8,"alt":90,"name":"Arcola"},{"km":91,"alt":4,"name":"La Spezia"},{"km":97.1,"alt":234,"name":"La Foce"},{"km":104.4,"alt":94,"name":"Pian di Barca"},{"km":108.5,"alt":179,"name":"Pignone"},{"km":115.9,"alt":548,"name":"Passo del Termine"},{"km":125.8,"alt":9,"name":"Levanto"},{"km":132.3,"alt":422,"name":"Bv. di Montaretto"},{"km":135.7,"alt":619,"name":"Colle di Guaitarola"},{"km":140.5,"alt":589,"name":"La Baracca"},{"km":141.8,"alt":612,"name":"Passo del Bracco"},{"km":148.1,"alt":412,"name":"Bracco"},{"km":158,"alt":10,"name":"Sestri Levante"},{"km":161,"alt":42,"name":"Santa Vittoria di Libiola"},{"km":164.7,"alt":199,"name":"Monte Domenico"},{"km":167.1,"alt":406,"name":"Colla dei Scioli"},{"km":169.9,"alt":144,"name":"Frisolino"},{"km":173.7,"alt":63,"name":"Conscenti"},{"km":177.1,"alt":21,"name":"Graveglia"},{"km":182,"alt":330,"name":"Cogorno"},{"km":182.4,"alt":334,"name":"Red Bull km"},{"km":188.4,"alt":5,"name":"Lavagna"},{"km":191.2,"alt":54,"name":"Piazzale Rocca"},{"km":192.6,"alt":6,"name":"Chiavari (centro)"},{"km":195,"alt":4,"name":"CHIAVARI"}]'::jsonb),
  (12, '[[0,42],[3.8,86],[8.1,142],[9.3,185],[12,328],[12.9,330],[13.7,336],[17.4,321],[19.5,233],[25.6,155],[29.3,120],[40.9,24],[45.6,6],[50.6,8],[54.7,8],[58.6,7],[62.7,25],[64,9],[65.3,25],[69.1,18],[70.2,30],[74.7,6],[82.7,6],[88.7,8],[90.3,13],[100.7,218],[107,499],[107.5,514],[113.8,371],[120,601],[123,761],[130,679],[139.5,378],[144.1,226],[149,186],[155.7,166],[160.8,177],[161.6,215],[164.8,165],[168.2,213],[171.6,195],[175,228]]'::jsonb, '[{"km":0,"alt":42,"name":"IMPERIA"},{"km":3.8,"alt":86,"name":"Pontedassio"},{"km":8.1,"alt":142,"name":"Chiusavecchia"},{"km":9.3,"alt":185,"name":"n.2 gallerie"},{"km":12,"alt":328,"name":"galleria"},{"km":12.9,"alt":330,"name":"galleria"},{"km":13.7,"alt":336,"name":"galleria"},{"km":17.4,"alt":321,"name":"galleria"},{"km":19.5,"alt":233,"name":"Pieve di Teco"},{"km":25.6,"alt":155,"name":"Borghetto d''Arroscia"},{"km":29.3,"alt":120,"name":"Borgo di Ranzo"},{"km":40.9,"alt":24,"name":"Coasco"},{"km":45.6,"alt":6,"name":"Albenga"},{"km":50.6,"alt":8,"name":"Ceriale"},{"km":54.7,"alt":8,"name":"Loano"},{"km":58.6,"alt":7,"name":"Pietra Ligure"},{"km":62.7,"alt":25,"name":"galleria"},{"km":64,"alt":9,"name":"Finale Ligure"},{"km":65.3,"alt":25,"name":"n.2 gallerie"},{"km":69.1,"alt":18,"name":"Varigotti"},{"km":70.2,"alt":30,"name":"n.2 gallerie"},{"km":74.7,"alt":6,"name":"Spotorno"},{"km":82.7,"alt":6,"name":"Vado Ligure"},{"km":88.7,"alt":8,"name":"Savona"},{"km":90.3,"alt":13,"name":"galleria"},{"km":100.7,"alt":218,"name":"Stella"},{"km":107,"alt":499,"name":"Giovo Ligure"},{"km":107.5,"alt":514,"name":"Colle Giovo"},{"km":113.8,"alt":371,"name":"Sassello"},{"km":120,"alt":601,"name":"Bv. per Ovada"},{"km":123,"alt":761,"name":"Bric Berton"},{"km":130,"alt":679,"name":"Bv. per Ovada"},{"km":139.5,"alt":378,"name":"Cassinelle"},{"km":144.1,"alt":226,"name":"Molare"},{"km":149,"alt":186,"name":"Ovada"},{"km":155.7,"alt":166,"name":"Silvano d''Orba"},{"km":160.8,"alt":177,"name":"Capriata d''Orba"},{"km":161.6,"alt":215,"name":"Red Bull km"},{"km":164.8,"alt":165,"name":"Francavilla Bisio"},{"km":168.2,"alt":213,"name":"Pasturana"},{"km":171.6,"alt":195,"name":"Novi Ligure (centro)"},{"km":175,"alt":228,"name":"NOVI LIGURE"}]'::jsonb),
  (13, '[[0,98],[6.6,107],[11.8,144],[17.6,113],[24.1,142],[29.4,165],[32.7,156],[41.4,129],[46.1,111],[50,115],[52.3,116],[55.9,111],[58.8,111],[64.5,117],[75.5,127],[78.7,123],[81,125],[88.5,141],[94.7,160],[99.4,177],[105.7,188],[115.9,240],[119.7,260],[127.5,304],[133.7,365],[139.4,205],[147.5,216],[155.7,203],[163.2,205],[165.3,200],[167.7,333],[171,246],[172.3,292],[175.7,581],[180.9,292],[182.6,245],[186.1,202],[189,201]]'::jsonb, '[{"km":0,"alt":98,"name":"ALESSANDRIA"},{"km":6.6,"alt":107,"name":"Oviglio"},{"km":11.8,"alt":144,"name":"Abbazia di Masio"},{"km":17.6,"alt":113,"name":"Quattordio"},{"km":24.1,"alt":142,"name":"Accorneri Inferiore"},{"km":29.4,"alt":165,"name":"Viarigi"},{"km":32.7,"alt":156,"name":"Altavilla Monferrato"},{"km":41.4,"alt":129,"name":"Roncaglia"},{"km":46.1,"alt":111,"name":"Cantone Losa"},{"km":50,"alt":115,"name":"galleria"},{"km":52.3,"alt":116,"name":"Casale Monferrato"},{"km":55.9,"alt":111,"name":"Cantone il Rondò"},{"km":58.8,"alt":111,"name":"Villanova Monferrato"},{"km":64.5,"alt":117,"name":"Stroppiana"},{"km":75.5,"alt":127,"name":"Vercelli"},{"km":78.7,"alt":123,"name":"P.L."},{"km":81,"alt":125,"name":"Borgo Vercelli"},{"km":88.5,"alt":141,"name":"Casalvolone"},{"km":94.7,"alt":160,"name":"Biandrate"},{"km":99.4,"alt":177,"name":"Mandello Vitta"},{"km":105.7,"alt":188,"name":"Bv. per Proh"},{"km":115.9,"alt":240,"name":"Cavaglio d''Agogna"},{"km":119.7,"alt":260,"name":"Fontaneto d''Agogna"},{"km":127.5,"alt":304,"name":"Borgomanero"},{"km":133.7,"alt":365,"name":"Borgo Agnello"},{"km":139.4,"alt":205,"name":"Arona"},{"km":147.5,"alt":216,"name":"Lesa"},{"km":155.7,"alt":203,"name":"Stresa"},{"km":163.2,"alt":205,"name":"Feriolo"},{"km":165.3,"alt":200,"name":"Fondotoce"},{"km":167.7,"alt":333,"name":"Bieno"},{"km":171,"alt":246,"name":"Trobaso"},{"km":172.3,"alt":292,"name":"Red Bull km"},{"km":175.7,"alt":581,"name":"Ungiasca"},{"km":180.9,"alt":292,"name":"Cambiasca"},{"km":182.6,"alt":245,"name":"Trobaso"},{"km":186.1,"alt":202,"name":"Centro Eventi"},{"km":189,"alt":201,"name":"VERBANIA"}]'::jsonb),
  (14, '[[0,561],[2.1,649],[9.7,1106],[18.1,1619],[20.6,1635],[23,1515],[29.9,1047],[36.4,539],[47.7,593],[53.9,843],[56,802],[58.7,923],[61.8,1173],[64,1164],[69.6,779],[72.7,777],[74.7,697],[82.3,1284],[85.1,1237],[90.1,1451],[92.1,1587],[98.8,1218],[107.1,678],[108.6,658],[111.7,640],[116,616],[116.5,620],[128.1,1413],[133,1793]]'::jsonb, '[{"km":0,"alt":561,"name":"AOSTA"},{"km":2.1,"alt":649,"name":"Quart"},{"km":9.7,"alt":1106,"name":"Ville sur Nus"},{"km":18.1,"alt":1619,"name":"Saint-Barthélémy"},{"km":20.6,"alt":1635,"name":"Lignan"},{"km":23,"alt":1515,"name":"Issologne"},{"km":29.9,"alt":1047,"name":"Blavy"},{"km":36.4,"alt":539,"name":"Nus"},{"km":47.7,"alt":593,"name":"Aosta (bv. per Roisan)"},{"km":53.9,"alt":843,"name":"Roisan"},{"km":56,"alt":802,"name":"Ins. sr.28"},{"km":58.7,"alt":923,"name":"Valpelline"},{"km":61.8,"alt":1173,"name":"Doues"},{"km":64,"alt":1164,"name":"Champsavinal"},{"km":69.6,"alt":779,"name":"Rhins"},{"km":72.7,"alt":777,"name":"Variney"},{"km":74.7,"alt":697,"name":"Saraillon (Chataignier)"},{"km":82.3,"alt":1284,"name":"Lin Noir"},{"km":85.1,"alt":1237,"name":"Mondache"},{"km":90.1,"alt":1451,"name":"Homené-Dessous"},{"km":92.1,"alt":1587,"name":"Verrogne"},{"km":98.8,"alt":1218,"name":"Saint-Nicolas"},{"km":107.1,"alt":678,"name":"Saint-Pierre"},{"km":108.6,"alt":658,"name":"Villeneuve"},{"km":111.7,"alt":640,"name":"Aymavilles"},{"km":116,"alt":616,"name":"Red Bull km"},{"km":116.5,"alt":620,"name":"Gressan"},{"km":128.1,"alt":1413,"name":"Les Fleurs"},{"km":133,"alt":1793,"name":"PILA (Gressan)"}]'::jsonb),
  (15, '[[0,92],[2.2,91],[4.5,90],[9.4,78],[16.6,88],[20.8,78],[26.7,65],[28.3,59],[36.3,75],[45,78],[49.6,66],[53.9,82],[59.5,89],[68.8,101],[75.6,104],[80.9,114],[83.5,113],[85.3,113],[89.8,122],[91.4,119],[91.8,119],[92.9,117],[93.7,116],[95.6,113],[98.6,114],[99.8,113],[101.6,113],[106.1,122],[107.7,119],[108.1,119],[111.9,113],[114.8,114],[114.9,114],[116.1,113],[122.4,122],[124.4,119],[128.2,113],[131.2,114],[132.4,113],[138.7,122],[140.7,119],[144.5,113],[147.5,114],[148.7,113],[155,122],[157,119]]'::jsonb, '[{"km":0,"alt":92,"name":"VOGHERA"},{"km":2.2,"alt":91,"name":"Montebello della Battaglia"},{"km":4.5,"alt":90,"name":"Casteggio"},{"km":9.4,"alt":78,"name":"Santa Giuletta"},{"km":16.6,"alt":88,"name":"Broni"},{"km":20.8,"alt":78,"name":"Stradella"},{"km":26.7,"alt":65,"name":"Ponte di Spessa (F. Po)"},{"km":28.3,"alt":59,"name":"Bv. di San Zenone Po"},{"km":36.3,"alt":75,"name":"Belgioioso"},{"km":45,"alt":78,"name":"Montebolone"},{"km":49.6,"alt":66,"name":"Pavia"},{"km":53.9,"alt":82,"name":"Tang. Nord"},{"km":59.5,"alt":89,"name":"Certosa di Pavia"},{"km":68.8,"alt":101,"name":"Binasco"},{"km":75.6,"alt":104,"name":"Rozzano"},{"km":80.9,"alt":114,"name":"Chiesa Rossa"},{"km":83.5,"alt":113,"name":"viale Toscana"},{"km":85.3,"alt":113,"name":"Piazzale Lodi"},{"km":89.8,"alt":122,"name":"Piazzale Loreto"},{"km":91.4,"alt":119,"name":"Porta Venezia"},{"km":91.8,"alt":119,"name":"MILANO"},{"km":92.9,"alt":117,"name":"viale Bianca Maria"},{"km":93.7,"alt":116,"name":"v.F.lli Campi"},{"km":95.6,"alt":113,"name":"Piazzale Lodi"},{"km":98.6,"alt":114,"name":"Piazza Belfanti"},{"km":99.8,"alt":113,"name":"viale Toscana"},{"km":101.6,"alt":113,"name":"Piazzale Lodi"},{"km":106.1,"alt":122,"name":"Piazzale Loreto"},{"km":107.7,"alt":119,"name":"Porta Venezia"},{"km":108.1,"alt":119,"name":"MILANO"},{"km":111.9,"alt":113,"name":"Piazzale Lodi"},{"km":114.8,"alt":114,"name":"Red Bull km"},{"km":114.9,"alt":114,"name":"Piazza Belfanti"},{"km":116.1,"alt":113,"name":"viale Toscana"},{"km":122.4,"alt":122,"name":"Piazzale Loreto"},{"km":124.4,"alt":119,"name":"MILANO"},{"km":128.2,"alt":113,"name":"Piazzale Lodi"},{"km":131.2,"alt":114,"name":"Piazza Belfanti"},{"km":132.4,"alt":113,"name":"viale Toscana"},{"km":138.7,"alt":122,"name":"Piazzale Loreto"},{"km":140.7,"alt":119,"name":"MILANO"},{"km":144.5,"alt":113,"name":"Piazzale Lodi"},{"km":147.5,"alt":114,"name":"Piazza Belfanti"},{"km":148.7,"alt":113,"name":"viale Toscana"},{"km":155,"alt":122,"name":"Piazzale Loreto"},{"km":157,"alt":119,"name":"MILANO"}]'::jsonb),
  (16, '[[0,241],[2.8,268],[9.7,267],[15.5,304],[16.6,336],[17.9,354],[22.3,381],[24.2,441],[26.9,499],[32.2,770],[34,774],[36.9,715],[40.5,618],[43.5,874],[48.9,499],[54.2,770],[56,774],[59,715],[62.5,618],[65.5,874],[71,499],[73.7,441],[74.7,465],[79.5,354],[80.7,336],[82.1,296],[86.8,325],[90.2,392],[95.7,615],[100.6,715],[101.4,712],[109.1,1359],[113,1644]]'::jsonb, '[{"km":0,"alt":241,"name":"BELLINZONA"},{"km":2.8,"alt":268,"name":"Claro"},{"km":9.7,"alt":267,"name":"Osogna"},{"km":15.5,"alt":304,"name":"Biasca"},{"km":16.6,"alt":336,"name":"Ins. 416"},{"km":17.9,"alt":354,"name":"Bv. di Loderio"},{"km":22.3,"alt":381,"name":"Malvaglia"},{"km":24.2,"alt":441,"name":"Motto"},{"km":26.9,"alt":499,"name":"Roccabella"},{"km":32.2,"alt":770,"name":"Torre"},{"km":34,"alt":774,"name":"Aquila"},{"km":36.9,"alt":715,"name":"Ponto Valentino"},{"km":40.5,"alt":618,"name":"Prugiasco"},{"km":43.5,"alt":874,"name":"Leontica"},{"km":48.9,"alt":499,"name":"Roccabella"},{"km":54.2,"alt":770,"name":"Torre"},{"km":56,"alt":774,"name":"Aquila"},{"km":59,"alt":715,"name":"Ponto Valentino"},{"km":62.5,"alt":618,"name":"Prugiasco"},{"km":65.5,"alt":874,"name":"Leontica"},{"km":71,"alt":499,"name":"Roccabella"},{"km":73.7,"alt":441,"name":"Motto"},{"km":74.7,"alt":465,"name":"Ludiano"},{"km":79.5,"alt":354,"name":"Ins. 416"},{"km":80.7,"alt":336,"name":"Bv. di Biasca centro"},{"km":82.1,"alt":296,"name":"Bv. per Bodio/Airolo"},{"km":86.8,"alt":325,"name":"Bodio"},{"km":90.2,"alt":392,"name":"Giornico"},{"km":95.7,"alt":615,"name":"Lavorgo"},{"km":100.6,"alt":715,"name":"Red Bull km"},{"km":101.4,"alt":712,"name":"Faido"},{"km":109.1,"alt":1359,"name":"Campello"},{"km":113,"alt":1644,"name":"CARÌ"}]'::jsonb),
  (17, '[[0,150],[3.2,161],[10.7,161],[17.4,163],[22.6,165],[28.9,166],[32,178],[37.1,218],[44.6,203],[46.7,190],[54.7,189],[55.7,198],[63.9,681],[66.9,514],[72.2,293],[73.8,325],[79.9,403],[86.9,722],[88.1,735],[95.2,419],[100.9,306],[102.7,319],[112.1,404],[113.5,388],[121.3,379],[125.6,394],[130.7,427],[137.9,499],[143.8,803],[151.8,565],[155,530],[163.3,651],[164.9,667],[173.2,727],[174.3,795],[176.3,795],[183.8,890],[186.6,1005],[188.3,1072],[188.9,1024],[191.3,1136],[194,1032],[196.3,830],[202,1018]]'::jsonb, '[{"km":0,"alt":150,"name":"CASSANO D''ADDA"},{"km":3.2,"alt":161,"name":"Vaprio d''Adda"},{"km":10.7,"alt":161,"name":"Verdello"},{"km":17.4,"alt":163,"name":"Urgnano"},{"km":22.6,"alt":165,"name":"Ghisalba"},{"km":28.9,"alt":166,"name":"Palosco"},{"km":32,"alt":178,"name":"Palazzolo sull''Oglio"},{"km":37.1,"alt":218,"name":"Grumello del Monte"},{"km":44.6,"alt":203,"name":"Sarnico"},{"km":46.7,"alt":190,"name":"Paratico"},{"km":54.7,"alt":189,"name":"P.L."},{"km":55.7,"alt":198,"name":"Iseo"},{"km":63.9,"alt":681,"name":"Passo dei Tre Termini"},{"km":66.9,"alt":514,"name":"Polaveno"},{"km":72.2,"alt":293,"name":"Ponte Zanano"},{"km":73.8,"alt":325,"name":"Gardone Val Trompia"},{"km":79.9,"alt":403,"name":"Brozzo"},{"km":86.9,"alt":722,"name":"Lodrino"},{"km":88.1,"alt":735,"name":"Cocca di Lodrino"},{"km":95.2,"alt":419,"name":"Casto"},{"km":100.9,"alt":306,"name":"Nozza"},{"km":102.7,"alt":319,"name":"Vestone"},{"km":112.1,"alt":404,"name":"galleria"},{"km":113.5,"alt":388,"name":"Anfo"},{"km":121.3,"alt":379,"name":"Ponte Caffaro"},{"km":125.6,"alt":394,"name":"Ca'' Rossa"},{"km":130.7,"alt":427,"name":"Condino"},{"km":137.9,"alt":499,"name":"Creto"},{"km":143.8,"alt":803,"name":"Roncone"},{"km":151.8,"alt":565,"name":"Tione di Trento"},{"km":155,"alt":530,"name":"Preone"},{"km":163.3,"alt":651,"name":"galleria"},{"km":164.9,"alt":667,"name":"Stenico"},{"km":173.2,"alt":727,"name":"San Lorenzo Dorsino"},{"km":174.3,"alt":795,"name":"galleria"},{"km":176.3,"alt":795,"name":"Nembia"},{"km":183.8,"alt":890,"name":"Molveno"},{"km":186.6,"alt":1005,"name":"Red Bull km"},{"km":188.3,"alt":1072,"name":"galleria"},{"km":188.9,"alt":1024,"name":"Andalo"},{"km":191.3,"alt":1136,"name":"Andalo-Lever"},{"km":194,"alt":1032,"name":"Santel"},{"km":196.3,"alt":830,"name":"Cavedago"},{"km":202,"alt":1018,"name":"ANDALO"}]'::jsonb),
  (18, '[[0,230],[4.7,218],[8.4,208],[12.3,228],[16,198],[20.5,266],[26.1,444],[29.9,542],[35,473],[43.6,480],[43.9,485],[54.6,473],[59,386],[63.3,350],[73.6,252],[82.4,214],[84.5,218],[87.7,350],[92.8,319],[100.7,318],[106,269],[108.9,238],[121.6,264],[123.7,192],[129.2,252],[135.4,304],[138.4,384],[140.8,263],[143.4,199],[151.7,232],[153.8,269],[154.3,274],[160.6,102],[161.7,242],[162.9,262],[166.1,203],[171,135]]'::jsonb, '[{"km":0,"alt":230,"name":"FAI DELLA PAGANELLA"},{"km":4.7,"alt":218,"name":"San Michele all''Adige"},{"km":8.4,"alt":208,"name":"Nave San Felice"},{"km":12.3,"alt":228,"name":"Lavis"},{"km":16,"alt":198,"name":"Gardolo"},{"km":20.5,"alt":266,"name":"Trento"},{"km":26.1,"alt":444,"name":"Civezzano"},{"km":29.9,"alt":542,"name":"Madrano"},{"km":35,"alt":473,"name":"Pergine Valsugana"},{"km":43.6,"alt":480,"name":"galleria"},{"km":43.9,"alt":485,"name":"Levico Terme"},{"km":54.6,"alt":473,"name":"Roncegno Terme"},{"km":59,"alt":386,"name":"Borgo Valsugana"},{"km":63.3,"alt":350,"name":"Ingresso ss.47"},{"km":73.6,"alt":252,"name":"Svinc. di Grigno"},{"km":82.4,"alt":214,"name":"Uscita per Primolano/Enego"},{"km":84.5,"alt":218,"name":"Primolano"},{"km":87.7,"alt":350,"name":"Fastro"},{"km":92.8,"alt":319,"name":"Arsiè"},{"km":100.7,"alt":318,"name":"Seren del Grappa (Santa Lucia)"},{"km":106,"alt":269,"name":"Feltre"},{"km":108.9,"alt":238,"name":"Anzù"},{"km":121.6,"alt":264,"name":"Quero"},{"km":123.7,"alt":192,"name":"Fener"},{"km":129.2,"alt":252,"name":"Valdobbiadene"},{"km":135.4,"alt":304,"name":"Guia"},{"km":138.4,"alt":384,"name":"Combai"},{"km":140.8,"alt":263,"name":"Miane"},{"km":143.4,"alt":199,"name":"Follina"},{"km":151.7,"alt":232,"name":"Lago"},{"km":153.8,"alt":269,"name":"Tarzo"},{"km":154.3,"alt":274,"name":"Red Bull km"},{"km":160.6,"alt":102,"name":"Bv. per Ca'' del Poggio"},{"km":161.7,"alt":242,"name":"Muro di Ca'' del Poggio"},{"km":162.9,"alt":262,"name":"San Pietro di Feletto"},{"km":166.1,"alt":203,"name":"Refrontolo"},{"km":171,"alt":135,"name":"PIEVE DI SOLIGO"}]'::jsonb),
  (19, '[[0,336],[1.5,366],[7.8,463],[13.3,541],[18,434],[20.6,439],[22.1,405],[26.8,374],[34.1,440],[40,486],[45.3,595],[46.4,609],[49.2,811],[58.7,1601],[62.9,1242],[67,937],[69.5,1143],[72.9,1501],[75.1,1341],[78.2,1518],[82,1766],[88.6,1424],[91.8,1314],[98.9,1997],[101.6,2236],[111.9,1535],[118.6,1881],[122.2,2105],[123.1,2051],[131.6,1500],[141.7,998],[146,986],[151,1465]]'::jsonb, '[{"km":0,"alt":336,"name":"FELTRE"},{"km":1.5,"alt":366,"name":"Villabruna"},{"km":7.8,"alt":463,"name":"Cesiomaggiore"},{"km":13.3,"alt":541,"name":"San Gregorio nelle Alpi"},{"km":18,"alt":434,"name":"San Zenon"},{"km":20.6,"alt":439,"name":"Sospirolo"},{"km":22.1,"alt":405,"name":"Vopez"},{"km":26.8,"alt":374,"name":"Mas"},{"km":34.1,"alt":440,"name":"La Stanga"},{"km":40,"alt":486,"name":"Galleria del Castel"},{"km":45.3,"alt":595,"name":"Bv. di Rivamonte Agordino"},{"km":46.4,"alt":609,"name":"Agordo"},{"km":49.2,"alt":811,"name":"La Valle Agordina"},{"km":58.7,"alt":1601,"name":"Passo Duran"},{"km":62.9,"alt":1242,"name":"Chiesa"},{"km":67,"alt":937,"name":"Dont"},{"km":69.5,"alt":1143,"name":"Ruterbol"},{"km":72.9,"alt":1501,"name":"Coi"},{"km":75.1,"alt":1341,"name":"Mareson"},{"km":78.2,"alt":1518,"name":"Palafavera"},{"km":82,"alt":1766,"name":"Forcella Staulanza"},{"km":88.6,"alt":1424,"name":"Santa Fosca"},{"km":91.8,"alt":1314,"name":"Selva di Cadore"},{"km":98.9,"alt":1997,"name":"Rifugio Fedare"},{"km":101.6,"alt":2236,"name":"Passo Giau"},{"km":111.9,"alt":1535,"name":"Pocol"},{"km":118.6,"alt":1881,"name":"Red Bull km"},{"km":122.2,"alt":2105,"name":"Passo Falzarego"},{"km":123.1,"alt":2051,"name":"Galleria"},{"km":131.6,"alt":1500,"name":"Cernadoi"},{"km":141.7,"alt":998,"name":"Caprile"},{"km":146,"alt":986,"name":"Alleghe"},{"km":151,"alt":1465,"name":"PIANI DI PEZZÈ"}]'::jsonb),
  (20, '[[0,235],[2.5,232],[4.3,243],[7.7,216],[9.8,225],[10.9,215],[11.5,201],[15.1,185],[16.5,177],[18,166],[24.4,198],[31.6,212],[34,193],[38.8,226],[43,200],[48.9,189],[55.2,206],[62.4,166],[69.4,158],[73.6,268],[77.1,153],[81,309],[84.4,501],[85.8,558],[95.7,211],[103.8,303],[112.9,278],[119.2,321],[132.7,159],[139.2,775],[147.3,1290],[160.9,426],[163.3,406],[163.7,406],[165.2,401],[165.7,405],[171.2,375],[172.1,321],[176.3,292],[185.5,159],[192,769],[200,1290]]'::jsonb, '[{"km":0,"alt":235,"name":"GEMONA DEL FRIULI"},{"km":2.5,"alt":232,"name":"Venzone"},{"km":4.3,"alt":243,"name":"Pioverno"},{"km":7.7,"alt":216,"name":"Bordano"},{"km":9.8,"alt":225,"name":"Galleria"},{"km":10.9,"alt":215,"name":"Galleria"},{"km":11.5,"alt":201,"name":"Braulins"},{"km":15.1,"alt":185,"name":"Osoppo"},{"km":16.5,"alt":177,"name":"P.L."},{"km":18,"alt":166,"name":"Osoppo-Zona Industriale"},{"km":24.4,"alt":198,"name":"Buja"},{"km":31.6,"alt":212,"name":"Artegna"},{"km":34,"alt":193,"name":"Magnano in Riviera"},{"km":38.8,"alt":226,"name":"Tarcento"},{"km":43,"alt":200,"name":"Nimis"},{"km":48.9,"alt":189,"name":"Tricesimo"},{"km":55.2,"alt":206,"name":"Colloredo di Montalbano"},{"km":62.4,"alt":166,"name":"Majano"},{"km":69.4,"alt":158,"name":"Cornino"},{"km":73.6,"alt":268,"name":"Forgaria nel Friuli"},{"km":77.1,"alt":153,"name":"Ponte di Flagogna"},{"km":81,"alt":309,"name":"Anduins"},{"km":84.4,"alt":501,"name":"Vito d''Asio"},{"km":85.8,"alt":558,"name":"Clauzetto"},{"km":95.7,"alt":211,"name":"Travesio"},{"km":103.8,"alt":303,"name":"Meduno"},{"km":112.9,"alt":278,"name":"Maniago"},{"km":119.2,"alt":321,"name":"Montereale Valcellina"},{"km":132.7,"alt":159,"name":"Aviano"},{"km":139.2,"alt":775,"name":"Rifugio Bornass"},{"km":147.3,"alt":1290,"name":"PIANCAVALLO"},{"km":160.9,"alt":426,"name":"Lago di Barcis"},{"km":163.3,"alt":406,"name":"Barcis"},{"km":163.7,"alt":406,"name":"Galleria Dint"},{"km":165.2,"alt":401,"name":"Galleria Pra Piero"},{"km":165.7,"alt":405,"name":"Galleria Fara"},{"km":171.2,"alt":375,"name":"Galleria Magredo"},{"km":172.1,"alt":321,"name":"Montereale Valcellina"},{"km":176.3,"alt":292,"name":"Red Bull km"},{"km":185.5,"alt":159,"name":"Aviano"},{"km":192,"alt":769,"name":"Rifugio Bornass"},{"km":200,"alt":1290,"name":"PIANCAVALLO"}]'::jsonb),
  (21, '[[0,32],[0.7,23],[12.4,12],[17.2,5],[20.1,4],[23.1,5],[28,12],[39.1,20],[42,32],[47.4,38],[48.2,22],[49.3,23],[49.9,31],[50.7,23],[51,19],[52.6,18],[54.7,18],[55.1,26],[55.7,21],[57.7,22],[58.8,23],[59.4,31],[60.1,23],[60.5,19],[62.1,18],[64.2,18],[64.6,26],[69.6,21],[71.5,22],[74.1,26],[77.7,23],[79.1,21],[81,22],[83.6,26],[88.5,21],[90.5,22],[93,26],[98,21],[100,22],[102.5,26],[106.2,23],[107.5,21],[109.4,22],[112,26],[117,21],[118.9,22],[121.5,26],[126.5,21],[128.4,22],[131,26]]'::jsonb, '[{"km":0,"alt":32,"name":"ROMA"},{"km":0.7,"alt":23,"name":"Svincolo per Ostia/Aurelia"},{"km":12.4,"alt":12,"name":"Casal Palocco"},{"km":17.2,"alt":5,"name":"Fontana dello Zodiaco"},{"km":20.1,"alt":4,"name":"Ostia"},{"km":23.1,"alt":5,"name":"Fontana dello Zodiaco"},{"km":28,"alt":12,"name":"Casal Palocco"},{"km":39.1,"alt":20,"name":"Uscita per EUR"},{"km":42,"alt":32,"name":"EUR"},{"km":47.4,"alt":38,"name":"Porta Ardeatina"},{"km":48.2,"alt":22,"name":"viale delle Terme di Caracalla"},{"km":49.3,"alt":23,"name":"Via di San Gregorio"},{"km":49.9,"alt":31,"name":"Colosseo"},{"km":50.7,"alt":23,"name":"Fori Imperiali"},{"km":51,"alt":19,"name":"Piazza Venezia"},{"km":52.6,"alt":18,"name":"Piazzale P.Paoli"},{"km":54.7,"alt":18,"name":"Lungotevere Aventino"},{"km":55.1,"alt":26,"name":"ROMA"},{"km":55.7,"alt":21,"name":"viale Guido Baccelli"},{"km":57.7,"alt":22,"name":"viale delle Terme di Caracalla"},{"km":58.8,"alt":23,"name":"via di San Gregorio"},{"km":59.4,"alt":31,"name":"Colosseo"},{"km":60.1,"alt":23,"name":"Fori Imperiali"},{"km":60.5,"alt":19,"name":"Piazza Venezia"},{"km":62.1,"alt":18,"name":"Piazzale P.Paoli"},{"km":64.2,"alt":18,"name":"Lungotevere Aventino"},{"km":64.6,"alt":26,"name":"ROMA"},{"km":69.6,"alt":21,"name":"Fori Imperiali"},{"km":71.5,"alt":22,"name":"Piazzale P.Paoli"},{"km":74.1,"alt":26,"name":"ROMA"},{"km":77.7,"alt":23,"name":"Red Bull km"},{"km":79.1,"alt":21,"name":"Fori Imperiali"},{"km":81,"alt":22,"name":"Piazzale P.Paoli"},{"km":83.6,"alt":26,"name":"ROMA"},{"km":88.5,"alt":21,"name":"Fori Imperiali"},{"km":90.5,"alt":22,"name":"Piazzale P.Paoli"},{"km":93,"alt":26,"name":"ROMA"},{"km":98,"alt":21,"name":"Fori Imperiali"},{"km":100,"alt":22,"name":"Piazzale P.Paoli"},{"km":102.5,"alt":26,"name":"ROMA"},{"km":106.2,"alt":23,"name":"via di San Gregorio"},{"km":107.5,"alt":21,"name":"Fori Imperiali"},{"km":109.4,"alt":22,"name":"Piazzale P.Paoli"},{"km":112,"alt":26,"name":"ROMA"},{"km":117,"alt":21,"name":"Fori Imperiali"},{"km":118.9,"alt":22,"name":"Piazzale P.Paoli"},{"km":121.5,"alt":26,"name":"ROMA"},{"km":126.5,"alt":21,"name":"Fori Imperiali"},{"km":128.4,"alt":22,"name":"Piazzale P.Paoli"},{"km":131,"alt":26,"name":"ROMA"}]'::jsonb)
) as x(number, points, waypoints) join public.stages s on s.tour_id = 'giro-2026' and s.number = x.number;

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
    delete from stage_standings where stage_id = v_stage.id;
    insert into stage_standings (stage_id, category, position, rider_id)
    select v_stage.id, 'gc', x.position, r.id
      from replay_result x join riders r on r.tour_id = v_tour and r.name = x.rider
     where x.tour_id = v_tour and x.number = v_stage.number and x.kind = 'gc';
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
