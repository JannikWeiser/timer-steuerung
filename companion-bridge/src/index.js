// Timer-Bridge für Bitfocus Companion / Stream Deck
// Läuft als Cloudflare Worker und steuert zwei Timer auf timer.itsblue.de
// mit derselben Logik wie die Steuerseite im Modus "Optimiert Lead".
//
// Adressen (KEY = geheimer Schlüssel aus BRIDGE_KEY):
//   /KEY/A/weiter | reset | start | klettern | pause | fortsetzen | startpause | segment | neustart
//   /KEY/B/...   /KEY/beide/...
//   /KEY/A/status        JSON mit Phase, Zeit, Farbe
//   /KEY/A/zeit          nur die Anzeige-Zeit als Text (z. B. "05:32")
//   /KEY/A/phase         nur die Phase als Text (z. B. "wartet auf Start")
//   /KEY/A/taste.png     Live-Bild für eine Stream-Deck-Taste
//
// Secrets (wrangler secret put …): BRIDGE_KEY, TIMER_A_ID, TIMER_A_PASSWORD, TIMER_B_ID, TIMER_B_PASSWORD

const API = "https://timer.itsblue.de/api";

// ---------- Zeitlogik (portiert von timer.itsblue.de, identisch zur Steuerseite) ----------
const roundTotal = t => t.segments.reduce((s, x) => s + x.time, 0);
function roundState(t, now) {
  let stopped = false;
  if (t.stop_at && t.stop_at < now) { now = t.stop_at; stopped = true; }
  const r = now - t.start_at, total = roundTotal(t);
  const pre = t.display_options?.pre_start_behaviour;
  if (r < 0 && pre === "ShowFirstSegment") return { inRound: 1, state: "waiting" };
  if (r < 0 && pre === "ShowLastSegment") return { inRound: total, state: "waiting" };
  if (!t.repeat && !stopped && r > total) return { inRound: total, state: "finished" };
  return { inRound: Math.floor(((r % total) + total) % total), state: stopped ? "stopped" : (r < 0 ? "waiting" : "running") };
}
function segmentAt(inRound, segments) {
  let e = inRound, n = 0, remaining = 0;
  while (e > 0) { remaining = Math.floor(segments[n].time - e); e -= segments[n].time; n++; }
  return { segment: segments[Math.max(n - 1, 0)], remaining };
}
function fmt(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; s %= 60;
  const p = v => String(v).padStart(2, "0");
  return h ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
const isFrozen = (t, now) => t.stop_at != null && t.stop_at <= now;
const elapsedIn = (t, now) => (isFrozen(t, now) ? t.stop_at : now) - t.start_at;
const leadElapsed = (t, now) => (t.stop_at == null ? roundState(t, now).inRound : elapsedIn(t, now));
// Haltepunkte 1 ms vor der Segmentgrenze (0 ms Laufzeit lässt das ITsBlue-Display abstürzen)
const prepEnd = t => t.segments[0].time - 1;
const roundEnd = t => roundTotal(t) - 1;

function leadPhase(t, now) {
  const e = leadElapsed(t, now), frozen = isFrozen(t, now);
  if (t.stop_at == null) return "climb";               // läuft normal ohne vorgemerkten Halt
  if (frozen && e <= 1) return "ready";
  if (e < t.segments[0].time) return frozen ? (e >= prepEnd(t) ? "prepDone" : "paused") : "prep";
  if (e < roundEnd(t)) return frozen ? "paused" : "climb";
  return "done";
}
const PHASE_TEXT = { ready: "bereit", prep: "Vorbereitung", prepDone: "wartet auf Start", paused: "pausiert", climb: "läuft", done: "beendet" };
const PHASE_SHORT = { ready: "BEREIT", prep: "VORBEREITUNG", prepDone: "WARTET", paused: "PAUSE", climb: "LÄUFT", done: "ENDE" };

// Aktionen: liefern die Änderungen für den Timer oder null (= nichts zu tun)
const ACTIONS = {
  reset: (t, now) => ({ start_at: now - 1, stop_at: now }),
  pause: (t, now) => (isFrozen(t, now) ? null : { stop_at: now }),
  fortsetzen: (t, now) => {
    if (!isFrozen(t, now)) return null;
    const e = t.stop_at - t.start_at, start_at = now - e;
    if (e >= roundEnd(t)) return null;                     // Runde beendet: nur Reset
    if (e >= prepEnd(t) && e < t.segments[0].time) return null; // wartet auf Start: nur "klettern" gibt frei
    return { start_at, stop_at: start_at + (e < prepEnd(t) ? prepEnd(t) : roundEnd(t)) };
  },
  klettern: (t, now) => {
    const e = leadElapsed(t, now);
    if (e >= t.segments[0].time) return null;            // Kletterzeit läuft schon
    const b = t.segments[0].time;
    return { start_at: now - b, stop_at: now - b + roundEnd(t) };
  },
  segment: (t, now) => {
    const e = leadElapsed(t, now);
    if (e >= t.segments[0].time && isFrozen(t, now)) return null;
    let b = 0;
    for (const seg of t.segments) { b += seg.time; if (b > e) break; }
    if (b >= roundTotal(t)) return { start_at: now - roundEnd(t), stop_at: now };
    return { start_at: now - b, stop_at: now - b + roundEnd(t) };
  },
  // Normaler ITsBlue-Neustart ohne Haltepunkte (wie Steuerseite mit "Optimiert Lead" aus)
  neustart: (t, now) => ({ start_at: now + (t.metadata?.delay_start_stop || 0), stop_at: undefined }),
};
ACTIONS.start = ACTIONS.fortsetzen;
ACTIONS.startpause = (t, now) => (isFrozen(t, now) ? ACTIONS.fortsetzen(t, now) : ACTIONS.pause(t, now));
// Eine Taste für den ganzen Lead-Ablauf: bereit → Start, wartet → Klettern, pausiert → Fortsetzen, beendet → Reset.
// Läuft die Uhr, passiert nichts (kein versehentliches Anhalten).
const NEXT = { ready: "fortsetzen", prepDone: "klettern", paused: "fortsetzen", done: "reset" };
ACTIONS.weiter = (t, now) => { const a = NEXT[leadPhase(t, now)]; return a ? ACTIONS[a](t, now) : null; };
const NEXT_TEXT = { ready: "> START", prepDone: "> KLETTERN", paused: "> WEITER", done: "> RESET" };

// ---------- ITsBlue-API ----------
const tokens = {}; // pro Worker-Instanz zwischengespeichert; Tokens laufen bei ITsBlue nicht ab

function timerConfig(env, slot) {
  const id = env[`TIMER_${slot}_ID`], password = env[`TIMER_${slot}_PASSWORD`];
  if (!id || !password) throw new HttpError(500, `Timer ${slot} ist nicht eingerichtet (TIMER_${slot}_ID / TIMER_${slot}_PASSWORD fehlen).`);
  return { id, password };
}
async function getToken(cfg, force = false) {
  const key = cfg.id;
  if (tokens[key] && !force) return tokens[key];
  const r = await fetch(`${API}/timer/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: cfg.id, password: cfg.password }),
  });
  if (!r.ok) throw new HttpError(502, `Anmeldung bei ITsBlue für „${cfg.id}“ fehlgeschlagen (${r.status}).`);
  return (tokens[key] = (await r.json()).token);
}
async function getTimer(id, fresh) {
  const r = await fetch(`${API}/timer/${encodeURIComponent(id)}`,
    fresh ? { cache: "no-store" } : { cf: { cacheTtl: 1, cacheEverything: true } });
  if (!r.ok) throw new HttpError(502, `Timer „${id}“ konnte nicht geladen werden (${r.status}).`);
  return r.json();
}
async function runAction(env, slot, name) {
  const cfg = timerConfig(env, slot);
  const t = await getTimer(cfg.id, true);
  const changes = ACTIONS[name](t, Date.now());
  if (!changes) return { slot, timer: cfg.id, changed: false, ...statusOf(t) };
  const body = JSON.stringify({ ...t, ...changes });
  const put = token => fetch(`${API}/timer/${encodeURIComponent(cfg.id)}`, {
    method: "PUT", body, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  let r = await put(await getToken(cfg));
  if (r.status === 401) r = await put(await getToken(cfg, true));
  if (!r.ok) throw new HttpError(502, `ITsBlue hat den Befehl abgelehnt (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return { slot, timer: cfg.id, changed: true, ...statusOf(await r.json()) };
}
function statusOf(t, now = Date.now()) {
  const { inRound } = roundState(t, now);
  const { segment, remaining } = segmentAt(inRound, t.segments);
  const phase = leadPhase(t, now);
  return {
    phase, phaseText: PHASE_TEXT[phase], zeit: fmt(remaining + (segment.count_to || 0)),
    segment: segment.label, farbe: segment.color || "#333333",
  };
}

// ---------- Tastenbild (PNG, ohne externe Bibliotheken) ----------
const FONT = { // 5×7 Pixel
  "0": ["01110","10001","10011","10101","11001","10001","01110"], "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"], "3": ["11111","00010","00100","00010","00001","10001","01110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"], "5": ["11111","10000","11110","00001","00001","10001","01110"],
  "6": ["00110","01000","10000","11110","10001","10001","01110"], "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"], "9": ["01110","10001","10001","01111","00001","00010","01100"],
  ":": ["00000","01100","01100","00000","01100","01100","00000"], " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"], ">": ["10000","01000","00100","00010","00100","01000","10000"], ".": ["00000","00000","00000","00000","00000","01100","01100"],
  A: ["01110","10001","10001","11111","10001","10001","10001"], B: ["11110","10001","10001","11110","10001","10001","11110"],
  C: ["01110","10001","10000","10000","10000","10001","01110"], D: ["11100","10010","10001","10001","10001","10010","11100"],
  E: ["11111","10000","10000","11110","10000","10000","11111"], F: ["11111","10000","10000","11110","10000","10000","10000"],
  G: ["01110","10001","10000","10111","10001","10001","01111"], H: ["10001","10001","10001","11111","10001","10001","10001"],
  I: ["01110","00100","00100","00100","00100","00100","01110"], J: ["00111","00010","00010","00010","00010","10010","01100"],
  K: ["10001","10010","10100","11000","10100","10010","10001"], L: ["10000","10000","10000","10000","10000","10000","11111"],
  M: ["10001","11011","10101","10101","10001","10001","10001"], N: ["10001","10001","11001","10101","10011","10001","10001"],
  O: ["01110","10001","10001","10001","10001","10001","01110"], P: ["11110","10001","10001","11110","10000","10000","10000"],
  Q: ["01110","10001","10001","10001","10101","10010","01101"], R: ["11110","10001","10001","11110","10100","10010","10001"],
  S: ["01111","10000","10000","01110","00001","00001","11110"], T: ["11111","00100","00100","00100","00100","00100","00100"],
  U: ["10001","10001","10001","10001","10001","10001","01110"], V: ["10001","10001","10001","10001","10001","01010","00100"],
  W: ["10001","10001","10001","10101","10101","10101","01010"], X: ["10001","10001","01010","00100","01010","10001","10001"],
  Y: ["10001","10001","10001","01010","00100","00100","00100"], Z: ["11111","00001","00010","00100","01000","10000","11111"],
  "Ä": ["01010","00000","01110","10001","11111","10001","10001"], "Ö": ["01010","00000","01110","10001","10001","10001","01110"],
  "Ü": ["01010","00000","10001","10001","10001","10001","01110"],
};
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0x333333; return [n >> 16, (n >> 8) & 255, n & 255]; };

function drawText(px, size, text, scale, cy, rgb) {
  const chars = [...text.toUpperCase()].map(c => FONT[c] || FONT[" "]);
  const adv = 6 * scale, w = chars.length * adv - scale;
  let x0 = Math.round((size - w) / 2);
  const y0 = Math.round(cy - (7 * scale) / 2);
  for (const g of chars) {
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (g[gy][gx] !== "1") continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = x0 + gx * scale + dx, y = y0 + gy * scale + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = (y * size + x) * 3; px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2];
      }
    }
    x0 += adv;
  }
}
const fitScale = (text, size, max) => { for (let s = max; s > 1; s--) if ([...text].length * 6 * s - s <= size - 8) return s; return 1; };

async function renderKey(st, slot, size = 144) {
  const bg = st.error ? [60, 60, 60] : hexRgb(st.farbe);
  const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  const fg = lum > 140 ? [0, 0, 0] : [255, 255, 255];
  const px = new Uint8Array(size * size * 3);
  for (let i = 0; i < px.length; i += 3) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; }
  // Kopfzeile: Timer + Phase auf dunklem Band
  for (let y = 0; y < 30; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 3; px[i] = px[i] * 0.35; px[i + 1] = px[i + 1] * 0.35; px[i + 2] = px[i + 2] * 0.35; }
  const head = st.error ? `${slot} FEHLER` : `${slot} ${PHASE_SHORT[st.phase]}`;
  drawText(px, size, head, fitScale(head, size, 3), 15, [255, 255, 255]);
  const zeit = st.error ? "--:--" : st.zeit;
  const hint = st.error ? "" : NEXT_TEXT[st.phase] || "";
  drawText(px, size, zeit, fitScale(zeit, size, 5), hint ? 76 : 88, fg);
  if (hint) {                                   // Fußzeile: was der nächste Druck auf "weiter" macht
    for (let y = size - 30; y < size; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 3; px[i] = px[i] * 0.35; px[i + 1] = px[i + 1] * 0.35; px[i + 2] = px[i + 2] * 0.35; }
    drawText(px, size, hint, fitScale(hint, size, 2), size - 15, [255, 255, 255]);
  }
  return encodePng(px, size, size);
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function deflate(data) {
  const cs = new CompressionStream("deflate");
  const out = new Response(new Blob([data]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}
async function encodePng(rgb, w, h) {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  return new Blob(parts);
}

// ---------- HTTP ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const text = (s, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length === 0) return text("Timer-Bridge läuft.");
    const [key, target, action = "status"] = parts;
    if (!env.BRIDGE_KEY || !safeEqual(key, env.BRIDGE_KEY)) return text("Falscher Schlüssel.", 403);

    try {
      const slot = (target || "").toUpperCase();
      const slots = slot === "BEIDE" ? ["A", "B"] : slot === "A" || slot === "B" ? [slot] : null;
      if (!slots) throw new HttpError(404, "Unbekannter Timer. Erlaubt: A, B, beide.");

      if (action in ACTIONS) {
        const results = await Promise.all(slots.map(s => runAction(env, s, action)));
        return json(slots.length === 1 ? results[0] : results);
      }
      if (["status", "zeit", "phase", "taste.png"].includes(action)) {
        if (slots.length !== 1) throw new HttpError(400, "Status gibt es nur für A oder B einzeln.");
        let st;
        try { st = statusOf(await getTimer(timerConfig(env, slot).id, false)); }
        catch (e) { if (action !== "taste.png") throw e; st = { error: e.message }; }
        if (action === "zeit") return text(st.zeit);
        if (action === "phase") return text(st.phaseText);
        if (action === "taste.png") return new Response(await renderKey(st, slot), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
        return json({ slot, ...st });
      }
      throw new HttpError(404, `Unbekannte Aktion „${action}“. Erlaubt: ${Object.keys(ACTIONS).join(", ")}, status, zeit, phase, taste.png`);
    } catch (e) {
      return json({ fehler: e.message }, e.status || 500);
    }
  },
};

// Für Tests
export { ACTIONS, statusOf, leadPhase, renderKey };
