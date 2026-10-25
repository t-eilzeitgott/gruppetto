# gruppetto.

Das Grand-Tour-Tippspiel für eure Runde: Giro, Tour und Vuelta – ein Tipp pro Etappe, Bonustipps vor dem Start, Live-Rangliste. Mobile first als Web-App (PWA) auf GitHub Pages, mit Supabase als Datenbank und Login.

**App:** https://t-eilzeitgott.github.io/gruppetto/
**Demo mit Beispieldaten:** https://t-eilzeitgott.github.io/gruppetto/?demo

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
7. Optional zum Testen: [`supabase/seed_testrunde.sql`](supabase/seed_testrunde.sql) legt eine Testrunde mit 5 Etappen ab morgen an.

Ohne die beiden Variablen läuft die App automatisch im Demo-Modus. Der Workflow *Keep-alive* pingt die Datenbank täglich, damit Supabase das Free-Projekt nicht pausiert.

## Ablauf je Rundfahrt (Admin-Bereich in der App)

1. **Etappen:** 21 Etappen mit Ruhetagen generieren, Startzeiten (= Tippschluss), Profil, Start/Ziel und km eintragen.
2. **Startliste:** PCS-Startliste kopieren und einfügen (oder `Nr;Name;Team` pro Zeile), Joker-Limit und „Best of the Rest“-Ausschluss setzen.
3. **Nach jeder Etappe:** Top 10 von der PCS-Ergebnisseite einfügen, prüfen, *Veröffentlichen*.
4. **Bonuswertungen:** Zwischenstand für die Hochrechnung, nach Etappe 21 Endstand + *Endstand setzen*.

## Entwicklung

```bash
npm install
npm run dev        # baut und startet http://localhost:5173 (Demo-Modus ohne Supabase-Variablen)
npm test           # Punkteberechnung und PCS-Import
npm run typecheck
npm run test:db    # Schema + RLS gegen ein lokales PostgreSQL (PGHOST/PGPORT/PGUSER setzen)
```

Demo-Parameter: `?demo` (eingeloggt), `?demo=login`, `?demo=join`, `&demotime=2027-05-16T15:00` (Demo-Uhr).
UI-Check mit Playwright (lokal, falls installiert): `node scripts/build.mjs && node scripts/ui-check.mjs [--shots]` – prüft alle Seiten auf 320–1440 px in Hell und Dunkel auf abgeschnittenen Text, horizontales Scrollen und verdeckte Inhalte.

### Aufbau

- `supabase/schema.sql` – Tabellen, Trigger (Joker-Limit, Fahrer-Prüfung), RPCs und Row Level Security
- `src/data/supabase.ts` – schlanker Client für Supabase Auth + PostgREST (keine Zusatzpakete)
- `src/data/demo.ts` – Demo-Modus mit denselben Regeln im Speicher
- `src/lib/scoring.ts` – Punkteberechnung (Etappen, Außenseiter-Bonus, Bonuswertungen, Rangliste)
- `src/lib/pcsParse.ts` – Einlesen kopierter Startlisten und Ergebnisse von procyclingstats.com
- `src/pages/` – Screens, `src/pages/admin/` – Admin-Bereich
- Build: esbuild (`scripts/build.mjs`), Deploy: `.github/workflows/deploy.yml`
