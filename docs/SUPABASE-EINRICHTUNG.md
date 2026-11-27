# Swertz Dispo auf Supabase einrichten – Schritt für Schritt

Diese Anleitung führt durch die Einrichtung. Alles geht im Browser, es muss nichts installiert werden.
Die technischen Teile (Datenbank, Zugriffsregeln, Server-Funktionen, Anschluss des Programms) sind
fertig vorbereitet und getestet. Sie müssen sie nur an der richtigen Stelle einfügen.

> **Wichtig vorab:** Erst einrichten, wenn Geschäftsführung, IT und Datenschutz zugestimmt haben
> (Auftragsverarbeitungsvertrag mit Supabase, Speicherort Frankfurt).

**Was Sie brauchen:** eine Firmen-E-Mail-Adresse, Zugang zu diesem GitHub-Projekt und etwa 1–2 Stunden Zeit.
Für Schritt 5 brauchen Sie außerdem einen Anthropic-Schlüssel (Texterkennung) und einen TomTom-Schlüssel.

**Die drei goldenen Regeln:**
1. Den **„service_role“-Schlüssel** von Supabase niemals weitergeben: nicht im Chat, nicht per E-Mail, nicht im Code.
2. Den **Anthropic-** und den **TomTom-Schlüssel** nur in Supabase unter „Secrets“ eintragen, nirgendwo sonst.
3. Das **Datenbank-Passwort** aus Schritt 1 im Passwort-Manager der Firma speichern.

---

## Schritt 1 – Supabase-Konto und Projekt anlegen

1. Öffnen Sie **supabase.com** und klicken Sie auf **„Start your project“**. Melden Sie sich mit der **Firmen-E-Mail-Adresse** an.
2. Schalten Sie sofort die **Zwei-Faktor-Anmeldung** ein: Klicken Sie oben rechts auf Ihr Profilbild → **„Account preferences“** → **„Security“** → **„Multi-factor authentication“**, dann den Anweisungen mit der Handy-App folgen.
3. Klicken Sie auf **„New project“**:
   - **Name:** `swertz-dispo`
   - **Database Password:** auf **„Generate a password“** klicken und das Passwort im Passwort-Manager speichern.
   - **Region:** **„Central EU (Frankfurt)“**
   - **Plan:** für den Echtbetrieb **Pro**, wegen der täglichen Sicherungskopien.
4. Klicken Sie auf **„Create new project“** und warten Sie etwa 2 Minuten.
5. **Auftragsverarbeitungsvertrag:** Den AVV (englisch „DPA“) fordern Sie in Supabase unter **Organisation** → **„Settings“** → **„Legal Documents“** an. Diesen Schritt übernimmt meist der Datenschutzbeauftragte.

## Schritt 2 – Datenbank einrichten

1. Klicken Sie links im Supabase-Menü auf **„SQL Editor“** und dann auf **„New query“**.
2. Öffnen Sie in GitHub die Datei [`supabase/schema.sql`](../supabase/schema.sql) und klicken Sie dort oben rechts auf **„Copy raw file“** (Symbol mit zwei Rechtecken).
3. Fügen Sie den Text im SQL Editor ein (Strg+V) und klicken Sie unten rechts auf **„Run“**.
   Unten sollte **„Success“** stehen. Das Skript kann man gefahrlos auch mehrmals ausführen.
4. **Test der Zugriffsregeln:** Klicken Sie auf **„New query“**, kopieren Sie die Datei
   [`supabase/tests/zugriff_test.sql`](../supabase/tests/zugriff_test.sql) hinein und klicken Sie auf **„Run“**.
   Unten muss **„ALLE TESTS BESTANDEN“** stehen. Der Test hinterlässt keine Daten.

Damit gibt es Tabellen für Standorte, Nutzer, Fahrzeuge, Baustellen, Aufträge, Touren, Vorschläge und Sperren.
Außerdem gibt es einen geschützten Speicher **„lieferscheine“** mit einem Ordner pro Standort.

## Schritt 3 – Anmeldung einstellen

1. Klicken Sie links auf **„Authentication“** → **„Sign In / Providers“** (je nach Version auch **„Providers“**).
2. **„Email“** muss eingeschaltet sein.
3. **Ganz wichtig:** Schalten Sie **„Allow new users to sign up“** **aus**. Dann kann sich niemand selbst ein Konto anlegen, nur Sie legen Nutzer an.
4. Unter **„Authentication“** → **„URL Configuration“** tragen Sie später, nach Schritt 7, die Adresse der Seite ein, zum Beispiel `https://swertz-dispo.netlify.app`:
   - bei **„Site URL“**
   - und zusätzlich bei **„Redirect URLs“**

## Schritt 4 – Nutzer anlegen und Standorten zuordnen

1. Klicken Sie auf **„Authentication“** → **„Users“** → **„Add user“** → **„Send invitation“**, geben Sie die E-Mail-Adresse der Person ein und klicken Sie auf **„Invite“**.
   Die Person bekommt eine E-Mail und legt beim ersten Öffnen ihr eigenes Passwort fest (mindestens 10 Zeichen).
2. Ordnen Sie danach den Standort zu: Klicken Sie links auf **„Table Editor“** → Tabelle **„profile“** und doppelklicken Sie in der Zeile der Person in die Zelle:
   - **standort:** das Kürzel des Standorts, siehe Tabelle unten
   - **rolle:** `standort` für einen Standort, `zentrale` für die Disposition, die alles sieht
   - **name:** der Name, der im Programm angezeigt wird, zum Beispiel „Max Mustermann“
   - zum Schluss auf **„Save“** klicken.

| Kürzel | Standort |
|---|---|
| `moe` | Moers |
| `goc` | Goch |
| `kle` | Kleve |
| `emm` | Emmerich |
| `vie` | Viersen |
| `str` | Straelen |
| `gel` | Geldern |

Wer noch keinen Standort hat, sieht nach der Anmeldung nur den Hinweis „Noch kein Standort“ und **keine Daten**.
Jede Person bekommt ein **eigenes** Konto. Ein gemeinsames Konto für mehrere Personen bitte nicht anlegen.

## Schritt 5 – Server-Funktionen für Scan und TomTom

Beide Funktionen laufen bei Supabase. Die Schlüssel bleiben dort und erscheinen nie im Programm.

**a) Schlüssel besorgen**
- **Anthropic** (für den Lieferschein-Scan): Auf **console.anthropic.com** ein **Firmenkonto** anlegen und eine Zahlungsart hinterlegen. Dann unter **„API Keys“** → **„Create Key“** einen Schlüssel erzeugen und ihn direkt im nächsten Schritt in Supabase einfügen.
- **TomTom** (Karte, Routen, Verkehr): Auf **developer.tomtom.com** ein Konto anlegen und unter **„Dashboard“** → **„Keys“** einen Schlüssel erzeugen.

**b) Schlüssel in Supabase hinterlegen**
1. Klicken Sie auf **„Edge Functions“** → **„Secrets“** (je nach Version unter **„Project Settings“** → **„Edge Functions“**).
2. Legen Sie zwei Einträge an:
   - Name `ANTHROPIC_API_KEY`, Wert: der Anthropic-Schlüssel
   - Name `TOMTOM_API_KEY`, Wert: der TomTom-Schlüssel

**c) Funktionen anlegen** (zweimal, einmal pro Funktion)
1. Klicken Sie auf **„Edge Functions“** → **„Deploy a new function“** → **„Via Editor“**.
2. **Name:** `scan`. Ersetzen Sie den Beispieltext durch den Inhalt von [`supabase/functions/scan/index.ts`](../supabase/functions/scan/index.ts) und klicken Sie auf **„Deploy function“**.
3. Wiederholen Sie das mit dem **Namen** `tomtom` und dem Inhalt von [`supabase/functions/tomtom/index.ts`](../supabase/functions/tomtom/index.ts).
4. Bei beiden Funktionen muss unter **„Details“** die Einstellung **„Enforce JWT Verification“** (bzw. „Verify JWT“) **eingeschaltet** sein. Das ist die Grundeinstellung. Sie bewirkt, dass nur angemeldete Nutzer die Funktionen verwenden können.

## Schritt 6 – Programm mit Supabase verbinden

1. Kopieren Sie in Supabase unter **„Project Settings“** → **„API“** (bzw. **„Data API“** / **„API Keys“**) zwei Angaben:
   - die **Project URL**, zum Beispiel `https://abcdefgh.supabase.co`
   - den **„anon“ / „public“**-Schlüssel. Dieser Schlüssel ist öffentlich und darf ins Programm. **Nicht** den „service_role“-Schlüssel nehmen!
2. Öffnen Sie in GitHub die Datei [`cloud-config.js`](../cloud-config.js), klicken Sie auf den **Stift** („Edit this file“), tragen Sie beide Angaben zwischen die Anführungszeichen ein und klicken Sie auf **„Commit changes“**.
   Sie können mir die beiden Angaben auch im Chat geben, dann trage ich sie ein. Beide sind öffentlich.

## Schritt 7 – Seite ins Internet stellen (Netlify)

1. Öffnen Sie **app.netlify.com** und melden Sie sich mit GitHub an.
2. Klicken Sie auf **„Add new site“** → **„Import an existing project“** → **„GitHub“** und wählen Sie das Projekt **„swertz-dispo“**.
3. **Branch:** `main`. **Build command:** leer lassen. **Publish directory:** `.` (nur ein Punkt).
4. Klicken Sie auf **„Deploy“**. Nach etwa einer Minute ist die Seite unter einer Adresse wie `https://….netlify.app` erreichbar.
   Den Namen können Sie unter **„Site configuration“** → **„Change site name“** ändern, zum Beispiel in `swertz-dispo`.
5. Tragen Sie diese Adresse in Supabase bei Schritt 3, Punkt 4 ein.

Jede Änderung, die in GitHub auf `main` landet, geht ab jetzt automatisch online.
Später ist auch eine eigene Adresse wie `dispo.swertz.de` möglich: Netlify → **„Domain management“**.

## Schritt 8 – Alte Daten übernehmen

1. Die Daten aus dem bisherigen Claude-Artefakt (Fahrzeuge, Baustellen, Aufträge, Touren, Vorschläge) werden in eine Sicherungsdatei (JSON) exportiert.
   Dabei helfe ich Ihnen: Geben Sie mir den Link zum alten Artefakt.
2. Melden Sie sich in der neuen Seite **als Zentrale** an und öffnen Sie dann `https://<ihre-adresse>/uebernahme.html`.
3. Wählen Sie die Sicherungsdatei aus, prüfen Sie die angezeigten Zahlen und klicken Sie auf **„Jetzt übernehmen“**.
   Es werden nur fehlende Einträge ergänzt. Vorhandene Daten werden nie überschrieben oder gelöscht.

**Lieferschein-Dateien:** Die Fotos und PDFs, die im alten Artefakt angehängt sind, werden dabei **nicht** mit übertragen.
Wie mit den Lieferscheinen weiter verfahren wird, klären Sie noch. Der geschützte Speicher dafür ist bereits eingerichtet.

## Schritt 9 – Testwoche Moers

1. Legen Sie Konten für Moers (Rolle `standort`, Standort `moe`) und für die Zentrale an.
2. Moers arbeitet eine Woche **parallel**, also zusätzlich zum bisherigen Weg.
3. Prüfen Sie dabei besonders:
   - Sieht Moers wirklich nur Moers?
   - Kommen Vorschläge an einen anderen Standort an?
   - Funktionieren Scan, TomTom und das Speichern?
4. Danach folgen die übrigen Standorte.

---

## Gut zu wissen

- **„Angemeldet bleiben“:** Ist der Haken gesetzt, bleibt man auf diesem Gerät angemeldet. Ohne Haken endet die Anmeldung, wenn der Browser geschlossen wird.
- **Passwort vergessen:** Auf der Anmeldeseite auf **„Passwort vergessen?“** klicken. Es kommt eine E-Mail mit einem Link.
- **Was ein Standort sieht:** nur eigene Fahrzeuge, Touren, Aufträge und Baustellen. Dazu kommen Aufträge, die er an einen anderen Standort abgegeben hat, und Vorschläge, die an ihn gerichtet sind oder von ihm stammen. Während ein Vorschlag offen ist, sieht der Empfänger die vorgeschlagenen Aufträge bzw. die vorgeschlagene Tour, damit er entscheiden kann.
- **Die Zentrale** sieht und bearbeitet alles.
- **Baustellen** gehören dem Standort, der sie angelegt hat. Die Dubletten-Erkennung vergleicht deshalb nur innerhalb des eigenen Standorts.
- **Ohne ausgefüllte `cloud-config.js`** läuft das Programm wie bisher, also nur auf dem Gerät bzw. in Claude.
- **E-Mails (Einladung, Passwort vergessen):** Supabase verschickt von sich aus nur wenige E-Mails pro Stunde. Für den Betrieb mit allen Standorten sollte die IT einen eigenen E-Mail-Versand eintragen: **„Authentication“** → **„Emails“** → **„SMTP Settings“**.
- **Sicherungen:** Mit dem Pro-Tarif sichert Supabase die Datenbank täglich und hebt die Sicherungen 7 Tage auf („Database“ → „Backups“).

## Übersicht der Dateien

| Datei | Wofür |
|---|---|
| `supabase/schema.sql` | Datenbank: Tabellen, Zugriffsregeln, Dateispeicher |
| `supabase/tests/zugriff_test.sql` | Automatischer Test der Zugriffsregeln |
| `supabase/functions/scan/index.ts` | Lieferschein-Texterkennung (Anthropic-Schlüssel bleibt auf dem Server) |
| `supabase/functions/tomtom/index.ts` | TomTom: Adressen, LKW-Route, Verkehrslage (Schlüssel bleibt auf dem Server) |
| `cloud-config.js` | Die zwei öffentlichen Supabase-Angaben |
| `swertz-cloud.js` | Verbindet das Programm mit Supabase: Anmeldung, Speichern, Live-Abgleich |
| `sw-blob.js` | Zeigt geschützte Lieferschein-Dateien nur angemeldeten Nutzern an |
| `uebernahme.html` | Übernahme alter Daten (nur Zentrale) |
| `netlify.toml`, `vercel.json` | Einstellungen für das Hosting |
