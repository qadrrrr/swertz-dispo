# Swertz Dispo – Projektwissen für Claude

Antworte immer auf Deutsch. Der Nutzer heißt Qadr (Anrede „Guten Tag, Qadr“). Er arbeitet bei Swertz (Baustoff-Großhandel, mehrere Standorte am Niederrhein) und programmiert nicht selbst: Erkläre Schritte einfach, ohne Fachjargon, und nenne Klickwege genau.

## Was das Programm ist
Dispositions-Programm für alle Swertz-Standorte. Aktuell eine einzige Datei `index.html` (HTML, CSS und JavaScript in einer Datei, ca. 1600 Zeilen). Sie lief bisher als Claude-Artefakt und nutzt dort die Plattform-Schnittstellen `window.claude.use("db" | "user" | "assets" | "sample" | "mcp")`. Diese gibt es außerhalb von Claude NICHT – sie müssen beim Umzug ersetzt werden (siehe unten).

Funktionen (alle müssen erhalten bleiben):
- Heute-Übersicht (Kennzahlen, Warnungen, Karte), Wochenplan als Kalender mit Drag-and-drop, Live-Ansicht
- Zentrale Auftragsverwaltung (10 Status, Prüfgründe, Verlauf, Sperre gegen gleichzeitiges Bearbeiten)
- Baustellenverwaltung mit Dubletten-Erkennung, manueller Bestätigung und Baustellen-Notiz (erscheint als Vermerk)
- Tourenplaner in 6 Schritten: Hochladen, Aufträge prüfen, LKW wählen, Optimieren, Planung prüfen, Freigeben. Kosten: Diesel, Maut, Lohn. Abladezeit: erste Palette 15 Min. (Kran), jede weitere ca. 3 Min.
- Lieferschein-Scan mit Texterkennung durch Claude
- TomTom: Geokodierung, LKW-Route mit Live-Verkehr, Verkehrslage
- Fuhrpark pro Standort mit Verfügbarkeit und Terminen (Inspektion, HU/TÜV, SP, Wartung, UVV, Tacho …; Folgetermin automatisch)
- Standort-Anmeldung, Schalter „Nur mein Standort“, Vorschläge zwischen Standorten mit Meldung, Tour-Feedback (Smileys) und Tour-Notizen

## Feste Regeln des Nutzers
- Bestehende Funktionen vollständig erhalten. Nichts entfernen, keine komplette Neuentwicklung.
- Keine Daten löschen oder verlieren. Bestehende Logik nicht ersetzen, nur erweitern.
- Keine Knöpfe ohne Funktion. Navigation und Verknüpfungen erhalten.
- Demo-/Simulationsdaten nie als echte Aufträge behandeln.
- Kein automatisches Auswählen eines „passenden“ LKW: Kunden wissen immer, dass ein 26-t-LKW kommt.
- Design: Apple-Stil / Glassmorphism. Farben: Hintergrund #F5F6F8, Karten #FFFFFF, Blau #2878E5, Text #202124, grau #737780, Linien #E8EAED. Gut bedienbar für alle Altersgruppen (große Schrift, große Klickflächen).

## Standorte (Farben sind vorgegeben)
| id | Name | Adresse | Farbe |
|---|---|---|---|
| moe | Moers | Dr.-Berns-Straße 41, 47441 Moers | Gelb |
| goc | Goch | Weezer Str. 65b, 47574 Goch | Rot |
| kle | Kleve | Flutstr. 53-61, 47533 Kleve | Silber |
| emm | Emmerich | Albert-Einstein-Str. 5, 46446 Emmerich am Rhein | Weiß (mit grauem Rand) |
| vie | Viersen | Feldstr. 12, 41749 Viersen | Grau |
| str | Straelen | Annastraße 89-103, 47638 Straelen | Orange |
| gel | Geldern | Martinistr. 71, 47608 Geldern | Hellblau |

LKW: Moers 1, Goch 2, Kleve 1, Emmerich 1, Viersen 1, Straelen mehrere (vom Nutzer angelegt), Geldern noch keiner.
Ladeplan-Regel (Beispiel): Tour 1 lädt in Moers, weitere Touren können an anderen Standorten laden.

## Nächstes Ziel: Umzug auf eigene Datenbank (Supabase)
Grund: Jeder Standort soll sich mit eigenem Login anmelden und technisch nur seine eigenen Daten sehen (Zentrale sieht alles). Das ging im Claude-Artefakt nicht.

Plan:
1. Freigabe durch Geschäftsführung/IT (Firmen- und Kundendaten, Datenschutz, Auftragsverarbeitungsvertrag mit Supabase). Region: Frankfurt (eu-central-1).
2. Qadr legt das Supabase-Projekt an und gibt nur Projekt-URL und den öffentlichen „anon key“ weiter. Den „service_role“-Schlüssel niemals in den Code oder in den Chat.
3. Tabellen: standorte, profile (Nutzer → Standort, Rolle standort/zentrale), fahrzeuge (+ termine), baustellen (+ notiz), auftraege, touren (+ feedback, notizen), vorschlaege, sperren. Row Level Security: Standort-Nutzer lesen/schreiben nur Zeilen ihres Standorts; Vorschläge sind für Absender und Empfänger sichtbar; Zentrale alles.
4. Lieferschein-PDFs in Supabase Storage (privater Bucket, Ordner pro Standort).
5. In `index.html` die Speicher-Schicht austauschen (window.claude.use("db") → supabase-js), Login mit E-Mail und Passwort, „Angemeldet bleiben“ über die Supabase-Sitzung.
6. Scan-Erkennung: über eine Supabase Edge Function mit eigenem Anthropic-API-Schlüssel (Schlüssel nur als Secret in Supabase, nie im Frontend).
7. TomTom: eigener API-Schlüssel, ebenfalls über eine Edge Function.
8. Hosting: Netlify oder Vercel, verbunden mit diesem GitHub-Repository (alles im Browser einrichtbar, Qadr kann keine Software installieren).
9. Erst Moers eine Woche parallel testen, dann die anderen Standorte.
10. Bestehende Daten (Fahrzeuge, Baustellen, Aufträge) aus dem alten Claude-Artefakt übernehmen.

## Stand Supabase-Umzug (vorbereitet, noch nicht eingerichtet)
- Anleitung für Qadr: `docs/SUPABASE-EINRICHTUNG.md`.
- `supabase/schema.sql`: Tabellen je Dokument (`id`, `daten` jsonb; `sto`/`ursprung`/`von`/`an` per Trigger aus `daten`), RLS, Sperren-Funktion `sperre_holen`, Bucket `lieferscheine`. Test: `supabase/tests/zugriff_test.sql` (lokal mit `supabase_nachbildung.sql` vorab).
- `swertz-cloud.js` stellt `window.claude.use(...)` mit Supabase dahinter bereit (nur wenn `cloud-config.js` ausgefüllt und nicht in Claude). Die Programmlogik in `index.html` bleibt dadurch unverändert; dort nur: Skripte im `<head>`, Abmelden über `SW_CLOUD`, Standortwahl auf erlaubte Standorte begrenzt.
- Dateien: `/_blob/<pfad>` wird vom Service Worker `sw-blob.js` mit der Anmeldung aus dem privaten Bucket geholt (Seite muss im Wurzelverzeichnis der Domain liegen).
- Edge Functions `scan` (Anthropic, Secret `ANTHROPIC_API_KEY`) und `tomtom` (Secret `TOMTOM_API_KEY`) liefern dieselben Formate wie bisher in Claude.
- Offen: Lieferscheine (Klärung durch Qadr), Export der Altdaten aus dem Claude-Artefakt.

## Arbeitsweise
- Vor größeren Umbauten kurz den Plan erklären.
- Nach jeder Änderung prüfen, dass alle oben genannten Funktionen weiter gehen.
- Änderungen in kleinen, nachvollziehbaren Schritten (eigener Branch, dann Pull Request).
