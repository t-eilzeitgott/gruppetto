-- =====================================================================
-- Generalprobe der automatischen Ergebnisse mit der Giro-2026-Testrunde
--
-- Statt pg_cron (replay_giro2026) holt jetzt der GitHub-Workflow „Ergebnisse“
-- die echten Giro-2026-Ergebnisse bei procyclingstats.com ab – genau so, wie er
-- es 2027 bei den echten Rundfahrten tun wird: Abruf, Fahrerabgleich, Warten auf
-- die Zielankunft, Stabilitätsprüfung, Ausstiege, Wertungsstände, Bonus-Zwischenstand.
-- Für die Testrunde gilt statt der damaligen Zielankunft eine feste Uhrzeit: jeden Tag um
-- 15:00 Uhr wird das Ergebnis der Etappe übernommen (Schritt 3 und 4).
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

-- 3. Feste Übernahmezeit: jede noch offene Etappe der Testrunde bekommt ihr Ergebnis um 15:00 Uhr
--    (statt zur echten Zielankunft von damals, ohne Stabilitätsprüfung – die Ergebnisse sind ja endgültig).
--    Entfernen: update public.stages set info = info - 'publish_at' where tour_id = 'giro-2026';
update public.stages set info = coalesce(info, '{}'::jsonb) || '{"publish_at":"15:00"}'::jsonb
 where tour_id = 'giro-2026' and not results_published;

-- 4. Pünktlicher Anstoß um 15:00 Uhr: GitHubs Zeitplan ist unzuverlässig (läuft oft stark verspätet
--    oder gar nicht), deshalb startet die Datenbank den Workflow „Ergebnisse“ selbst – um 15:01 und
--    zur Sicherheit noch einmal um 15:21 (der zweite Lauf ändert nichts, wenn alles schon drin ist).
--
--    Einmalig vorher: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token,
--    Repository access: nur t-eilzeitgott/gruppetto, Permissions → Actions: Read and write. Dann hier im
--    SQL Editor (Token einsetzen, Zeile ohne die beiden Striche ausführen):
--      select vault.create_secret('github_pat_…', 'github_dispatch_token', 'Startet den Workflow Ergebnisse');
--    Neuen Token später eintragen:
--      select vault.update_secret(id, 'github_pat_…') from vault.secrets where name = 'github_dispatch_token';
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

create or replace function public.dispatch_ergebnisse(p_tour text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  inputs jsonb := jsonb_build_object('art', 'Echt (speichern)');
begin
  -- Zeitplan läuft in UTC; so stimmt 15 Uhr deutscher Zeit im Sommer wie im Winter
  if extract(hour from now() at time zone 'Europe/Berlin') <> 15 then
    return null;
  end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if token is null or token = '' then
    raise warning 'dispatch_ergebnisse: kein Token „github_dispatch_token“ im Vault';
    return null;
  end if;
  if p_tour is not null then
    inputs := inputs || jsonb_build_object('rundfahrt', p_tour);
  end if;
  return net.http_post(
    url := 'https://api.github.com/repos/t-eilzeitgott/gruppetto/actions/workflows/ergebnisse.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', inputs),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'gruppetto-supabase',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
end $$;
revoke all on function public.dispatch_ergebnisse(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'giro2026-15uhr';
    perform cron.schedule('giro2026-15uhr', '1,21 13,14 * * *', $job$select public.dispatch_ergebnisse('giro-2026')$job$);
  end if;
end $$;

-- 5. Kontrolle
select t.id, t.sync_mode, t.pcs_slug,
       (select count(*) from public.stages s where s.tour_id = t.id and s.results_published) as veroeffentlicht,
       (select min(s.starts_at) from public.stages s where s.tour_id = t.id and not s.results_published) as naechste_etappe
  from public.tours t where t.id = 'giro-2026';

-- Verlauf ansehen:
--   select at, level, message from public.sync_log where tour_id = 'giro-2026' order by at desc limit 30;
--   Hat der Anstoß geklappt? (GitHub antwortet mit 204)
--   select created, status_code, content from net._http_response order by created desc limit 5;
--   Anstoß sofort testen (nur zwischen 15 und 16 Uhr, sonst passiert nichts):
--   select public.dispatch_ergebnisse('giro-2026');
--   select s.number, ss.status, ss.checked_at, ss.synced_at, ss.last_error
--     from public.stage_sync ss join public.stages s on s.id = ss.stage_id
--    where s.tour_id = 'giro-2026' order by s.number;
--
-- 15-Uhr-Anstoß beenden:
--   select cron.unschedule('giro2026-15uhr');
--
-- Zurück zum Nachspielen über pg_cron:
--   select cron.unschedule('giro2026-15uhr');
--   update public.tours set sync_mode = 'off' where id = 'giro-2026';
--   select cron.schedule('giro2026-replay', '*/5 * * * *', 'select public.replay_giro2026()');
