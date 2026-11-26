# BRSSupporter – Handbuch

BRSSupporter ist eine Windows-App für Supporter: Sie zeigt alle BSM-Tickets in einer Liste, holt
dazu den Stand aus OTMA und aus dem TFS (Wiki, Releases, wer am Code arbeitet) und hält alles von
selbst aktuell. Sie läuft lokal auf deinem Rechner, mit deinen eigenen Konten.

> Dieses README ist das Handbuch der App und wird bei jeder Änderung mitgepflegt.

## Inhalt

1. [Installation und Updates](#installation-und-updates)
2. [Erster Start: Anmeldungen](#erster-start-anmeldungen)
3. [Die Ticketliste](#die-ticketliste)
4. [Ticket-Details](#ticket-details)
5. [Einstellungen](#einstellungen)
6. [Wie aktuell sind die Daten?](#wie-aktuell-sind-die-daten)
7. [Probleme und Meldungen](#probleme-und-meldungen)
8. [Wo liegen meine Daten?](#wo-liegen-meine-daten)
9. [Für Entwickler](#für-entwickler)

## Installation und Updates

1. Den Installer `BRSSupporter_<Version>_x64-setup.exe` von den
   [GitHub-Releases](https://github.com/AmIHang/BRSSupporter/releases) laden und starten. Er
   installiert nur für dich, Administratorrechte sind nicht nötig.
2. BRSSupporter starten. Im Hintergrund startet die App ihren Dienst (den „Daemon“), der die Daten
   abruft. Er läuft weiter, wenn das Fenster geschlossen ist, damit die Liste beim nächsten Öffnen
   schon aktuell ist.

**Updates:** Die installierte Version steht oben neben dem Titel (z. B. `v0.1.0`). Gibt es auf
GitHub eine neuere, erscheint oben der Hinweis „Neue Version … verfügbar“ – **Herunterladen** öffnet
die Release-Seite, dort den neuen Installer laden und starten. Er beendet den Dienst vorher selbst.
Deine Einstellungen und Anmeldungen bleiben erhalten.

## Erster Start: Anmeldungen

Ohne Anmeldung zeigt die Liste nichts. Unter **⚙ Einstellungen**:

| Abschnitt          | Was eintragen                                                                    |
| ------------------ | -------------------------------------------------------------------------------- |
| **BSM-Anmeldung**  | E-Mail/Benutzername und Passwort deines BSM-Kontos                               |
| **OTMA-Anmeldung** | E-Mail/Benutzername und Passwort deines OTMA-Kontos (für Verantwortliche/Status) |

- Beide Konten müssen **verschiedene E-Mail-Adressen** haben; dieselbe wird abgelehnt.
- BRSSupporter meldet sich **nur** mit diesen Konten an, im Hintergrund, ohne Fenster.
- Lehnt BSM/OTMA das Passwort ab, versucht es BRSSupporter **nicht** erneut (sonst würde das Konto
  gesperrt). Oben erscheint dann ein roter Hinweis – Passwort korrigieren und **Speichern**, dann
  geht es sofort weiter.
- Die Passwörter liegen nur im Windows-Anmeldeinformationsspeicher, nie in Dateien.

## Die Ticketliste

### Kopfzeile

- **Titel und Version**
- **Stand hh:mm:ss** – wann zuletzt abgerufen wurde
- **BSM-Sync fehlgeschlagen / OTMA-Sync fehlgeschlagen** – Fehlertext im Tooltip
- **📌** immer im Vordergrund, **⟳** jetzt abrufen, **⚙** Einstellungen

### Filter (drei Zeilen)

Jede Blase blendet ihren Wert per Klick aus oder wieder ein (ausgeblendet = blass und
durchgestrichen). Die Zahl in Klammern ist die Anzahl der Tickets.

| Zeile           | Filter                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kategorie**   | Bug / CR / Frage. Dahinter **Verteilt** mit drei Stufen pro Klick: alle → nur verteilte → nur nicht verteilte. _Verteilt_ = in OTMA einer Person zugewiesen (nicht „BRS Support“). |
| **BSM-Status**  | Neu, In Bearbeitung, Ausgeliefert, … – standardmäßig nur Neu und In Bearbeitung                                                                                                    |
| **OTMA-Status** | In Arbeit, Abgearbeitet, Freigegeben, Erledigt, Ohne OTMA-Status                                                                                                                   |

Die Filter gelten nur bis zum Neustart der App.

### Ein Ticket in der Liste

**Erste Zeile**

- **Ticketnummer** (in der Farbe des Kunden) – Klick öffnet das Ticket in BSM
- **OTMA 123456** – Klick öffnet das OTMA-Ticket
- **OTMA-Status**, zusammengefasst: Neu, Zugewiesen, Feedback, Bestätigt → _In Arbeit_;
  Abgearbeitet; Freigegeben; Geschlossen → _Erledigt_ (Originalwert im Tooltip)
- **BSM-Status** rechts
- **Übernehmen** (nur bei „Neu“): zwei Klicks – der erste fragt „Wirklich übernehmen?“, der zweite
  weist das Ticket in BSM deinem BSM-Konto zu. Hat es inzwischen jemand anderes übernommen, passiert
  nichts.

**Zweite Zeile:** Titel, rechts der **OTMA-Verantwortliche** als farbiger Chip. Bei einer Übergabe
(„HAM -> GRA“) steht der neue Verantwortliche da. „BRS Support“ gilt als niemand – dann gibt es
keinen Chip.

**Darunter:** Applikation · Kategorie · Bearbeiter in BSM, dann Erstellt/Geändert und rechts
**Details ▾**.

Blocker stehen immer oben und sind rot markiert, danach die zuletzt geänderten.

## Ticket-Details

**Details ▾** klappt pro Ticket auf:

| Zeile             | Inhalt                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Installation**  | Die betroffene Installation laut BSM (z. B. PROD, QS)                                                                                                                        |
| **TV**            | Technical Lead laut Wiki-Seite „Security Architecture“, daneben **Wiki** (öffnet das Projekt-Wiki)                                                                           |
| **Releases**      | Zuletzt releaste Version pro System mit Datum laut Wiki-Seite „Releases“. Das System der betroffenen Installation ist hervorgehoben; Klick öffnet den Build im TFS.          |
| **Aktiv (Monat)** | Wer in den letzten 31 Tagen auf den Standard-Branch (main/master) committet oder einen Pull-Request dorthin erstellt hat. Tooltip: Anzahl Commits, PRs und letzte Aktivität. |

TV, Wiki, Releases und Aktive gibt es nur, wenn für das Projekt oder den Kunden ein **Repo-Link**
hinterlegt ist (siehe [Projekte und Repo-Links](#projekte-und-repo-links)).

### Was das Wiki dafür braucht

- Eine Seite **„Security Architecture“** (beliebige Ebene) mit einer Tabellenzeile
  `| **Technical Lead** | @Person |`. Die Erwähnung darf im Wiki als Person (`@<…-ID>`) oder als
  Windows-Konto (`@<BOOM\gra>`) stehen; beides wird zu „Name (KÜRZEL)“. Normaler Text wird so
  übernommen.
- Eine Seite **„Releases“** mit je einer Überschrift pro System (`# PROD`, `# QS`, …) und darunter
  einer Tabelle mit den Spalten `Date` (JJJJ-MM-TT) und `Version`. Pro System zählt die Zeile mit dem
  neuesten Datum.

## Einstellungen

Über **⚙** oben rechts; **←** führt zurück zur Liste.

### Darstellung

**Design:** System (folgt Windows), Hell oder Dunkel.

### Abruf

- **BSM abfragen alle … Minuten** (Standard 5): so oft werden BSM und OTMA aktualisiert.
- **Alles neu laden:** holt einmal alle Tickets neu statt nur der Änderungen – hilft, wenn Tickets
  in der Liste stehen, die es nicht mehr gibt.

### Projekte und Repo-Links

Alle BSM-Projekte, gruppiert nach Kunde.

- **Haken** = Projekt ausblenden (seine Tickets erscheinen nicht). Der Haken beim Kunden blendet
  alle seine Projekte aus oder ein. Neue Projekte eines ganz ausgeblendeten Kunden kommen gleich
  ausgeblendet dazu.
- **Farbe** des Kunden für die Ticketnummer; **↺** zurück zur berechneten Farbe.
- **Repo-Link** des Kunden bzw. Projekts: der Git-Link im TFS, z. B.
  `https://tfs.boomsoftware.com/tfs/boom/_git/Northrail` (Kurzform erlaubt).
  - Beim Speichern prüft BRSSupporter den Link mit deiner Windows-Anmeldung, ergänzt das Projekt
    (gespeichert wird die vollständige Form `…/tfs/boom/Northrail/_git/Northrail`) und sucht das
    Wiki.
  - Daneben erscheinen **Wiki** und **TV**.
  - Ein Projekt ohne eigenen Link übernimmt den des Kunden (grau angezeigt).
  - Abgelehnt werden: TFVC-Links (`_versionControl`, alter Code), Links auf andere Server als
    `tfs.boomsoftware.com`, und Kurzformen, deren Repo-Name es in mehreren TFS-Projekten gibt (dann
    den vollständigen Link angeben).
  - Feld leeren entfernt den Link.

## Wie aktuell sind die Daten?

| Was                               | Wann                                                                      | Mit welchem Konto |
| --------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| BSM-Tickets (Änderungen)          | alle X Minuten (Einstellung, Standard 5), ⟳ sofort                        | BSM               |
| OTMA-Nummer                       | mit dem BSM-Abruf, für Tickets „Neu“ und „In Bearbeitung“                 | BSM               |
| OTMA-Verantwortlicher und -Status | mit jedem Abruf: alle Tickets „In Bearbeitung“ und jedes mit neuem Status | OTMA              |
| TV, Releases, Aktive              | beim Speichern des Repo-Links und stündlich                               | Windows-Anmeldung |
| Neue BRSSupporter-Version         | höchstens alle 6 Stunden                                                  | – (öffentlich)    |

Die Liste im Fenster lädt sich alle 15 Sekunden und beim Zurückkehren ins Fenster neu.

## Probleme und Meldungen

| Meldung                                          | Bedeutung / Abhilfe                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Daemon nicht erreichbar**                      | Der Dienst läuft (noch) nicht. Kurz nach dem Start normal; sonst die App schließen und neu öffnen. |
| **BSM: keine Anmeldung in den Einstellungen …**  | BSM-Anmeldung eintragen.                                                                           |
| **…-Anmeldung mit … fehlgeschlagen / abgelehnt** | Passwort falsch oder Konto gesperrt. In den Einstellungen korrigieren und speichern.               |
| **OTMA-Sync fehlgeschlagen**                     | OTMA nicht erreichbar oder OTMA-Anmeldung fehlt/falsch; die BSM-Liste ist trotzdem aktuell.        |
| **TV: nicht im Wiki (Security Architecture) …**  | Seite oder Zeile „Technical Lead“ fehlt im Wiki.                                                   |
| **Releases: keine im Wiki**                      | Seite „Releases“ fehlt oder hat keine Tabelle mit `Date`/`Version`.                                |
| **Kein TFS-Repo mit Wiki hinterlegt**            | Für Projekt und Kunde ist kein Repo-Link gespeichert.                                              |

Das Protokoll des Dienstes steht in `%LOCALAPPDATA%\BRSSupporter\logs\daemon.log`.

## Wo liegen meine Daten?

Alles in `%LOCALAPPDATA%\BRSSupporter`:

| Datei/Ordner            | Inhalt                                      |
| ----------------------- | ------------------------------------------- |
| `brssupporter.db`       | Tickets, Projekte, Repo-Links (SQLite)      |
| `settings.json`         | Abruf-Intervall und BSM-Filter              |
| `edge-bsm`, `edge-otma` | Edge-Profile für die BSM- bzw. OTMA-Sitzung |
| `logs\daemon.log`       | Protokoll des Dienstes                      |

Passwörter: nur im Windows-Anmeldeinformationsspeicher (Dienst `BRSSupporter`, Einträge
`bsm-user`/`bsm-password`, `otma-user`/`otma-password`).

**Nur für Fortgeschrittene:** In `settings.json` lässt sich festlegen, welche BSM-Tickets überhaupt
geholt werden. `bsmFilter` geht unverändert an die BSM-Abfrage `queryIndications`; Namen müssen
exakt passen. Standard `{}`: alle Tickets, erledigte nur der letzten 30 Tage.

```json
{
  "bsmFilter": { "applicationFilter": "OTMA" },
  "syncIntervalMinutes": 5
}
```

## Für Entwickler

pnpm-Monorepo wie BRSOrganizer und BRSDispatcher, Konventionen in [CLAUDE.md](CLAUDE.md).

| Paket             | Aufgabe                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `packages/core`   | SQLite (Drizzle), Schema, BSM-Sync, OTMA-Abgleich                    |
| `packages/daemon` | REST-API für die App, Abruf, BSM/OTMA über Edge, TFS über PowerShell |
| `packages/app`    | Tauri 2 + Svelte 5; startet im Release den mitgelieferten Daemon     |

Ports (laufen neben BRSOrganizer 1420 und BRSDispatcher 1430/47900): Daemon `47910`, Vite `1440`.

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node packages/daemon/dist/main.js --allow-origin http://127.0.0.1:1440   # Daemon auf Port 47910
pnpm --filter @brssupporter/app tauri:dev                                 # App (baut vorher die Runtime)
pnpm --filter @brssupporter/app tauri:build                               # Installer wie in der Action
```

`tauri dev` startet keinen Daemon (der von Hand gestartete wird benutzt); nur die installierte App
startet den mitgelieferten (`src-tauri/src/daemon.rs`, Runtime aus `scripts/build-sidecar.mjs`).

**Release:** Tag `v<Version>` pushen (z. B. `git tag v0.1.0 && git push origin v0.1.0`). Die
GitHub Action `build-installer.yml` prüft (Lint, Typecheck, Tests), baut den Installer mit der
Version aus dem Tag und veröffentlicht das Release. Ohne Tag lässt sie sich von Hand starten (nur
Artefakt, kein Release).
