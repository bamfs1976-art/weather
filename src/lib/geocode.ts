/**
 * SERVER ONLY — resolving a place to a point, without a key.
 *
 * This is the fix for a single point of failure the redesign left behind.
 * Every section of the dashboard is fetched for coordinates that `resolvePlace`
 * produces, so when place resolution failed the route returned an error and the
 * **entire page went blank** — even with the Met Office, Open-Meteo and the
 * Environment Agency all answering normally. That resolution ran through
 * Xweather, so a paused Xweather key took down a dashboard that no longer
 * depends on Xweather for any of its numbers.
 *
 * Geocoding is neither a map nor a second opinion, which are the only two jobs
 * Xweather still has here. So it moved:
 *
 *  1. **Coordinates are parsed, not looked up.** `51.6656,-3.9333` is already
 *     the answer, and it is both the app's default place and the form every
 *     shared `?p=` link takes. That path needs no geocoding at all — only a
 *     timezone lookup, cached for a day, and it resolves even when that fails
 *     (with a null offset, so times read as UTC rather than as a guess).
 *  2. **Names go to Open-Meteo's geocoding API** — keyless, and the same host
 *     family already trusted for the nowcast, air quality, pollen, ensemble
 *     and model spread.
 *  3. **Xweather is the last resort**, not the first, and only when it can
 *     answer. It resolves things Open-Meteo will not, such as airport codes.
 *
 * https://open-meteo.com/en/docs/geocoding-api
 */

import type { ResolvedPlace, Section } from "./weather-types";

const GEOCODE_BASE =
  process.env.OPEN_METEO_GEOCODE_BASE ?? "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = process.env.OPEN_METEO_BASE ?? "https://api.open-meteo.com/v1/forecast";

/** Places do not move. A week is the same lifetime the Xweather lookup used. */
const TTL = 604_800;
/** A coordinate's UTC offset changes twice a year; a day is plenty. */
const TTL_ZONE = 86_400;

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

/**
 * A bare "lat,lon" pair, or null.
 *
 * Deliberately strict: two finite numbers in range, nothing else. A loose
 * parse here would swallow a place name containing digits and silently
 * resolve it to the wrong point rather than falling through to a real lookup.
 */
export function parseCoordinates(query: string): { lat: number; lon: number } | null {
  const match = query.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

interface RawGeocode {
  results?: {
    id?: number;
    name?: string;
    latitude?: number;
    longitude?: number;
    elevation?: number;
    timezone?: string;
    country?: string;
    country_code?: string;
    admin1?: string;
    admin2?: string;
    population?: number;
  }[];
}

/**
 * A fetch that says *why* it failed.
 *
 * `null` for "reached it, nothing useful" and a reason for "could not reach
 * it" — because an unreachable geocoder and a place that does not exist call
 * for opposite responses, and this file is where the app decides whether to
 * tell someone their spelling is wrong. CLAUDE.md makes the same point about
 * `capReason` on the warnings feed; flattening the two here would repeat a
 * mistake that already cost a week of a stale banner going unnoticed.
 */
async function getJSON<T>(
  url: string,
  revalidate: number
): Promise<{ data: T | null; reason: null } | { data: null; reason: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { data: null, reason: timedOut ? "timeout" : "network" };
  }

  if (!res.ok) return { data: null, reason: `http_${res.status}` };

  try {
    return { data: (await res.json()) as T, reason: null };
  } catch {
    return { data: null, reason: "bad_response" };
  }
}

/**
 * The UTC offset in force at a point, from Open-Meteo's `timezone=auto`.
 *
 * Needed because the app formats every timestamp in the location's own offset.
 * A coordinate carries no timezone on its own, and getting this wrong shifts
 * every time on the page by an hour — so a failure returns null and the app
 * falls back to UTC rather than guessing an offset from the longitude.
 */
async function zoneFor(
  lat: number,
  lon: number
): Promise<{ tz: string | null; offsetSeconds: number | null }> {
  const url =
    `${FORECAST_BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&timezone=auto&forecast_days=1&hourly=temperature_2m`;
  const { data } = await getJSON<{ timezone?: string; utc_offset_seconds?: number }>(
    url,
    TTL_ZONE
  );
  return {
    tz: typeof data?.timezone === "string" ? data.timezone : null,
    offsetSeconds:
      typeof data?.utc_offset_seconds === "number" ? data.utc_offset_seconds : null,
  };
}

function place(
  partial: Partial<ResolvedPlace> & { lat: number; lon: number }
): ResolvedPlace {
  return {
    id: partial.id ?? `${partial.lat},${partial.lon}`,
    name: partial.name ?? `${partial.lat.toFixed(4)}, ${partial.lon.toFixed(4)}`,
    displayName:
      partial.displayName ??
      partial.name ??
      `${partial.lat.toFixed(4)}, ${partial.lon.toFixed(4)}`,
    lat: partial.lat,
    lon: partial.lon,
    tz: partial.tz ?? null,
    tzname: partial.tzname ?? null,
    tzoffset: partial.tzoffset ?? null,
    elevM: partial.elevM ?? null,
    elevFT: partial.elevFT ?? null,
    country: partial.country ?? null,
    countryFull: partial.countryFull ?? null,
    state: partial.state ?? null,
    stateFull: partial.stateFull ?? null,
    profile: partial.profile ?? null,
  };
}

/** Resolve a query to a point. Coordinates first, then Open-Meteo. */
export async function resolvePlaceKeyless(
  query: string
): Promise<Section<ResolvedPlace>> {
  const trimmed = query.trim();
  if (!trimmed) return fail<ResolvedPlace>("No location given.", "warn_no_place");

  const coords = parseCoordinates(trimmed);
  if (coords) {
    const zone = await zoneFor(coords.lat, coords.lon);
    return {
      ok: true,
      data: place({
        ...coords,
        id: `${coords.lat},${coords.lon}`,
        tz: zone.tz,
        tzname: zone.tz,
        tzoffset: zone.offsetSeconds,
      }),
      error: null,
      code: null,
    };
  }

  const url =
    `${GEOCODE_BASE}?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`;
  const { data: raw, reason } = await getJSON<RawGeocode>(url, TTL);

  if (reason) {
    return fail<ResolvedPlace>(
      "Could not reach the place search. The location is unchanged.",
      reason
    );
  }

  const hit = raw?.results?.[0];
  if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") {
    return fail<ResolvedPlace>(
      `Could not find a place called "${trimmed}".`,
      "invalid_location"
    );
  }

  /*
   * The geocoder returns an IANA zone name but not the offset in force, and
   * the app needs the offset. One extra call, cached for a day, on the same
   * host the forecast comes from.
   */
  const zone = await zoneFor(hit.latitude, hit.longitude);

  const parts = [hit.name, hit.admin1, hit.country].filter(Boolean) as string[];

  return {
    ok: true,
    data: place({
      lat: hit.latitude,
      lon: hit.longitude,
      id: hit.id ? String(hit.id) : trimmed,
      name: hit.name ?? trimmed,
      displayName: parts.join(", ") || trimmed,
      tz: zone.tz ?? hit.timezone ?? null,
      tzname: zone.tz ?? hit.timezone ?? null,
      tzoffset: zone.offsetSeconds,
      elevM: typeof hit.elevation === "number" ? hit.elevation : null,
      elevFT:
        typeof hit.elevation === "number" ? Math.round(hit.elevation * 3.28084) : null,
      country: hit.country_code ?? null,
      countryFull: hit.country ?? null,
      state: hit.admin1 ?? null,
      stateFull: hit.admin1 ?? null,
    }),
    error: null,
    code: null,
  };
}

/** One autocomplete suggestion, in the shape `/api/search` already returns. */
export interface PlaceSuggestion {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  country: string | null;
  state: string | null;
  /**
   * The canonical handle the app writes to `?p=` when this suggestion is
   * chosen. Always `lat,lon`: it round-trips through every endpoint without
   * ambiguity between same-named towns — and, since the redesign, it is the
   * one form `resolvePlaceKeyless` answers with no request at all.
   */
  query: string;
}

/** Autocomplete, keyless. Costs nothing against any weather allowance. */
export async function searchPlacesKeyless(
  query: string,
  limit = 8
): Promise<Section<PlaceSuggestion[]>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { ok: true, data: [], error: null, code: null };
  }

  /* A typed coordinate pair is its own suggestion — no lookup needed. */
  const coords = parseCoordinates(trimmed);
  if (coords) {
    const label = `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`;
    return {
      ok: true,
      data: [
        {
          id: label,
          name: label,
          displayName: label,
          lat: coords.lat,
          lon: coords.lon,
          country: null,
          state: null,
          query: `${coords.lat},${coords.lon}`,
        },
      ],
      error: null,
      code: null,
    };
  }

  const url =
    `${GEOCODE_BASE}?name=${encodeURIComponent(trimmed)}&count=${limit}` +
    `&language=en&format=json`;
  const { data: raw, reason } = await getJSON<RawGeocode>(url, TTL);

  if (reason) {
    return fail<PlaceSuggestion[]>("Could not reach the place search.", reason);
  }

  const results = (raw?.results ?? [])
    .filter(
      (hit) => typeof hit.latitude === "number" && typeof hit.longitude === "number"
    )
    .map((hit) => ({
      id: hit.id ? String(hit.id) : `${hit.latitude},${hit.longitude}`,
      name: hit.name ?? trimmed,
      displayName:
        [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ") ||
        (hit.name ?? trimmed),
      lat: hit.latitude as number,
      lon: hit.longitude as number,
      country: hit.country_code ?? null,
      state: hit.admin1 ?? null,
      query: `${hit.latitude},${hit.longitude}`,
    }));

  return { ok: true, data: results, error: null, code: null };
}
