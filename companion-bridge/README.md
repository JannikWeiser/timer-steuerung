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
| **RESET beide** (1 s halten) | **Uhr Route 1** (Zeit, grün beim Klettern, rot im roten Segment) | **Uhr Route 2** |
| *(frei)* | **Nächster Schritt Route 1** | **Nächster Schritt Route 2** |

Die Schritt-Taste zeigt immer nur die eine sinnvolle Aktion (nur mit „Optimiert Lead“ AN):
**Start** (bereit) → **Klettern** (Vorbereitung läuft / wartet) → **Pause/Fall** (Kletterzeit läuft) → **Reset** (gestoppt oder Rundenende) → …
Farben: Start/Klettern grün, Pause/Fall orange, Reset rot, ohne Website grau.

Companion-Konfiguration: Variablen-Feedbacks (`streamdeck: Update variable…`) mit den JSON-Pfaden
`1.uhr`, `1.uhrfarbe`, `1.aktion`, `1.aktionfarbe` (bzw. `2.…`) → Variablen `r1_uhr`, `r1_farbe`, `r1_aktion`, `r1_akfarbe`;
Farben über `internal: Variable: Check value`. Befehle: `1:next`, `2:next`, `beide:reset` (als „Release after 1000ms“-Aktion).

## Protokoll

- Website → Relais: `{"type":"state","data":{"1":{"uhr":"Route 1\n05:32","uhrfarbe":"gruen","aktion":"Pause/\nFall","aktionfarbe":"pause"},"2":{…}}}`
- Relais → Companion: das `data`-Objekt (plus `"online":"ja"`)
- Companion → Relais → Website: Text `1:next` | `2:next` | `beide:reset` (außerdem `A/B:reset|toggle|skip`)

## Kosten (Cloudflare Workers Free)

Die Website sendet nur bei Änderungen der Beschriftung; Pings werden ohne Aufwecken beantwortet.
Ein Wettkampftag bleibt weit unter den kostenlosen Grenzen.

## Pflege

```bash
npx wrangler@4 deploy        # Änderungen hochladen
npx wrangler@4 tail          # Live-Protokoll
```
