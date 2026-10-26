# Testseiten von procyclingstats.com

Echte Etappenseiten, gekürzt auf das, was der Parser liest: Titel, Reiter, je Wertung die
ersten 12 Plätze plus alle Zeilen ohne Platz (DNF, DNS, gestrichene Plätze) und die
„Race information“. Der HTML-Aufbau bleibt dabei unverändert.

| Datei | Warum |
| --- | --- |
| `tour-de-france-2022-stage-21.html` | Sprintetappe, drei DNS, nachträglich gestrichene Plätze (Quintana) |
| `tour-de-france-2018-stage-19.html` | Bergetappe mit Ausstieg (DNF), Reiter in anderer Reihenfolge |
| `tour-de-france-2018-stage-3.html` | Mannschaftszeitfahren (eigene Ergebnisliste je Team) |

Quelle: die Test-Fixtures des Python-Pakets [procyclingstats](https://github.com/themm1/procyclingstats)
(Stand März 2026, also das aktuelle PCS-Layout).

Neue Seite aufnehmen, z. B. aus dem Artefakt eines Sync-Laufs (`pcs-seiten`):

```bash
python3 scripts/sync/fixtures/trim.py rohseite.html scripts/sync/fixtures/giro-d-italia-2027-stage-7.html
```
