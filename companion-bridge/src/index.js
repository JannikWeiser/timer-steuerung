// Stream-Deck-Relais für timer.comptools.cloud
//
// Reicht Nachrichten zwischen der geöffneten Steuerseite (role=web) und Bitfocus Companion
// (role=companion, Modul "Generic: WebSocket") durch. Die Timer selbst steuert ausschließlich
// die Website mit ihrer eigenen Anmeldung – hier liegen keine Zugangsdaten.
//
//   wss://timer-bridge.weiser-jannik.workers.dev/r/<KOPPELCODE>?role=web
//   wss://timer-bridge.weiser-jannik.workers.dev/r/<KOPPELCODE>?role=companion
//
// Website → Companion: Zustand als JSON, z. B. {"online":"ja","A":{"reset":"Reset","toggle":"Start","skip":"Klettern ▶"},"B":{…}}
// Companion → Website: Befehl als Text, z. B. "A:reset", "B:toggle", "beide:skip"

const CODE = /^[A-Za-z0-9]{12,64}$/;
const COMMAND = /^(A|B|beide):(reset|toggle|skip)$/i;
const OFFLINE = JSON.stringify({
  online: "nein",
  A: { reset: "A\noffline", toggle: "A\noffline", skip: "A\noffline" },
  B: { reset: "B\noffline", toggle: "B\noffline", skip: "B\noffline" },
});

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    // Keepalive der Website, ohne den Durable Object aufzuwecken (kostet nichts)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket erwartet.", { status: 426 });
    const role = new URL(request.url).searchParams.get("role") === "web" ? "web" : "companion";
    const [client, server] = Object.values(new WebSocketPair());

    if (role === "web") {
      // Nur eine Website steuert: eine neue Verbindung löst die alte ab (verhindert doppelte Befehle)
      for (const old of this.ctx.getWebSockets("web")) {
        try { old.send(JSON.stringify({ type: "replaced" })); old.close(4000, "Von anderem Gerät übernommen"); } catch {}
      }
    }
    this.ctx.acceptWebSocket(server, [role]);
    if (role === "companion") server.send(this.state());
    this.peers();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Meldet der Website, wie viele Companion-Instanzen verbunden sind
  peers(closing) {
    const companions = this.ctx.getWebSockets("companion").filter(w => w !== closing).length;
    for (const web of this.ctx.getWebSockets("web")) if (web !== closing) try { web.send(JSON.stringify({ type: "peers", companions })); } catch {}
  }

  state() {
    const web = this.ctx.getWebSockets("web")[0];
    return (web && web.deserializeAttachment()) || OFFLINE;
  }

  toCompanions(text) {
    for (const ws of this.ctx.getWebSockets("companion")) try { ws.send(text); } catch {}
  }

  webSocketMessage(ws, message) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (this.ctx.getTags(ws).includes("web")) {
      let m; try { m = JSON.parse(text); } catch { return; }
      if (m.type !== "state" || typeof m.data !== "object") return;
      const json = JSON.stringify({ ...m.data, online: "ja" });
      if (json.length > 1900) return;            // muss in den Anhang des Sockets passen (max. 2 KB)
      ws.serializeAttachment(json);
      this.toCompanions(json);
    } else {
      const cmd = text.trim();
      if (!COMMAND.test(cmd)) return;            // alles andere (z. B. Pings) ignorieren
      const web = this.ctx.getWebSockets("web")[0];
      if (web) web.send(JSON.stringify({ type: "cmd", cmd }));
    }
  }

  webSocketClose(ws) {
    if (this.ctx.getTags(ws).includes("web")) {
      if (this.ctx.getWebSockets("web").every(w => w === ws)) this.toCompanions(OFFLINE);
    } else this.peers(ws);
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}

export default {
  async fetch(request, env) {
    const [prefix, code] = new URL(request.url).pathname.split("/").filter(Boolean);
    if (!prefix) return new Response("Stream-Deck-Relais für timer.comptools.cloud läuft.");
    if (prefix !== "r" || !code || !CODE.test(code)) return new Response("Unbekannte Adresse.", { status: 404 });
    return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
  },
};
