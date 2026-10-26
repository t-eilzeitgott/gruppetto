-- =====================================================================
-- Generalprobe der automatischen Ergebnisse mit der Giro-2026-Testrunde
--
-- Statt pg_cron (replay_giro2026) holt jetzt der GitHub-Workflow „Ergebnisse“
-- die echten Giro-2026-Ergebnisse bei procyclingstats.com ab – genau so, wie er
-- es 2027 bei den echten Rundfahrten tun wird: Abruf, Fahrerabgleich, Warten auf
-- die Zielankunft (Start laut PCS + Siegerzeit), Stabilitätsprüfung, Ausstiege,
-- Wertungsstände, Bonus-Zwischenstand.
--
-- Voraussetzung: supabase/schema.sql (aktuell) und supabase/seed_giro2026.sql sind
-- eingespielt, das Secret SUPABASE_SECRET_KEY ist in GitHub hinterlegt.
-- Diese Datei im SQL Editor ausführen. Wiederholbar.
-- =====================================================================

-- 1. Nachspielen über pg_cron anhalten (sonst schreiben zwei Quellen dasselbe)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'giro2026-replay';
  end if;
end $$;

-- 2. Automatik für die Testrunde einschalten ('draft' = nur Vorschlag, du veröffentlichst)
update public.tours set sync_mode = 'auto' where id = 'giro-2026';

-- 3. Kontrolle
select t.id, t.sync_mode, t.pcs_slug,
       (select count(*) from public.stages s where s.tour_id = t.id and s.results_published) as veroeffentlicht,
       (select min(s.starts_at) from public.stages s where s.tour_id = t.id and not s.results_published) as naechste_etappe
  from public.tours t where t.id = 'giro-2026';

-- Verlauf ansehen:
--   select at, level, message from public.sync_log where tour_id = 'giro-2026' order by at desc limit 30;
--   select s.number, ss.status, ss.checked_at, ss.synced_at, ss.last_error
--     from public.stage_sync ss join public.stages s on s.id = ss.stage_id
--    where s.tour_id = 'giro-2026' order by s.number;
--
-- Zurück zum Nachspielen über pg_cron:
--   update public.tours set sync_mode = 'off' where id = 'giro-2026';
--   select cron.schedule('giro2026-replay', '*/5 * * * *', 'select public.replay_giro2026()');
