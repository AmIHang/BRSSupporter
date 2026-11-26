# BRSSupporter

Lokale Windows-App für Supporter zum Tracken und Analysieren von BSM-Tickets. Technik und Aufbau
wie BRSOrganizer und BRSDispatcher (pnpm-Monorepo, Node-Daemon, Tauri 2 + Svelte 5).

## Stand

- Der Daemon holt alle X Minuten (Einstellung, Standard 5) die Änderungen seit dem letzten Abruf
  über die BSM Personal API (`POST /personal/api/queryIndications`, Delta per
  `minChangeDateFilter`) und speichert sie in SQLite. Der erste Abruf, „Alles neu laden“ und ein
  geänderter Filter holen alles.
- Die App zeigt die Ticketliste mit denselben Filtern wie der BRSDispatcher (Kategorie Bug/CR/Frage,
  Status; standardmäßig nur Neu und In Bearbeitung). Projekte/Kunden lassen sich in den
  Einstellungen ausblenden und einfärben.
- In den Einstellungen gibt es je eine Anmeldung für BSM und für OTMA. Beide Konten müssen
  verschiedene E-Mail-Adressen haben.
- Wie im BRSDispatcher zeigt die Liste OTMA-Nummer und -Verantwortlichen, dazu den OTMA-Status
  (wird mit dem Verantwortlichen geholt). Alles geht mit dem BSM-Abruf alle X Minuten mit: Die
  OTMA-Nummer offener Tickets (Neu, In Bearbeitung) kommt über BSM (BSM-Konto); danach holt der
  Daemon Verantwortlichen und Status mit dem OTMA-Konto für **alle Tickets „In Bearbeitung“** und
  für **jedes Ticket, dessen BSM-Status sich geändert hat** (auch Neu → irgendwas). Dauert das
  länger als das Intervall, fällt der nächste Abruf aus.
- Tickets im Status „Neu“ lassen sich mit „Übernehmen“ dem BSM-Konto zuweisen.

## Anmeldung

Die Personal API hängt an der Cookie-Sitzung (Keycloak), daher läuft der Abruf wie in BRSOrganizer
über Edge – headless, je System ein eigenes Profil (`%LOCALAPPDATA%\BRSSupporter\edge-bsm`,
`edge-otma`), damit sich die Keycloak-Sitzungen der beiden Konten nicht mischen.

- Angemeldet wird **nur** mit dem in den Einstellungen hinterlegten Konto des Systems; ein Fenster
  für eine Anmeldung von Hand gibt es nicht. Ohne hinterlegtes Konto schlägt der Abruf fehl.
- Lehnt Keycloak das Konto ab, wird es nicht erneut versucht (Sperre), bis es neu gespeichert wird.
- Wird ein Konto gespeichert oder entfernt, verwirft BRSSupporter die Sitzung dieses Systems.

Benutzernamen und Passwörter liegen nur im Windows-Anmeldeinformationsspeicher (Dienst
`BRSSupporter`, Einträge `bsm-user`/`bsm-password` und `otma-user`/`otma-password`), nie in DB,
Dateien oder Logs; die REST-API gibt Passwörter nie heraus.

## Einstellungen

`%LOCALAPPDATA%\BRSSupporter\settings.json` (optional):

```json
{
  "bsmFilter": { "applicationFilter": "OTMA" },
  "syncIntervalMinutes": 5
}
```

`bsmFilter` wird unverändert an `queryIndications` übergeben. Namen müssen exakt passen, sonst
schlägt die Abfrage fehl. Standard ist `{}`: alle Tickets, egal welcher Status (erledigte nur der
letzten 30 Tage).

## Ports

Läuft neben BRSOrganizer (1420) und BRSDispatcher (1430 / 47900): Daemon `47910`, Vite `1440`.

## Entwicklung

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node packages/daemon/dist/main.js --allow-origin http://127.0.0.1:1440   # Daemon auf Port 47910
pnpm --filter @brssupporter/app tauri:dev                                 # App
```
