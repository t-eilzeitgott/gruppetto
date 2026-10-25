-- =====================================================================
-- Optionale Testrunde zum Ausprobieren der App
-- 5 Etappen ab morgen, jeweils 12:00 Uhr (deutsche Zeit), 30 Fahrer.
-- Später im Admin-Bereich unter „Rundfahrten“ wieder löschen.
-- =====================================================================

insert into public.tours (id, name, short_name, theme, year, start_date, end_date, is_visible, pcs_slug)
values (
  'testrunde', 'Testrunde', 'Test', 'neutral',
  extract(year from now())::int,
  (now() at time zone 'Europe/Berlin')::date + 1,
  (now() at time zone 'Europe/Berlin')::date + 5,
  true, null)
on conflict (id) do nothing;

insert into public.stages (tour_id, number, starts_at, kind, departure, arrival, distance_km)
select 'testrunde',
       n,
       (((now() at time zone 'Europe/Berlin')::date + n)::timestamp + time '12:00') at time zone 'Europe/Berlin',
       (array['flat', 'hilly', 'mountain', 'itt', 'flat'])[n],
       (array['Köln', 'Wuppertal', 'Winterberg', 'Düsseldorf', 'Essen'])[n],
       (array['Wuppertal', 'Winterberg', 'Kahler Asten', 'Düsseldorf', 'Dortmund'])[n],
       (array[184, 171, 162, 32, 196])[n]
from generate_series(1, 5) as n
on conflict (tour_id, number) do nothing;

insert into public.riders (tour_id, bib, name, team, tip_limit, excluded_from_rest) values
  ('testrunde',   1, 'Tadej Pogačar',        'UAE Team Emirates XRG',      null, true),
  ('testrunde',   2, 'Isaac del Toro',       'UAE Team Emirates XRG',      null, false),
  ('testrunde',   3, 'Adam Yates',           'UAE Team Emirates XRG',      null, false),
  ('testrunde',  11, 'Jonas Vingegaard',     'Visma | Lease a Bike',       null, true),
  ('testrunde',  12, 'Wout van Aert',        'Visma | Lease a Bike',       null, false),
  ('testrunde',  13, 'Matteo Jorgenson',     'Visma | Lease a Bike',       null, false),
  ('testrunde',  21, 'Remco Evenepoel',      'Red Bull – BORA – hansgrohe', null, false),
  ('testrunde',  22, 'Primož Roglič',        'Red Bull – BORA – hansgrohe', null, false),
  ('testrunde',  23, 'Florian Lipowitz',     'Red Bull – BORA – hansgrohe', null, false),
  ('testrunde',  31, 'Paul Seixas',          'Decathlon CMA CGM',          null, false),
  ('testrunde',  32, 'Olav Kooij',           'Decathlon CMA CGM',          null, false),
  ('testrunde',  33, 'Felix Gall',           'Decathlon CMA CGM',          null, false),
  ('testrunde',  41, 'Juan Ayuso',           'Lidl-Trek',                  null, false),
  ('testrunde',  42, 'Mads Pedersen',        'Lidl-Trek',                  null, false),
  ('testrunde',  43, 'Jonathan Milan',       'Lidl-Trek',                  null, false),
  ('testrunde',  51, 'Antonio Tiberi',       'Bahrain Victorious',         null, false),
  ('testrunde',  52, 'Lenny Martinez',       'Bahrain Victorious',         null, false),
  ('testrunde',  61, 'Mathieu van der Poel', 'Alpecin – Premier Tech',     null, false),
  ('testrunde',  62, 'Kaden Groves',         'Alpecin – Premier Tech',     null, false),
  ('testrunde',  63, 'Jasper Philipsen',     'Alpecin – Premier Tech',     null, false),
  ('testrunde',  71, 'Filippo Ganna',        'INEOS Grenadiers',           null, false),
  ('testrunde',  72, 'Thymen Arensman',      'INEOS Grenadiers',           null, false),
  ('testrunde',  81, 'Tim Merlier',          'Soudal Quick-Step',          null, false),
  ('testrunde',  82, 'Mikel Landa',          'Soudal Quick-Step',          null, false),
  ('testrunde',  91, 'Arnaud De Lie',        'Lotto',                      null, false),
  ('testrunde',  92, 'Lennert Van Eetvelt',  'Lotto',                      null, false),
  ('testrunde', 101, 'Tom Pidcock',          'Pinarello Q36.5',            null, false),
  ('testrunde', 102, 'Fabio Christen',       'Pinarello Q36.5',            null, false),
  ('testrunde', 111, 'Lorenzo Fortunato',    'XDS Astana',                 null, false),
  ('testrunde', 112, 'Christian Scaroni',    'XDS Astana',                 null, false)
on conflict (tour_id, name) do nothing;
