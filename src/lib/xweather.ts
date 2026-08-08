/**
 * Server-side client for the Vaisala Xweather API.
 *
 * SERVER ONLY — this module reads XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET
 * and must never be imported from a "use client" component.
 *
 * Docs: https://www.xweather.com/docs/weather-api
 * Every request is `https://data.api.xweather.com/{endpoint}/{action}?client_id=…&client_secret=…`
 * and every response uses the same envelope:
 *   { success: boolean, error: { code, description } | null, response: T }
 */

import type {
  AirQualityResponse,
  AlertItem,
  ConditionsResponse,
  LightningSummaryResponse,
  MinutelyPeriod,
  NormalsResponse,
  ObservationResponse,
  PlaceSuggestion,
  ResolvedPlace,
  Section,
  SunMoonResponse,
  ThreatItem,
  WeatherPeriod,
} from "./weather-types";

const DATA_BASE = "https://data.api.xweather.com";
export const MAPS_BASE = "https://maps.api.xweather.com";

/** Cache lifetimes (seconds) per class of data. */
const TTL = {
  current: 120,
  minutely: 120,
  forecast: 900,
  slow: 3600,
  archive: 86_400,
  places: 604_800,
} as const;

interface XwEnvelope<T> {
  success: boolean;
  error: { code: string; description: string } | null;
  response: T;
}

export function hasCredentials(): boolean {
  return Boolean(
    process.env.XWEATHER_CLIENT_ID && process.env.XWEATHER_CLIENT_SECRET
  );
}

function credentials(): { id: string; secret: string } | null {
  const id = process.env.XWEATHER_CLIENT_ID;
  const secret = process.env.XWEATHER_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function succeed<T>(data: T): Section<T> {
  return { ok: true, data, error: null, code: null };
}

/**
 * Turn an upstream error code into something a person can act on. Xweather
 * gates many endpoints behind subscription tiers, so a missing section is a
 * normal outcome rather than a bug.
 */
function describeError(code: string, description: string): string {
  switch (code) {
    case "warn_no_data":
    case "warn_no_stations":
    case "warn_no_events":
      return "No data available for this location.";
    case "invalid_client":
    case "auth_error":
      return "Xweather rejected the API credentials. Check XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET.";
    case "permission_denied":
    case "auth_permission_denied":
      return "This data set is not included in your Xweather subscription.";
    case "invalid_location":
    case "warn_no_place":
      return "Location not recognised.";
    case "invalid_requests":
      return "Request rejected by Xweather (usually an out-of-range date).";
    default:
      return description || `Xweather error: ${code}`;
  }
}

/**
 * Map an Xweather failure onto an HTTP status for our own routes, so callers
 * can tell "you asked for a place that doesn't exist" apart from "the upstream
 * API is unreachable or misconfigured".
 */
export function httpStatusForCode(code: string | null): number {
  switch (code) {
    case "no_credentials":
    case "invalid_client":
    case "auth_error":
      return 503;
    case "permission_denied":
    case "auth_permission_denied":
      return 403;
    case "network":
    case "bad_response":
      return 502;
    case "invalid_location":
    case "warn_no_place":
    case "warn_no_data":
      return 404;
    default:
      return code && code.startsWith("http_") ? 502 : 404;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

/**
 * Fetch a single Xweather endpoint. Never throws — failures come back as a
 * Section with ok:false so one dead endpoint can't take the dashboard down.
 */
export async function xwFetch<T>(
  path: string,
  params: Params = {},
  revalidate: number = TTL.current
): Promise<Section<T>> {
  const creds = credentials();
  if (!creds) {
    return fail<T>(
      "Xweather credentials are not configured. Add XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET to .env.",
      "no_credentials"
    );
  }

  const url = new URL(`${DATA_BASE}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("client_id", creds.id);
  url.searchParams.set("client_secret", creds.secret);

  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return fail<T>(`Could not reach the Xweather API (${message}).`, "network");
  }

  let body: XwEnvelope<T>;
  try {
    body = (await res.json()) as XwEnvelope<T>;
  } catch {
    return fail<T>(
      `Xweather returned a non-JSON response (HTTP ${res.status}).`,
      "bad_response"
    );
  }

  if (!body.success) {
    const code = body.error?.code ?? `http_${res.status}`;
    return fail<T>(describeError(code, body.error?.description ?? ""), code);
  }

  if (body.response === undefined || body.response === null) {
    return fail<T>("No data available for this location.", "warn_no_data");
  }

  return succeed(body.response);
}

/** Xweather returns either a single object or an array depending on endpoint. */
function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value ?? null;
}

/**
 * Xweather returns `periods` as a bare object, not an array, when a query
 * happens to match exactly one period. Every panel maps over `periods`, so an
 * unguarded response of that shape throws during render and — with no error
 * boundary above it — unmounts the whole app. Normalise once here rather than
 * making a dozen call sites defensive.
 */
function normalisePeriods<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (!("periods" in record)) return value;
  const periods = record.periods;
  if (periods === undefined || periods === null) {
    return { ...record, periods: [] } as T;
  }
  if (!Array.isArray(periods)) {
    return { ...record, periods: [periods] } as T;
  }
  return value;
}

/** Await a fetch and collapse the one-element result array into an object. */
async function unwrapFirst<T>(
  pending: Promise<Section<T | T[]>>
): Promise<Section<T>> {
  const section = await pending;
  if (!section.ok || section.data === null) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }
  const value = first(section.data);
  if (value === null) {
    return fail<T>("No data available for this location.", "warn_no_data");
  }
  return succeed(normalisePeriods(value));
}

/* ------------------------------------------------------------------ */
/* Places                                                              */
/* ------------------------------------------------------------------ */

interface RawPlace {
  id?: string;
  loc?: { lat: number; long: number };
  place?: {
    name?: string;
    state?: string;
    stateFull?: string;
    country?: string;
    countryFull?: string;
    region?: string;
    continent?: string;
  };
  profile?: {
    elevM?: number;
    elevFT?: number;
    pop?: number;
    tz?: string;
    tzname?: string;
    tzoffset?: number;
    isDST?: boolean;
  };
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) =>
      word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase()
    )
    .join(" ");
}

function formatPlaceName(raw: RawPlace): string {
  const p = raw.place ?? {};
  const parts = [
    p.name ? titleCase(p.name) : null,
    p.stateFull || (p.state ? p.state.toUpperCase() : null),
    p.countryFull || (p.country ? p.country.toUpperCase() : null),
  ].filter(Boolean) as string[];
  return parts.join(", ");
}

export async function resolvePlace(
  location: string
): Promise<Section<ResolvedPlace>> {
  const section = await unwrapFirst(
    xwFetch<RawPlace | RawPlace[]>(
      `places/${encodeURIComponent(location)}`,
      {},
      TTL.places
    )
  );
  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const raw = section.data;
  const place = raw.place ?? {};
  const profile = raw.profile ?? {};

  return succeed<ResolvedPlace>({
    id: raw.id ?? location,
    name: place.name ? titleCase(place.name) : location,
    displayName: formatPlaceName(raw) || location,
    lat: raw.loc?.lat ?? 0,
    lon: raw.loc?.long ?? 0,
    tz: profile.tz ?? null,
    tzname: profile.tzname ?? null,
    tzoffset: profile.tzoffset ?? null,
    elevM: profile.elevM ?? null,
    elevFT: profile.elevFT ?? null,
    country: place.country?.toUpperCase() ?? null,
    countryFull: place.countryFull ?? null,
    state: place.state?.toUpperCase() ?? null,
    stateFull: place.stateFull ?? null,
    profile: profile,
  });
}

export async function searchPlaces(
  query: string,
  limit = 8
): Promise<Section<PlaceSuggestion[]>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return succeed<PlaceSuggestion[]>([]);

  // A comma means the user typed "city, region" — search on the leading token
  // and let the API's own ranking sort out the rest.
  const nameToken = trimmed.split(",")[0].trim().toLowerCase();

  const section = await xwFetch<RawPlace[]>(
    "places/search",
    {
      query: `name:^${nameToken}`,
      limit,
      sort: "pop:-1",
      fields: "id,loc,place,profile.tz,profile.pop",
    },
    TTL.places
  );

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const suggestions: PlaceSuggestion[] = section.data.map((raw) => {
    const p = raw.place ?? {};
    // Prefer lat/lon as the canonical handle: it round-trips through every
    // endpoint without ambiguity between same-named cities.
    const handle =
      raw.loc && Number.isFinite(raw.loc.lat)
        ? `${raw.loc.lat},${raw.loc.long}`
        : [p.name, p.state, p.country].filter(Boolean).join(",");
    return {
      id: raw.id ?? handle,
      name: p.name ? titleCase(p.name) : handle,
      displayName: formatPlaceName(raw) || handle,
      lat: raw.loc?.lat ?? 0,
      lon: raw.loc?.long ?? 0,
      country: p.countryFull ?? p.country?.toUpperCase() ?? null,
      state: p.stateFull ?? p.state?.toUpperCase() ?? null,
      query: handle,
    };
  });

  return succeed(suggestions);
}

/* ------------------------------------------------------------------ */
/* Weather endpoints                                                   */
/* ------------------------------------------------------------------ */

const loc = (location: string) => encodeURIComponent(location);

/** Interpolated current conditions — richer and more global than a raw METAR. */
export function getCurrentConditions(location: string) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(`conditions/${loc(location)}`, {}, TTL.current)
  );
}

/** Nearest reporting station observation (station name, distance, QC flags). */
export function getObservation(location: string) {
  return unwrapFirst(
    xwFetchArray<ObservationResponse>(
      `observations/${loc(location)}`,
      {},
      TTL.current
    )
  );
}

/** Minute-by-minute precipitation nowcast for the next hour. */
export function getMinutely(location: string) {
  return unwrapFirst(
    xwFetchArray<{ periods: MinutelyPeriod[] }>(
      `conditions/${loc(location)}`,
      { filter: "1min", plimit: 60, fields: "periods.dateTimeISO,periods.timestamp,periods.precipMM,periods.precipIN,periods.precipRateMM,periods.precipRateIN,periods.weatherPrimary,periods.weatherPrimaryCoded,periods.icon" },
      TTL.minutely
    )
  );
}

/** Hourly forecast. */
export function getHourlyForecast(location: string, hours = 48) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `forecasts/${loc(location)}`,
      { filter: "1hr", limit: hours },
      TTL.forecast
    )
  );
}

/** Daily forecast (midnight-to-midnight so the days line up with a calendar). */
export function getDailyForecast(location: string, days = 10) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `forecasts/${loc(location)}`,
      { filter: "mdnt2mdnt", limit: days },
      TTL.forecast
    )
  );
}

/** Day/night split forecast — gives separate daytime highs and overnight lows. */
export function getDayNightForecast(location: string, periods = 14) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `forecasts/${loc(location)}`,
      { filter: "daynight", limit: periods },
      TTL.forecast
    )
  );
}

/** Observed conditions for the trailing window, hour by hour. */
export function getRecentConditions(location: string, hours = 24) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `conditions/${loc(location)}`,
      {
        from: `-${hours}hours`,
        to: "now",
        filter: "1hr",
        plimit: hours + 1,
      },
      TTL.current
    )
  );
}

export async function getAlerts(location: string): Promise<Section<AlertItem[]>> {
  const section = await xwFetch<AlertItem | AlertItem[]>(
    `alerts/${loc(location)}`,
    { limit: 10 },
    TTL.current
  );
  if (!section.ok || !section.data) {
    // "No alerts" comes back as warn_no_data — that's a valid, quiet answer.
    if (section.code === "warn_no_data") return succeed<AlertItem[]>([]);
    return { ok: false, data: null, error: section.error, code: section.code };
  }
  return succeed(Array.isArray(section.data) ? section.data : [section.data]);
}

export function getAirQuality(location: string) {
  return unwrapFirst(
    xwFetchArray<AirQualityResponse>(`airquality/${loc(location)}`, {}, TTL.current)
  );
}

export function getAirQualityForecast(location: string, hours = 24) {
  return unwrapFirst(
    xwFetchArray<AirQualityResponse>(
      `airquality/forecasts/${loc(location)}`,
      { filter: "1hr", limit: hours },
      TTL.forecast
    )
  );
}

export function getSunMoon(location: string) {
  return unwrapFirst(
    xwFetchArray<SunMoonResponse>(`sunmoon/${loc(location)}`, {}, TTL.slow)
  );
}

export async function getThreats(location: string): Promise<Section<ThreatItem[]>> {
  const section = await xwFetch<ThreatItem | ThreatItem[]>(
    `threats/${loc(location)}`,
    {},
    TTL.current
  );
  if (!section.ok || !section.data) {
    if (section.code === "warn_no_data") return succeed<ThreatItem[]>([]);
    return { ok: false, data: null, error: section.error, code: section.code };
  }
  return succeed(Array.isArray(section.data) ? section.data : [section.data]);
}

export function getLightningSummary(location: string, radiusKm = 50) {
  return unwrapFirst(
    xwFetchArray<LightningSummaryResponse>(
      `lightning/summary/${loc(location)}`,
      { radius: `${radiusKm}km`, from: "-1hour", to: "now" },
      TTL.current
    )
  );
}

/** Plain-language forecast narrative. */
export function getPhrase(location: string) {
  return unwrapFirst(
    xwFetchArray<{ periods: { text?: string; weatherPrimary?: string }[] }>(
      `phrases/summary/${loc(location)}`,
      {},
      TTL.forecast
    )
  );
}

/* ---------------------------- history ----------------------------- */

/** Interpolated daily summaries — works globally, including where no station exists. */
export function getDailySummaries(location: string, from: string, to: string) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `conditions/summary/${loc(location)}`,
      { from, to, filter: "day", plimit: 32 },
      TTL.archive
    )
  );
}

/** Station-reported daily summaries, for comparison against the interpolated set. */
export function getStationSummaries(location: string, from: string, to: string) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `observations/summary/${loc(location)}`,
      { from, to, plimit: 32 },
      TTL.archive
    )
  );
}

/** 30-year climate normals for the same window, to show anomaly vs. normal. */
export function getNormals(location: string, from: string, to: string) {
  return unwrapFirst(
    xwFetchArray<NormalsResponse>(
      `normals/${loc(location)}`,
      { from, to, plimit: 32 },
      TTL.archive
    )
  );
}

/** Hour-by-hour reconstruction of one past day. */
export function getArchiveHourly(location: string, date: string) {
  return unwrapFirst(
    xwFetchArray<ConditionsResponse>(
      `conditions/${loc(location)}`,
      {
        from: `${date}T00:00:00`,
        to: `${date}T23:59:59`,
        filter: "1hr",
        plimit: 24,
      },
      TTL.archive
    )
  );
}

/** Raw station observations for one past day. */
export function getArchiveObservations(location: string, date: string) {
  return unwrapFirst(
    xwFetchArray<{ periods: WeatherPeriod[] }>(
      `observations/archive/${loc(location)}`,
      { from: date, to: date, plimit: 100, limit: 100 },
      TTL.archive
    )
  );
}

export function getSunMoonForDate(location: string, date: string) {
  return unwrapFirst(
    xwFetchArray<SunMoonResponse>(
      `sunmoon/${loc(location)}`,
      { from: date, to: date },
      TTL.archive
    )
  );
}

/* ------------------------------------------------------------------ */
/* Raster maps                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build a static raster map URL. The credentials sit in the path, so this URL
 * is only ever used server-side — the browser talks to /api/map.
 */
export function buildMapUrl(options: {
  layers: string;
  lat: number;
  lon: number;
  zoom: number;
  width: number;
  height: number;
  offset: string;
}): string | null {
  const creds = credentials();
  if (!creds) return null;
  const { layers, lat, lon, zoom, width, height, offset } = options;
  return (
    `${MAPS_BASE}/${creds.id}_${creds.secret}` +
    `/${layers}/${width}x${height}/${lat},${lon},${zoom}/${offset}.png`
  );
}

/* ------------------------------------------------------------------ */

/**
 * Most weather endpoints wrap their payload in a one-element array. This keeps
 * the array-ness inside the helper so callers can stay typed on the object.
 */
function xwFetchArray<T>(
  path: string,
  params: Params,
  revalidate: number
): Promise<Section<T | T[]>> {
  return xwFetch<T | T[]>(path, params, revalidate);
}
