# Swertz Dispo

Dispositions-Programm für alle Swertz-Standorte: Aufträge, Baustellen, Tourenplanung, Wochenplan, Fuhrpark, Vorschläge zwischen Standorten.

- `index.html` – das komplette Programm (eine Datei)
- `CLAUDE.md` – Projektwissen und Regeln für Claude Code

Stand: Prototyp aus Claude (November 2026). Der Umzug auf eine eigene Datenbank (Supabase) mit Login pro Standort ist vorbereitet:

- `docs/SUPABASE-EINRICHTUNG.md` – Schritt-für-Schritt-Anleitung (alles im Browser)
- `supabase/` – Datenbank mit Zugriffsregeln, Test, Server-Funktionen für Scan und TomTom
- `cloud-config.js`, `swertz-cloud.js`, `sw-blob.js` – Anschluss des Programms an Supabase
- `uebernahme.html` – Übernahme der alten Daten (nur Zentrale)

Solange `cloud-config.js` leer ist, läuft das Programm unverändert wie bisher.
