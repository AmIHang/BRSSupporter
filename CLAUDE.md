# BRSSupporter – Projektkonventionen

Lokale Windows-App für Supporter: BSM-Tickets tracken und analysieren. Aufbau und Stil folgen
BRSOrganizer (`C:\projects-git\AmINeeded\AmINeeded`) und BRSDispatcher
(`C:\projects-git\BRSDispatcher\BRSDispatcher`, daraus entstanden) – bei neuen Bausteinen (Sidecar,
Secret Store, MCP, SSE, OTMA-Abfragen) zuerst dort nachsehen und übernehmen.

## Aufbau (pnpm-Monorepo)

| Paket             | Aufgabe                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | SQLite (better-sqlite3 + Drizzle, WAL), Schema, BSM-Sync. **Einzige Stelle, die Daten ändert.**                                                                                                 |
| `packages/daemon` | REST-API für die UI, periodischer Sync, BSM-Zugriff über Edge (playwright-core). Nur `127.0.0.1`.                                                                                               |
| `packages/app`    | Tauri 2 + Svelte 5. Spricht nur über REST mit dem Daemon (`src/lib/api.ts`). Startet im Release den mitgelieferten Daemon (`src-tauri/src/daemon.rs`, Runtime aus `scripts/build-sidecar.mjs`). |

Abhängigkeitsrichtung: `app` → (HTTP) → `daemon` → `core`. Niemand außer `daemon` importiert `core`.

## BSM

- Abruf über die Personal API (`/personal/api/...`), Doku: OpenAPI „Boom Support Manager – Personal
  Indication API“. Login per Cookie-Sitzung, headless, je System eigenes Edge-Profil
  (`daemon/src/bsm-edge.ts`). **Nur** mit dem hinterlegten Konto des Systems (BSM bzw. OTMA), nie
  per Fenster; BSM- und OTMA-Konto dürfen nicht dieselbe E-Mail-Adresse haben.
- Netzwerkzugriff wird als `BsmFetch` in `core` injiziert; Tests laufen ohne Netz.

## Regeln

- **Sync ist idempotent:** ein zweiter Lauf mit identischem Snapshot ändert nichts.
- **Schlägt ein Abruf fehl, wird nichts geändert.** Nur ein vollständiger Snapshot (alle Seiten bis
  `limitExceeded = false`) darf Tickets als verschwunden (`gone_at`) markieren.
- **Kein hartes Löschen.**
- Externe Texte (Ticket-Titel) nur als Text rendern, nie `{@html}`.
- Secrets (BSM- und OTMA-Konto getrennt, je Benutzer und Passwort) nur im Windows Credential Manager (`SecretStore`),
  nie in DB, Logs, Config-Dateien oder REST-Antworten; das Passwort wird nur auf
  `auth.boomsoftware.com` eingetippt. Tests nutzen den `MemorySecretStore`.
- HTTP-Endpunkte prüfen `Host` und `Origin`.

## Handbuch

`README.md` ist das Handbuch für Anwender (Entwicklerteil am Ende). **Jede Änderung, die man in
der App sieht oder die ihr Verhalten ändert, aktualisiert das README im selben Commit** (Abschnitt
passend ergänzen, Tabellen „Wie aktuell sind die Daten?“ und „Probleme und Meldungen“ mitpflegen).

## Code-Stil

- TypeScript strict, ESM, `NodeNext`. Imports mit `.js`-Endung, Typ-Imports mit `import type`.
- Bezeichner, Kommentare und Commit-Messages auf Englisch; README und diese Datei auf Deutsch.
- Eingaben an Paketgrenzen mit `zod` validieren. Zeit über die injizierte `Clock`.
- Schemaänderungen: `src/db/schema.ts` ändern, dann `pnpm --filter @brssupporter/core db:generate`;
  generierte SQL-Dateien werden committet und nie nachträglich editiert.
- pnpm liegt unter `%APPDATA%\npm` und ist evtl. nicht im PATH der Shell.
