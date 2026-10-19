# Timer-Bridge für Companion / Stream Deck

Cloudflare Worker, der die zwei Timer auf timer.itsblue.de per einfacher HTTP-Adresse steuerbar macht –
mit derselben Logik wie die Steuerseite im Modus **„Optimiert Lead“**.

Adresse: `https://timer-bridge.weiser-jannik.workers.dev/<SCHLÜSSEL>/…`
Der Schlüssel steht nicht in diesem (öffentlichen) Repo, sondern nur als Secret bei Cloudflare.

## Befehle

`<timer>` ist `A`, `B` oder `beide`.

| Adresse | Wirkung |
|---|---|
| `<timer>/reset` | Zurück auf Anfang, Uhr steht |
| `<timer>/start` | Vorbereitung starten (hält danach automatisch an) |
| `<timer>/klettern` | Kletterzeit starten (auch direkt aus Reset) |
| `<timer>/startpause` | Start/Fortsetzen bzw. Pause im Wechsel |
| `<timer>/pause`, `<timer>/fortsetzen` | Pause / Fortsetzen einzeln |
| `<timer>/segment` | Beim Klettern: weiter zu Rot bzw. ans Ende |
| `<timer>/neustart` | Normaler ITsBlue-Neustart ohne Haltepunkte |
| `A/status`, `B/status` | JSON mit Phase, Zeit, Segment, Farbe |
| `A/zeit`, `A/phase` | Nur Zeit bzw. Phase als Text |
| `A/taste.png`, `B/taste.png` | Live-Bild für eine Stream-Deck-Taste |

## Einrichtung in Companion

1. **Connections → Add connection → „Generic: HTTP Requests“**
   - Base URL: `https://timer-bridge.weiser-jannik.workers.dev/<SCHLÜSSEL>/`
2. **Steuertaste** (z. B. „A Reset“): Taste anlegen → *Press actions* → `http: GET` → URI `A/reset`.
   Für alle weiteren Tasten genauso, nur mit anderer URI (siehe Tabelle).
3. **Live-Taste** (zeigt Farbe, Phase und Restzeit): Taste anlegen, Text leer lassen →
   *Feedbacks* → `http: Image from URL` → URI `A/taste.png`, **Poll Interval 1000** (ms).
   Tipp: Live-Taste und Start/Pause zusammenlegen – die Live-Taste bekommt zusätzlich die Press action `A/startpause`.

### Vorschlag für ein 15er Stream Deck

| | | | | |
|---|---|---|---|---|
| **A Live** (Bild A, Druck: `A/startpause`) | A Reset | A Klettern ▶ | A Segment ⏭ | Beide Reset |
| **B Live** (Bild B, Druck: `B/startpause`) | B Reset | B Klettern ▶ | B Segment ⏭ | Beide Pause |
| A Start | B Start | | | Beide Fortsetzen |

## Kosten / Grenzen (Cloudflare Workers Free)

- 100.000 Anfragen pro Tag (Neustart der Zählung um 00:00 UTC), keine Kosten ohne hinterlegte Zahlungsdaten.
- Jede Live-Taste mit 1 s Poll-Intervall = 3.600 Anfragen pro Stunde. Zwei Live-Tasten reichen für ca. 13 Stunden am Tag;
  mit 2000 ms Intervall für den ganzen Tag. Companion nicht tagelang mit Live-Tasten laufen lassen.

## Pflege

```bash
npx wrangler@4 deploy                         # Code-Änderungen hochladen
npx wrangler@4 secret put TIMER_A_ID          # Timer wechseln (ebenso TIMER_A_PASSWORD, TIMER_B_…)
npx wrangler@4 secret put BRIDGE_KEY          # Schlüssel ändern (dann auch in Companion anpassen)
```
