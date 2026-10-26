# Testseiten von procyclingstats.com

Echte Etappenseiten, gekürzt auf das, was der Parser liest: Titel, Reiter, je Wertung die
ersten 12 Plätze plus alle Zeilen ohne Platz (DNF, DNS, gestrichene Plätze) und die
„Race information“. Der HTML-Aufbau bleibt dabei unverändert.

Aktueller Seitenaufbau (abgerufen im Oktober 2026 von einem GitHub-Runner):

| Datei | Warum |
| --- | --- |
| `giro-d-italia-2026-stage-7.html` | Bergankunft, alle Wertungen, Startzeit 10:55 |
| `giro-d-italia-2026-stage-10.html` | Einzelzeitfahren, Zeiten mit Hundertstel |
| `giro-d-italia-2026-stage-14.html` | Ausstieg (DNF) |
| `giro-d-italia-2026-stage-21.html` | Schlussetappe, Nichtstarter (DNS) |

Älterer Aufbau (bis Anfang 2026, aus den Test-Fixtures des Python-Pakets
[procyclingstats](https://github.com/themm1/procyclingstats)) – der Parser liest beide:

| Datei | Warum |
| --- | --- |
| `tour-de-france-2022-stage-21.html` | Sprintetappe, drei DNS, nachträglich gestrichene Plätze (Quintana) |
| `tour-de-france-2018-stage-19.html` | Bergetappe mit Ausstieg (DNF), Reiter in anderer Reihenfolge |
| `tour-de-france-2018-stage-3.html` | Mannschaftszeitfahren (eigene Ergebnisliste je Team) |

Neue Seite aufnehmen, z. B. aus dem Artefakt eines manuellen Sync-Laufs (`pcs-seiten`) oder mit
`python3 scripts/sync/fetch_pcs.py URL seite.html` (braucht `pip install -r scripts/sync/requirements.txt`):

```bash
python3 scripts/sync/fixtures/trim.py rohseite.html scripts/sync/fixtures/giro-d-italia-2027-stage-7.html
```
