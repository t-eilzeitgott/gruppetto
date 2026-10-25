-- =====================================================================
-- Testrunde: Ergebnisse automatisch simulieren
--
-- Einmal im SQL Editor ausführen (nach seed_testrunde.sql).
-- Danach trägt die Datenbank selbst ein:
--   • je Etappe eine Top 10, 4 Stunden nach dem Start (also ca. 16:00 Uhr),
--     ausgewürfelt nach Fahrertyp (Sprinter im Flachen, Kletterer am Berg …)
--   • nach jeder Etappe einen Zwischenstand der Bonuswertungen,
--     nach der letzten Etappe den Endstand (zählt dann in der Rangliste).
--
-- Sofort auslösen (z. B. zum Testen):   select public.simulate_testrunde();
-- Automatik beenden:                    select cron.unschedule('testrunde-ergebnisse');
-- Gilt nur für die Rundfahrt 'testrunde', echte Rundfahrten bleiben unberührt.
-- =====================================================================

create or replace function public.simulate_testrunde(p_delay interval default interval '4 hours')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage record;
  v_count int := 0;
begin
  -- Fahrerprofile: Sprint, Klettern, Zeitfahren, Hügel (1–10)
  create temporary table if not exists sim_profile (name text primary key, s int, c int, t int, p int) on commit drop;
  truncate sim_profile;
  insert into sim_profile values
    ('Tadej Pogačar', 2, 10, 8, 10), ('Isaac del Toro', 1, 7, 5, 7), ('Adam Yates', 1, 6, 3, 5),
    ('Jonas Vingegaard', 1, 10, 8, 6), ('Wout van Aert', 7, 3, 8, 9), ('Matteo Jorgenson', 2, 5, 6, 6),
    ('Remco Evenepoel', 2, 7, 10, 8), ('Primož Roglič', 1, 7, 6, 7), ('Florian Lipowitz', 1, 7, 6, 5),
    ('Paul Seixas', 1, 6, 5, 6), ('Olav Kooij', 9, 1, 2, 3), ('Felix Gall', 1, 6, 2, 4),
    ('Juan Ayuso', 1, 6, 6, 6), ('Mads Pedersen', 8, 1, 5, 8), ('Jonathan Milan', 10, 1, 4, 2),
    ('Antonio Tiberi', 1, 5, 5, 4), ('Lenny Martinez', 1, 6, 1, 5), ('Mathieu van der Poel', 6, 2, 5, 10),
    ('Kaden Groves', 8, 1, 2, 4), ('Jasper Philipsen', 10, 1, 2, 3), ('Filippo Ganna', 3, 1, 10, 3),
    ('Thymen Arensman', 1, 5, 5, 4), ('Tim Merlier', 9, 1, 3, 2), ('Mikel Landa', 1, 6, 2, 4),
    ('Arnaud De Lie', 8, 1, 2, 6), ('Lennert Van Eetvelt', 1, 4, 2, 6), ('Tom Pidcock', 2, 5, 4, 8),
    ('Fabio Christen', 1, 3, 2, 5), ('Lorenzo Fortunato', 1, 5, 1, 3), ('Christian Scaroni', 2, 3, 2, 6);

  -- 1. Fällige Etappen: Top 10 auswürfeln (gewichtete Ziehung ohne Zurücklegen)
  for v_stage in
    select s.id, s.kind from stages s
    where s.tour_id = 'testrunde' and not s.results_published and s.starts_at + p_delay <= now()
    order by s.number
  loop
    delete from stage_results where stage_id = v_stage.id;
    insert into stage_results (stage_id, position, rider_id)
    select v_stage.id, row_number() over (order by k), id
    from (
      select r.id,
             -ln(1 - random()) / power(1 + coalesce(case v_stage.kind
               when 'flat' then p.s when 'hilly' then p.p when 'mountain' then p.c else p.t end, 3), 3) as k
      from riders r left join sim_profile p on p.name = r.name
      where r.tour_id = 'testrunde' and r.status = 'active'
      order by k
      limit 10
    ) pick;
    update stages set results_published = true where id = v_stage.id;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    return 0;
  end if;

  -- 2. Bonuswertungen aus den bisherigen Ergebnissen hochrechnen
  create temporary table if not exists sim_score (rider_id bigint primary key, name text, team text,
    excluded boolean, gc numeric, pts numeric, kom numeric) on commit drop;
  truncate sim_score;
  insert into sim_score
  select r.id, r.name, r.team, r.excluded_from_rest,
         coalesce(sum((11 - sr.position) * case s.kind when 'mountain' then 3 when 'itt' then 2.5 when 'hilly' then 1.5 else 0.2 end), 0)
           + coalesce(max(p.c), 1) * 0.3 + coalesce(max(p.t), 1) * 0.1,
         coalesce(sum((11 - sr.position) * case s.kind when 'flat' then 2 when 'hilly' then 1.2 else 0.6 end), 0)
           + coalesce(max(p.s), 1) * 0.1,
         coalesce(sum((11 - sr.position) * case s.kind when 'mountain' then 2 when 'hilly' then 1.5 else 0 end), 0)
           + coalesce(max(p.c), 1) * 0.2
  from riders r
  left join sim_profile p on p.name = r.name
  left join stage_results sr on sr.rider_id = r.id
  left join stages s on s.id = sr.stage_id and s.results_published
  where r.tour_id = 'testrunde' and r.status = 'active'
  group by r.id, r.name, r.team, r.excluded_from_rest;

  delete from bonus_results where tour_id = 'testrunde';
  insert into bonus_results (tour_id, category, position, rider_id)
  select 'testrunde', 'gc', row_number() over (order by gc desc), rider_id from (select * from sim_score order by gc desc limit 3) x
  union all
  select 'testrunde', 'rest', row_number() over (order by gc desc), rider_id from (select * from sim_score where not excluded order by gc desc limit 3) x
  union all
  select 'testrunde', 'points', row_number() over (order by pts desc), rider_id from (select * from sim_score order by pts desc limit 3) x
  union all
  select 'testrunde', 'mountains', row_number() over (order by kom desc), rider_id from (select * from sim_score order by kom desc limit 3) x
  union all
  select 'testrunde', 'youth', row_number() over (order by gc desc), rider_id from (
    select * from sim_score
    where name in ('Isaac del Toro', 'Paul Seixas', 'Florian Lipowitz', 'Lenny Martinez', 'Lennert Van Eetvelt', 'Fabio Christen')
    order by gc desc limit 3) x;

  insert into bonus_results (tour_id, category, position, team)
  select 'testrunde', 'team', row_number() over (order by score desc), team
  from (
    select team, sum(gc) as score from (
      select team, gc, row_number() over (partition by team order by gc desc) as n from sim_score
    ) t where n <= 3 group by team order by score desc limit 3
  ) x;

  -- 3. Nach der letzten Etappe: Kämpferischster Fahrer + Endstand
  if not exists (select 1 from stages where tour_id = 'testrunde' and not results_published) then
    insert into bonus_results (tour_id, category, position, rider_id)
    select 'testrunde', 'combative', 1, rider_id
    from (select distinct sr.rider_id from stage_results sr join stages s on s.id = sr.stage_id
          where s.tour_id = 'testrunde' and sr.position between 2 and 10) c
    order by random() limit 1;
    update tours set bonus_final = true where id = 'testrunde';
  end if;

  return v_count;
end;
$$;

-- Nur die Datenbank selbst darf das ausführen, nicht die App-Nutzer
revoke all on function public.simulate_testrunde(interval) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.simulate_testrunde(interval) from anon, authenticated';
  end if;
end $$;

-- Automatik: alle 15 Minuten prüfen (pg_cron ist bei Supabase dabei)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.unschedule(jobid) from cron.job where jobname = 'testrunde-ergebnisse';
    perform cron.schedule('testrunde-ergebnisse', '*/15 * * * *', 'select public.simulate_testrunde()');
    raise notice 'Automatik aktiv: Ergebnisse kommen jeweils 4 Stunden nach Etappenstart.';
  else
    raise notice 'pg_cron nicht verfügbar – Ergebnisse mit select public.simulate_testrunde(); auslösen.';
  end if;
end $$;
