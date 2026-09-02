/**
 * Live lightning, keyless — Blitzortung.org's community detection network.
 *
 * This is the data set the paid "lightning tracker" apps sell: where strikes
 * are landing, right now, and how far away the nearest one is. Blitzortung is
 * a volunteer network of several thousand receivers whose detections are
 * published to the browser over a public WebSocket — the same feed that draws
 * their own map at map.blitzortung.org. The terms are private and
 * non-commercial use with attribution, which a personal dashboard satisfies;
 * do not put this behind anything that charges.
 *
 * **Written against the reverse-engineered protocol and unverified from the
 * build environment**, whose egress proxy refuses every `blitzortung.org`
 * host the same way it refuses RainViewer and the Met Office. So every field
 * is optional and coerced, an undecodable message is *counted* rather than
 * thrown, and the panel shows the raw counts — messages received, strikes
 * decoded, last message age — so a wrong assumption reads as a number rather
 * than as a quiet sky. **A live socket that decodes nothing is a wrong
 * assumption about the shape, not a quiet day.**
 *
 * What is assumed, and where it came from:
 *
 *  - Hosts `wss://ws1.blitzortung.org` … `ws8`, port 443. Their map picks one
 *    at random; this rotates through them on failure.
 *  - The client sends `{"a":111}` once the socket opens, which subscribes to
 *    the worldwide feed. There is no server-side bounding box, so the browser
 *    receives every strike on Earth — tens a second in a busy hour — and the
 *    filtering by distance happens here.
 *  - Each message is one strike as a JSON object, LZW-compressed into a
 *    string with the small dictionary coder in `decodeLZW`. The decoder is
 *    tried second: a message that already parses as JSON is used as it is, so
 *    if the compression is ever dropped nothing here breaks.
 *  - The strike's `time` is nanoseconds since the epoch, `lat`/`lon` in
 *    degrees, `sig` the list of stations that heard it. Only the first three
 *    are read.
 *
 * Everything in this file is **pure and client-safe**: no fetch, no socket, no
 * clock. The socket lives in `components/useLightningFeed.ts`; the maths here
 * takes `now` as an argument so it can be checked without one.
 */

/** Public Blitzortung WebSocket endpoints, tried in rotation. */
export const LIGHTNING_HOSTS = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (n) => `wss://ws${n}.blitzortung.org/`
);

/** What the map client sends after connecting. */
export const LIGHTNING_SUBSCRIBE = JSON.stringify({ a: 111 });

/** One detected strike, already positioned relative to the place. */
export interface Strike {
  /** Detection instant, milliseconds since the epoch. */
  time: number;
  lat: number;
  lon: number;
  /** Great-circle distance from the place, in km. */
  distanceKm: number;
  /** Compass bearing from the place to the strike, 0–360. */
  bearing: number;
  /** Stations that contributed to the fix, when the feed says. */
  stations: number | null;
}

/**
 * Only strikes inside this radius are kept. Thunder is audible to ~15 km and a
 * storm worth watching is within 100; 250 km covers a whole approaching front
 * without holding every strike in Europe in memory on a phone.
 */
export const KEEP_RADIUS_KM = 250;

/** How long a strike stays on the live map. */
export const LIVE_WINDOW_MS = 60 * 60_000;

/** How long a strike counts towards the hotspot grid. */
export const HOTSPOT_WINDOW_MS = 24 * 60 * 60_000;

/** Distance rings drawn on the map, in km. */
export const RINGS_KM = [10, 25, 50, 100] as const;

/* ------------------------------------------------------------------ */
/* Wire format                                                         */
/* ------------------------------------------------------------------ */

/**
 * Blitzortung's LZW variant. Codes below 256 are literal characters; each new
 * code is the previous phrase plus the first character of the current one.
 * Ported from the decoder their map page ships; it is a few lines and the
 * alternative was an unverifiable dependency.
 */
export function decodeLZW(input: string): string {
  if (input.length === 0) return "";
  const dict = new Map<number, string>();
  let phrase = input[0];
  let previous = phrase;
  const out: string[] = [phrase];
  let next = 256;
  for (let i = 1; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    const current =
      code < 256 ? input[i] : (dict.get(code) ?? previous + phrase);
    out.push(current);
    phrase = current[0];
    dict.set(next, previous + phrase);
    next += 1;
    previous = current;
  }
  return out.join("");
}

interface RawStrike {
  time?: unknown;
  lat?: unknown;
  lon?: unknown;
  sig?: unknown;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Decode one socket message into a positioned strike, or `null` if it is not
 * one — a heartbeat, a message in a shape this file does not know, or a strike
 * beyond `radiusKm`. The caller counts each of those separately.
 *
 * `time` is accepted in nanoseconds (what the feed sends), microseconds,
 * milliseconds or seconds, told apart by magnitude: a feed that quietly
 * changes units would otherwise stamp every strike a million years out and
 * the age filter would drop them all in silence.
 */
export function parseStrike(
  message: string,
  lat: number,
  lon: number,
  radiusKm = KEEP_RADIUS_KM
): { strike: Strike | null; decoded: boolean } {
  let raw: RawStrike | null = null;
  const attempts = [message, () => decodeLZW(message)];
  for (const attempt of attempts) {
    try {
      const text = typeof attempt === "string" ? attempt : attempt();
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        raw = parsed as RawStrike;
        break;
      }
    } catch {
      /* try the next shape */
    }
  }
  if (!raw) return { strike: null, decoded: false };

  const sLat = finite(raw.lat);
  const sLon = finite(raw.lon);
  const stamp = finite(raw.time);
  if (sLat === null || sLon === null || stamp === null) {
    return { strike: null, decoded: true };
  }
  if (Math.abs(sLat) > 90 || Math.abs(sLon) > 180) {
    return { strike: null, decoded: true };
  }

  const time = normaliseEpochMs(stamp);
  const distanceKm = haversineKm(lat, lon, sLat, sLon);
  if (distanceKm > radiusKm) return { strike: null, decoded: true };

  return {
    decoded: true,
    strike: {
      time,
      lat: sLat,
      lon: sLon,
      distanceKm,
      bearing: bearingDeg(lat, lon, sLat, sLon),
      stations: Array.isArray(raw.sig) ? raw.sig.length : null,
    },
  };
}

/** Seconds, milliseconds, microseconds or nanoseconds → milliseconds. */
export function normaliseEpochMs(stamp: number): number {
  if (stamp > 1e17) return stamp / 1e6; // ns
  if (stamp > 1e14) return stamp / 1e3; // µs
  if (stamp > 1e11) return stamp; // ms
  return stamp * 1000; // s
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function compassPoint(bearing: number): string {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Metres per pixel of Web Mercator at a latitude and zoom — what turns a
 * distance ring in kilometres into a circle radius in pixels on the tile map.
 * The tile arithmetic itself is in `tiles.ts`; this is its scale factor.
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos(toRad(lat))) / 2 ** zoom;
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export interface StrikeSummary {
  /** Strikes in the last 5, 15 and 60 minutes within the keep radius. */
  last5: number;
  last15: number;
  last60: number;
  /** Within each ring, last 60 minutes. Same order as `RINGS_KM`. */
  withinRings: number[];
  /** Closest strike in the window, or null when the sky is quiet. */
  nearest: Strike | null;
  /** Most recent strike in the window. */
  latest: Strike | null;
}

/** Everything the headline needs, in one pass over the list. */
export function summariseStrikes(
  strikes: readonly Strike[],
  now: number,
  windowMs = LIVE_WINDOW_MS
): StrikeSummary {
  const out: StrikeSummary = {
    last5: 0,
    last15: 0,
    last60: 0,
    withinRings: RINGS_KM.map(() => 0),
    nearest: null,
    latest: null,
  };
  for (const s of strikes) {
    const age = now - s.time;
    if (age > windowMs || age < -5 * 60_000) continue;
    out.last60 += 1;
    if (age <= 15 * 60_000) out.last15 += 1;
    if (age <= 5 * 60_000) out.last5 += 1;
    RINGS_KM.forEach((km, i) => {
      if (s.distanceKm <= km) out.withinRings[i] += 1;
    });
    if (!out.nearest || s.distanceKm < out.nearest.distanceKm) out.nearest = s;
    if (!out.latest || s.time > out.latest.time) out.latest = s;
  }
  return out;
}

export type ThreatLevel = "none" | "distant" | "near" | "overhead";

/**
 * The alarm the paid apps sell, as a rule rather than a feeling. Within 10 km
 * in the last quarter hour is overhead — that is the range where the next
 * strike could be you. Within 25 is near, and anything inside 100 is worth
 * knowing about. Older than fifteen minutes does not count towards the level:
 * a storm that passed an hour ago is history, not a threat.
 */
export function threatLevel(strikes: readonly Strike[], now: number): ThreatLevel {
  let level: ThreatLevel = "none";
  for (const s of strikes) {
    const age = now - s.time;
    if (age > 15 * 60_000 || age < -5 * 60_000) continue;
    if (s.distanceKm <= 10) return "overhead";
    if (s.distanceKm <= 25) level = "near";
    else if (s.distanceKm <= 100 && level === "none") level = "distant";
  }
  return level;
}

export function threatLabel(level: ThreatLevel): { title: string; note: string } {
  switch (level) {
    case "overhead":
      return {
        title: "Lightning overhead",
        note: "Strikes within 10 km in the last 15 minutes. Get indoors or into a car and stay there 30 minutes after the last thunder.",
      };
    case "near":
      return {
        title: "Storm nearby",
        note: "Strikes within 25 km in the last 15 minutes. If you can hear thunder, you are close enough to be struck.",
      };
    case "distant":
      return {
        title: "Storm in the area",
        note: "Strikes within 100 km in the last 15 minutes. Watch the direction it is moving.",
      };
    default:
      return {
        title: "No lightning nearby",
        note: "Nothing detected within 100 km in the last 15 minutes.",
      };
  }
}

/**
 * Whether a strike should sound the alarm. One notification per storm, not
 * per strike: the second strike of a storm two kilometres away is not news,
 * so a strike inside the radius fires only if the last alarm was longer ago
 * than `quietMs`.
 */
export function shouldAlarm(
  strike: Strike,
  radiusKm: number,
  lastAlarmAt: number,
  now: number,
  quietMs = 5 * 60_000
): boolean {
  if (strike.distanceKm > radiusKm) return false;
  /* Only fresh strikes ring — a backlog replayed on reconnect must not. */
  if (now - strike.time > 2 * 60_000) return false;
  return now - lastAlarmAt >= quietMs;
}

/** Rough thunder delay: sound covers a kilometre in about three seconds. */
export function thunderDelaySeconds(distanceKm: number): number {
  return Math.round(distanceKm * 2.92);
}

/** "12 s ago", "4 min ago", "1 h 10 min ago". */
export function ageLabel(time: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min ago` : `${hours} h ago`;
}

/* ------------------------------------------------------------------ */
/* Hotspots                                                            */
/* ------------------------------------------------------------------ */

export interface HotspotCell {
  /** Cell centre. */
  lat: number;
  lon: number;
  count: number;
  /** Share of the busiest cell, 0–1, for colouring. */
  weight: number;
}

/**
 * Where strikes have clustered, on a grid of roughly `cellKm` squares.
 *
 * The grid is in degrees, with the longitude step widened by the cosine of the
 * place's latitude so the cells are square on the ground rather than on the
 * page — at 51°N a degree of longitude is only 70 km. The cells are anchored
 * to the place so the grid does not shift as strikes arrive.
 */
export function hotspots(
  strikes: readonly Strike[],
  centreLat: number,
  centreLon: number,
  now: number,
  cellKm = 5,
  windowMs = HOTSPOT_WINDOW_MS
): HotspotCell[] {
  const dLat = cellKm / 111.32;
  const dLon = cellKm / (111.32 * Math.max(0.1, Math.cos(toRad(centreLat))));
  const cells = new Map<string, HotspotCell>();
  for (const s of strikes) {
    const age = now - s.time;
    if (age > windowMs || age < -5 * 60_000) continue;
    const i = Math.floor((s.lat - centreLat) / dLat);
    const j = Math.floor((s.lon - centreLon) / dLon);
    const key = `${i}:${j}`;
    const cell = cells.get(key);
    if (cell) cell.count += 1;
    else
      cells.set(key, {
        lat: centreLat + (i + 0.5) * dLat,
        lon: centreLon + (j + 0.5) * dLon,
        count: 1,
        weight: 0,
      });
  }
  const max = Math.max(1, ...Array.from(cells.values(), (c) => c.count));
  return Array.from(cells.values(), (c) => ({ ...c, weight: c.count / max })).sort(
    (a, b) => b.count - a.count
  );
}

/**
 * Trim a list to the strikes still worth keeping: inside the hotspot window,
 * not from the future, and no more than `cap` of them. Oldest go first — the
 * list is kept in arrival order, which is time order to within the network's
 * few-second jitter.
 */
export function pruneStrikes(
  strikes: readonly Strike[],
  now: number,
  cap = 5000,
  windowMs = HOTSPOT_WINDOW_MS
): Strike[] {
  const kept = strikes.filter((s) => now - s.time <= windowMs && s.time - now < 5 * 60_000);
  return kept.length > cap ? kept.slice(kept.length - cap) : kept;
}

/** Storage shape, so a stale or foreign payload is rejected rather than trusted. */
export function parseStoredStrikes(raw: string | null): Strike[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Strike =>
        !!s &&
        typeof s === "object" &&
        finite((s as Strike).time) !== null &&
        finite((s as Strike).lat) !== null &&
        finite((s as Strike).lon) !== null &&
        finite((s as Strike).distanceKm) !== null &&
        finite((s as Strike).bearing) !== null
    );
  } catch {
    return [];
  }
}
