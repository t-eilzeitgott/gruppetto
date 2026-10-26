# gruppetto.

Das Grand-Tour-Tippspiel für eure Runde: Giro, Tour und Vuelta – ein Tipp pro Etappe, Bonustipps vor dem Start, Live-Rangliste. Mobile first als Web-App (PWA) auf GitHub Pages, mit Supabase als Datenbank und Login.

**App:** https://gruppetto.talfahrt.dev/
**Demo mit Beispieldaten:** https://gruppetto.talfahrt.dev/?demo

## Regeln

| Was | Punkte |
| --- | --- |
| Etappentipp: Platz 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 | 20 / 15 / 10 / 7 / 6 / 5 / 4 / 3 / 2 / 1 |
| Außenseiter-Bonus: als **Einziger** den Etappensieger getippt | +3 |
| Bonustipp: Fahrer/Team am Ende auf Platz 1 / 2 / 3 der Wertung | 15 / 10 / 5 |

- Tippschluss ist der Start der jeweiligen Etappe (Standard 12:00 Uhr, pro Etappe einstellbar). Bis dahin sieht niemand fremde Tipps – das erzwingt die Datenbank (Row Level Security), nicht nur die Oberfläche.
- Joker-Limit: Fahrer wie Pogačar und Vingegaard dürfen pro Rundfahrt nur begrenzt oft getippt werden (Admin legt das Limit je Fahrer fest, Standard 3).
- Bonuswertungen: Gesamtsieger, Best of the Rest (Gesamtwertung ohne ausgeklammerte Favoriten), Punkte, Berg, Nachwuchs, Kämpferischster Fahrer, Meiste Etappensiege (automatisch berechnet), Bestes Team. Tipp bis zum Start von Etappe 1.
- Gleichstand: geteilter Platz.

## Einrichtung (einmalig, alles kostenlos)

1. **GitHub:** Repo öffentlich, *Settings → Pages → Source: GitHub Actions*.
2. **Supabase:** Projekt in *Central EU (Frankfurt)* anlegen, im *SQL Editor* [`supabase/schema.sql`](supabase/schema.sql) ausführen, Einladungscode setzen:
   `update public.app_settings set value = 'TOUR27' where key = 'invite_code';`
3. **Mailversand:** eigenes Gmail-Konto mit Zwei-Schritt-Bestätigung und App-Passwort; in Supabase *Authentication → Emails → SMTP Settings* eintragen (`smtp.gmail.com`, Port 465).
4. **Login per Code:** In *Authentication → Emails → Templates* bei *Confirm signup* und *Magic Link* `{{ .Token }}` in die Mail schreiben – Betreff `{{ .Token }} ist dein gruppetto-Code`, Text z. B. `<p>Dein Code für gruppetto lautet: <strong>{{ .Token }}</strong></p>` (so erkennt iOS den Code und schlägt ihn in der Tastatur vor); Site URL auf die App-Adresse setzen; Rate Limit für E-Mails auf 100/h.
5. **Verbinden:** In GitHub unter *Settings → Secrets and variables → Actions → Variables* `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` (Publishable key, `sb_publishable_…`) anlegen, dann *Actions → Deploy → Run workflow*.
6. **Admin:** einmal in der App anmelden, dann im SQL Editor
   `update public.profiles set is_admin = true where id = (select id from auth.users where email = 'deine@mail.de');`
7. Testrunde mit echten Daten: [`supabase/seed_giro2026.sql`](supabase/seed_giro2026.sql) spielt den Giro d'Italia 2026 nach – 184 echte Fahrer, 21 Etappen mit Anstiegen und Sprints, ab morgen eine Etappe pro Tag um 12 Uhr. Das echte Ergebnis erscheint etwa zur echten Zielankunft (pg_cron), Ausstiege und Wertungen wie im Rennen. Die Datei wird von `node scripts/giro2026/build-sql.mjs` aus `scripts/giro2026/` erzeugt (prüft die Daten auf Widersprüche). Die ältere Würfel-Testrunde (`seed_testrunde.sql` + `simulate_testrunde.sql`) gibt es weiterhin.

8. **Saison 2027:** [`supabase/seed_2027.sql`](supabase/seed_2027.sql) trägt ein, was bisher feststeht – die komplette Tour de France 2027 (Etappen, Höhenmeter, Anstiege mit Länge und Steigung, Höhenprofile aus den offiziellen Profilen, Kategorien folgen mit dem Roadbook) sowie Zeitraum und Reglement von Giro und Vuelta. Wiederholbar; die Daten stehen in `src/data/season2027.ts`, neu erzeugen mit `node scripts/season2027/build-sql.ts`.

Ohne die beiden Variablen läuft die App automatisch im Demo-Modus. Der Workflow *Keep-alive* pingt die Datenbank täglich, damit Supabase das Free-Projekt nicht pausiert.

## Ablauf je Rundfahrt (Admin-Bereich in der App)

1. **Etappen:** 21 Etappen mit Ruhetagen generieren, Startzeiten (= Tippschluss), Profil, Start/Ziel und km eintragen.
2. **Startliste:** PCS-Startliste kopieren und einfügen (oder `Nr;Name;Team` pro Zeile), Joker-Limit und „Best of the Rest“-Ausschluss setzen.
3. **Nach jeder Etappe:** kommt das Ergebnis automatisch (siehe [Automatische Ergebnisse](#automatische-ergebnisse)) – oder Top 10 von der PCS-Ergebnisseite einfügen, prüfen, *Veröffentlichen*.
4. **Bonuswertungen:** Zwischenstand für die Hochrechnung, nach Etappe 21 Endstand + *Endstand setzen*.

## Automatische Ergebnisse

Eine offizielle Schnittstelle von Giro, Tour oder Vuelta gibt es nicht. Der Workflow [`ergebnisse.yml`](.github/workflows/ergebnisse.yml) liest deshalb die Etappenseiten von procyclingstats.com (PCS) – höflich, mit höchstens ein paar Abrufen pro Lauf – und trägt ein:

- **Etappenergebnis** (Top 10), **Wertungsstände** nach der Etappe (Gesamt, Punkte, Berg, Nachwuchs), **Ausstiege** (DNF/DNS/OTL/DSQ → Fahrer nicht mehr tippbar)
- **Bonus-Zwischenstand** (Gesamt, Best of the Rest, Punkte, Berg, Nachwuchs, Team) – den Kämpferischsten Fahrer und den Endstand setzt weiter der Admin
- **Änderungen**: nachträgliche Jury-Entscheidungen bis 36 Stunden nach dem Start, verkürzte Etappen (Distanz), fehlende Start-/Zielorte; ein früherer Start als der Tippschluss oder ein verschobenes Datum wird als Warnung gemeldet (Tippschluss bleibt Sache des Admins)

Läuft an Renntagen alle 10 Minuten von 13 bis 22 Uhr, dazu morgens und vor dem Tippschluss. Außerhalb der Rundfahrten endet jeder Lauf nach einer Datenbankabfrage.

**Einrichtung:**

1. [`supabase/schema.sql`](supabase/schema.sql) im SQL Editor neu ausführen (Abschnitt 7 ist neu, bestehende Daten bleiben).
2. Supabase → *Project Settings → API Keys* → *Secret key* anlegen (`sb_secret_…`). In GitHub unter *Settings → Secrets and variables → Actions → Secrets* als `SUPABASE_SECRET_KEY` speichern. Der Schlüssel umgeht die Zugriffsregeln, gehört also nie in die App oder in eine Variable.
3. In der App: *Admin → Rundfahrten* das PCS-Kürzel prüfen (z. B. `giro-d-italia/2027`), dann *Admin → Automatische Ergebnisse* einschalten:
   - **Vorschlag** – Ergebnis wird eingetragen, der Admin prüft und veröffentlicht unter *Etappenergebnis*.
   - **Automatisch** – Ergebnis wird selbst veröffentlicht.

**Sicherheitsregeln:** Übernommen wird erst nach der Zielankunft (Start laut PCS + Siegerzeit, beim Zeitfahren frühestens 3½ Stunden nach dem Start), wenn mindestens 80 % der Starter im Ergebnis stehen und das Ergebnis 10 Minuten unverändert bleibt. Fehlt ein Fahrer der Top 10 in der Startliste, wird nichts veröffentlicht und der Lauf schlägt fehl (GitHub schickt dann eine Mail). Mannschaftszeitfahren bitte von Hand eintragen. Speichert der Admin ein Ergebnis von Hand oder zieht eine Veröffentlichung zurück, pausiert die Automatik für diese Etappe (fortsetzen unter *Automatische Ergebnisse*). Blockiert PCS den Abruf, steht das im Protokoll – dann wie bisher von Hand eintragen.

**Testen** – alles ohne echtes Rennen:

1. `npm test` prüft den Parser gegen echte, gekürzte PCS-Seiten (Sprint mit DNS und gestrichenem Platz, Bergetappe mit DNF, Mannschaftszeitfahren) und den ganzen Ablauf (Zielankunft, Stabilität, Jury-Änderung, Vorschlagsmodus, fehlender Fahrer, PCS-Sperre). `npm run test:db` prüft die Datenbankfunktion, Rechte und das Pausieren.
2. **PCS-Test:** *Actions → Ergebnisse → Run workflow → „Nur PCS-Test“* ruft eine echte vergangene Etappe ab und zeigt, was gelesen wurde. Läuft auch bei jedem Push, der `scripts/sync/` ändert – so merkt man sofort, ob PCS von GitHub aus erreichbar ist oder sein Layout geändert hat.
3. **Probelauf:** *Run workflow → „Probelauf“*, Rundfahrt `giro-2026`, Modus `auto`, *sofort* anhaken → die Zusammenfassung des Laufs zeigt für die Giro-2026-Testrunde, was übernommen würde. Gespeichert wird nichts.
4. **Generalprobe:** [`supabase/sync_generalprobe.sql`](supabase/sync_generalprobe.sql) ausführen. Dann übernimmt der Workflow statt pg_cron die Testrunde und holt jeden Tag das echte Giro-2026-Ergebnis von PCS – etwa zur damaligen Zielankunft, mit Ausstiegen und Wertungen. Verlauf in der App unter *Automatische Ergebnisse*.
5. Lokal: `pip install -r scripts/sync/requirements.txt`, dann `npm run sync -- --pcs race/giro-d-italia/2026/stage-7` (nur PCS), `--datei seite.html` (gespeicherte Seite), mit `SUPABASE_URL` und `SUPABASE_SECRET_KEY` auch `npm run sync -- --probelauf --jetzt 2026-11-02T17:30`.

**Zum Abruf:** PCS steht hinter Cloudflare und sperrt Anfragen von Servern mit Node-`fetch` oder `curl` (HTTP 403). Mit dem TLS-Fingerabdruck eines Browsers über das Python-Paket [curl_cffi](https://github.com/lexiforest/curl_cffi) kommt die Seite – der Workflow installiert es selbst. Ändert PCS den Seitenaufbau (zuletzt Anfang 2026), schlägt der PCS-Test fehl, bevor falsche Daten in die App kommen; der Parser liest derzeit den aktuellen und den vorherigen Aufbau.

GitHub schaltet Zeitpläne in Repos ohne Aktivität nach 60 Tagen ab – vor einer Rundfahrt unter *Actions → Ergebnisse* prüfen und gegebenenfalls wieder einschalten.

## Entwicklung

```bash
npm install
npm run dev        # baut und startet http://localhost:5173 (Demo-Modus ohne Supabase-Variablen)
npm test           # Punkteberechnung und PCS-Import
npm run typecheck
npm run test:db    # Schema + RLS gegen ein lokales PostgreSQL (PGHOST/PGPORT/PGUSER setzen)
```

Demo-Parameter: `?demo` (eingeloggt), `?demo=login`, `?demo=join`, `&demotime=2027-05-16T15:00` (Demo-Uhr).
UI-Check mit Playwright (lokal, falls installiert): `node scripts/build.mjs && node scripts/ui-check.mjs` – prüft alle Seiten auf 320–1440 px in Hell und Dunkel auf abgeschnittenen Text, horizontales Scrollen und verdeckte Inhalte (parallel, etwa 5 Minuten). Schneller: `--quick` (3 Größen, nur dunkel, etwa 1 Minute), `--only=game` (Seitennamen enthalten), `--vp=390`, `--theme=dark`; `--shots` speichert Screenshots. Das Minispiel läuft dabei ohne 3D (`?nogl`, mit `--shots` in winziger Auflösung `?lowgfx`), Countdown und Sturz rechnet der Check direkt durch.

### Aufbau

- `supabase/schema.sql` – Tabellen, Trigger (Joker-Limit, Fahrer-Prüfung), RPCs und Row Level Security
- `src/data/supabase.ts` – schlanker Client für Supabase Auth + PostgREST (keine Zusatzpakete)
- `src/data/demo.ts` – Demo-Modus mit denselben Regeln im Speicher
- `src/lib/scoring.ts` – Punkteberechnung (Etappen, Außenseiter-Bonus, Bonuswertungen, Rangliste)
- `src/lib/pcsParse.ts` – Einlesen kopierter Startlisten und Ergebnisse von procyclingstats.com
- `scripts/sync/` – automatische Ergebnisse: `pcs.ts` (Etappenseite lesen), `plan.ts` (was wird übernommen), `sync.ts` (Ablauf), `run.ts` (Kommandozeile), Testseiten in `fixtures/`
- `src/pages/` – Screens, `src/pages/admin/` – Admin-Bereich
- Build: esbuild (`scripts/build.mjs`), Deploy: `.github/workflows/deploy.yml`

**Minispiel „Abfahrt“** (`#/spiel`, Karte unten auf der Startseite): Passabfahrt in echtem 3D mit WebGL (three.js, mitgeliefert in `vendor/three/`, Code in `src/game/abfahrt/`). Steuerung mit einem Daumen: seitlich ziehen lenkt, hoch schieben duckt (schneller), runter ziehen bremst; vor Kehren hilft ein Bremsassistent, die ersten drei Läufe erklärt ein kurzes Tutorial. Zuschauer sind instanzierte 3D-Menschen mit Fahnen, Pappschildern (auch mit Namen der Runde) und erfundenen Werbebanden. Jeden Tag eine neue Strecke für alle (Pass → Almen → Bergwald → Dorf → See oder Weinberge, dann Tunnel zum nächsten Pass); sie führt nie über oder unter sich selbst hindurch (Serpentinen wandern in eine Richtung, offene Abschnitte folgen ihr). Die Landschaft ist ein durchgehendes Höhenfeld in drei Detailstufen (`terrain3d.ts`) mit Tälern, Seen, Bergen über jedem Tunnel und Gipfeln ringsum, Felsschichten an steilen Flächen und Sonnenschatten im Nahbereich. Gegner mit Windschatten, Kehren, Kuppen mit Sprüngen, Kühe und Steinschlag, Kombo-Multiplikator, drei Tagesaufgaben und Ränge nach Gesamtstrecke. Bestmarken der Runde stehen als Torbögen an der Strecke. Gespeichert wird je Lauf Punktzahl und Strecke in `game_scores`; `game_leaderboard(game, since)` liefert Heute- und Saisonwertung.

**Höhenprofile:** Unter *Admin → Etappen → Höhenprofile (GPX)* lassen sich GPX-Strecken für alle Etappen auf einmal hochladen (Etappennummer aus dem Dateinamen). Die App zeigt dann das echte Höhenprofil, nach Steigung eingefärbt, und in jedem Anstieg die Steigung je Kilometer.

**Roadbook-Daten (Giro 2026):** `scripts/giro2026/roadbook.json` stammt aus den Durchfahrtstabellen des offiziellen Roadbooks (`pdftotext -layout` + `roadbook_extract.py`): rund 730 Durchfahrtsorte mit Kilometer und Höhe, alle Bergwertungen mit Gipfelhöhe, Zwischensprints, Red Bull KM und Verpflegungszonen. Daraus entstehen die Höhenprofile in `seed_giro2026.sql`. Strecken- und Finaltexte sind in `texts.de.json` übersetzt. Ein später hochgeladenes GPX ersetzt die Profilpunkte, die Durchfahrtsorte bleiben.
