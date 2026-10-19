# Stream-Deck-Relais (Companion ↔ timer.comptools.cloud)

Cloudflare Worker mit Durable Object, der Nachrichten zwischen der geöffneten Steuerseite
**timer.comptools.cloud** und **Bitfocus Companion** durchreicht. Die Timer steuert ausschließlich
die Website mit ihrer eigenen Anmeldung – im Relais liegen **keine Zugangsdaten**.

```
Stream Deck → Companion ──WebSocket──► Relais ──WebSocket──► Website (im Browser offen) ──► ITsBlue
             Beschriftungen ◄──────────────────────────────────┘
```

## Koppeln

1. Auf timer.comptools.cloud oben **„Stream Deck“** → Schalter **„Stream Deck koppeln“** einschalten.
   Die Seite erzeugt einen Koppelcode und zeigt die Companion-Adresse an (**„Adresse kopieren“**).
2. In Companion: **Connections → „streamdeck“ (Generic: WebSocket) → Target URL** = kopierte Adresse
   (`wss://timer-bridge.weiser-jannik.workers.dev/r/<KOPPELCODE>?role=companion`), *Reconnect* an, *Append new line* aus.
3. Die Website muss geöffnet bleiben. Es steuert immer nur eine Website; ein zweites Gerät mit demselben Code übernimmt.

„Neuen Code erzeugen“ macht den alten Code ungültig (Adresse in Companion danach ersetzen).

## Tasten (Stream Deck Mini, Companion-Seite 3)

| | | |
|---|---|---|
| **A Reset** (rot) | **A Start/Pause/Fortsetzen** (gelb) | **A Klettern/Segment** (grün) |
| **B Reset** (rot) | **B Start/Pause/Fortsetzen** (gelb) | **B Klettern/Segment** (grün) |

Jede Taste: *Press action* `streamdeck: Send generic command` mit `A:reset`, `A:toggle`, `A:skip` (bzw. `B:…`),
*Feedback* `streamdeck: Update variable with value from WebSocket message` mit JSON-Pfad `A.reset` usw. und
Variable `a_reset` usw.; Tastentext `$(streamdeck:a_reset)` usw.
Die Beschriftung entspricht den Buttons auf der Website (Modus „Optimiert Lead“ oder normal). Ist ein Button auf der
Website gesperrt, zeigt die Taste stattdessen den Status (z. B. „wartet auf Start“) und tut nichts.
Ohne verbundene Website zeigen alle Tasten „offline“.

## Protokoll

- Website → Relais: `{"type":"state","data":{"A":{"reset":"A\nReset","toggle":"A\nStart","skip":"A\nKlettern"},"B":{…}}}`
- Relais → Companion: das `data`-Objekt (plus `"online":"ja"`)
- Companion → Relais → Website: Text `A:reset` | `A:toggle` | `A:skip` | `B:…` | `beide:…`

## Kosten (Cloudflare Workers Free)

Die Website sendet nur bei Änderungen der Beschriftung; Pings werden ohne Aufwecken beantwortet.
Ein Wettkampftag bleibt weit unter den kostenlosen Grenzen.

## Pflege

```bash
npx wrangler@4 deploy        # Änderungen hochladen
npx wrangler@4 tail          # Live-Protokoll
```
