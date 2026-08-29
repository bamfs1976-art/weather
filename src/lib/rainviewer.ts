/**
 * SERVER ONLY — RainViewer's public radar frame index.
 *
 * Real weather radar, keyless, with roughly two hours of past frames and a
 * short extrapolated nowcast ahead. It is what the app was missing: the
 * Open-Meteo nowcast on **Now** is a numerical model downscaled to fifteen
 * minutes, good for "is rain coming this hour" and vague about the minute it
 * arrives. Radar is an observation, and it is sharp about exactly that.
 *
 * **This was written against RainViewer's published API and could not be
 * verified from the build environment**, whose egress proxy refuses
 * `api.rainviewer.com` — the same wall that has kept every Met Office host
 * unreachable. So it is written the way this app writes every unverifiable
 * client: each field optional and coerced, a shape that does not match returns
 * a Section error rather than throwing, and `/api/diagnostics` reports the
 * frame counts so a wrong assumption shows up as a number rather than as an
 * empty map.
 *
 * Only the small JSON index is fetched here. The tiles themselves are loaded
 * straight from the browser as ordinary `<img>` elements: they need no key and
 * no CORS, so proxying them would add a serverless hop, a caching hazard of
 * exactly the kind `/api/map` already had, and nothing else.
 *
 * https://www.rainviewer.com/api.html
 */

import type { Section } from "./weather-types";

const BASE = process.env.RAINVIEWER_BASE ?? "https://api.rainviewer.com/public/weather-maps.json";

/**
 * Five minutes. Radar composites publish about that often, and the index is a
 * few kilobytes — but it names the frames every tile URL is built from, so a
 * stale index means requesting tiles that have expired.
 */
const TTL = 300;

export interface RadarFrame {
  /** Frame time, as a Unix timestamp in seconds. */
  time: number;
  /** ISO instant, for formatting in the location's offset. */
  iso: string;
  /** Path segment RainViewer gives for this frame. */
  path: string;
  /** True for extrapolated frames ahead of now, false for observed past. */
  forecast: boolean;
}

export interface RadarIndex {
  /** Tile host the paths hang off. */
  host: string;
  frames: RadarFrame[];
  /** Index of the most recent observed frame — where "now" sits. */
  nowIndex: number;
  pastCount: number;
  forecastCount: number;
  generatedISO: string | null;
}

interface RawFrame {
  time?: number;
  path?: string;
}

interface RawIndex {
  host?: string;
  generated?: number;
  radar?: { past?: RawFrame[]; nowcast?: RawFrame[] };
}

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

/**
 * A tile URL for one frame.
 *
 * The trailing segments are RainViewer's own: colour scheme, then a
 * `smooth_snow` pair. Scheme 4 is the "Universal Blue" ramp, which reads on a
 * dark map without the yellow-green of the default doing battle with the
 * app's own palette; smoothing on, snow shown as its own colour.
 */
export function radarTileUrl(
  host: string,
  path: string,
  z: number,
  x: number,
  y: number,
  size: 256 | 512 = 256,
  colour = 4
): string {
  return `${host}${path}/${size}/${z}/${x}/${y}/${colour}/1_1.png`;
}

export async function getRadarIndex(): Promise<Section<RadarIndex>> {
  let res: Response;
  try {
    res = await fetch(BASE, {
      next: { revalidate: TTL },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return fail<RadarIndex>(
      timedOut ? "The radar index did not respond in time." : "Could not reach the radar service.",
      timedOut ? "timeout" : "network"
    );
  }

  if (!res.ok) {
    return fail<RadarIndex>(`The radar service returned HTTP ${res.status}.`, `http_${res.status}`);
  }

  let raw: RawIndex;
  try {
    raw = (await res.json()) as RawIndex;
  } catch {
    return fail<RadarIndex>("The radar service returned a malformed response.", "bad_response");
  }

  const host = typeof raw.host === "string" ? raw.host : null;
  if (!host) {
    return fail<RadarIndex>("The radar index carried no tile host.", "bad_response");
  }

  const take = (list: RawFrame[] | undefined, forecast: boolean): RadarFrame[] =>
    (Array.isArray(list) ? list : [])
      .filter(
        (f): f is Required<RawFrame> =>
          typeof f?.time === "number" && Number.isFinite(f.time) && typeof f?.path === "string"
      )
      .map((f) => ({
        time: f.time,
        iso: new Date(f.time * 1000).toISOString(),
        path: f.path,
        forecast,
      }));

  const past = take(raw.radar?.past, false);
  const forecastFrames = take(raw.radar?.nowcast, true);

  if (past.length === 0 && forecastFrames.length === 0) {
    return fail<RadarIndex>("The radar index held no frames.", "warn_no_data");
  }

  const frames = [...past, ...forecastFrames].sort((a, b) => a.time - b.time);

  return {
    ok: true,
    data: {
      host,
      frames,
      /*
       * "Now" is the last observed frame, not the last frame overall — the
       * scrubber opens there so the map shows what radar has actually seen
       * rather than an extrapolation, and the forecast frames sit to its right
       * where they read as the future.
       */
      nowIndex: Math.max(0, past.length - 1),
      pastCount: past.length,
      forecastCount: forecastFrames.length,
      generatedISO:
        typeof raw.generated === "number" ? new Date(raw.generated * 1000).toISOString() : null,
    },
    error: null,
    code: null,
  };
}
