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

/*
 * Overridable so the server-side response handling can be exercised against
 * recorded fixtures. Unset in production, where it falls back to the real API.
 */
const DATA_BASE = process.env.XWEATHER_BASE_URL ?? "https://data.api.xweather.com";
/* Overridable alongside DATA_BASE so map handling can be tested offline. */
export const MAPS_BASE =
  process.env.XWEATHER_MAPS_BASE ?? "https://maps.api.xweather.com";

/** Cache lifetimes (seconds) per class of data. */
/*
 * Cache lifetimes, in seconds — and the main lever on the access count.
 *
 * Every one of these was tighter than the data behind it actually moves, which
 * is how a personal dashboard burned 15,000 accesses in eighteen days. One
 * overview load is fourteen Xweather calls plus a place resolve, and the route
 * sends `no-store`, so anything these do not absorb is paid again on every
 * refresh, every location change, and the first load after every deploy.
 *
 * Set from the publication interval of each data set rather than from how
 * fresh it would be nice for it to look: observations update on the hour,
 * forecasts a few times a day, normals never. `minutely` stays shortest
 * because a 60-minute nowcast is the one thing here that is genuinely about
 * the next few minutes.
 */
const TTL = {
  current: 600,
  minutely: 300,
  forecast: 3600,
  slow: 21_600,
  archive: 86_400,
  places: 604_800,
} as const;

/**
 * Codes that mean "this key cannot be used at all right now" — as opposed to
 * "this endpoint has nothing for this place".
 *
 * Xweather pauses a plan that has spent its monthly allowance, and a paused
 * key still costs a request to be told so. Without this, every dashboard load
 * fired fifteen doomed calls, which is the worst possible time to be spending
 * an allowance that has already run out.
 */
const KEY_LEVEL_CODES: ReadonlySet<string> = new Set([
  "auth_error",
  "invalid_client",
  "permission_denied",
  "auth_permission_denied",
  "quota_exceeded",
  "plan_limit",
  "account_paused",
]);

/**
 * Once a key-level refusal is seen, stop asking for a while.
 *
 * Module scope, so it lives as long as the serverless instance and no longer —
 * deliberately: a breaker that outlived the process would need invalidating
 * when the plan resumes, and a cold start already does that for free. The
 * cost of being wrong is one wasted cycle after the plan comes back, against
 * fifteen wasted calls on every load while it is out.
 */
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
let breakerUntil = 0;
let breakerCode: string | null = null;

/** Why the breaker is open, for diagnostics. Null when it is closed. */
export function breakerState(): { open: boolean; code: string | null; msLeft: number } {
  const msLeft = Math.max(0, breakerUntil - Date.now());
  return { open: msLeft > 0, code: msLeft > 0 ? breakerCode : null, msLeft };
}

/** Close the breaker by hand — diagnostics does this so it always measures. */
export function resetBreaker(): void {
  breakerUntil = 0;
  breakerCode = null;
}

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

  /*
   * Answer a key-level refusal from memory rather than by asking again. The
   * message says the same thing the upstream would have said, and the section
   * still renders its notice — the only difference is that it did not cost an
   * access to find out for the fourteenth time on this page load.
   */
  const breaker = breakerState();
  if (breaker.open) {
    return fail<T>(
      `Xweather is not answering for this key (${breakerCode}). Pausing requests for ${Math.ceil(
        breaker.msLeft / 60_000
      )} more minute(s) rather than spending the allowance on refusals.`,
      breakerCode
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
    /*
     * A refusal aimed at the key, not at the query, means every other call on
     * this page is going to be refused too. Open the breaker so they are not
     * all made.
     */
    if (KEY_LEVEL_CODES.has(code) || res.status === 429) {
      breakerCode = code;
      breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
    }
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
    return { ...record, periods: [flattenPeriod(periods)] } as T;
  }
  return { ...record, periods: periods.map(flattenPeriod) } as T;
}


/**
 * The summary endpoints (conditions/summary, observations/summary) return a
 * nested period shape — temp:{maxC,minC}, precip:{totalMM}, weather:{primary,
 * phrase,…} — while every other endpoint returns those fields flat. Panels are
 * written against the flat shape, so a summary period previously rendered
 * blank temperatures and, worse, passed the `weather` OBJECT straight to React,
 * which throws "objects are not valid as a React child".
 *
 * Flattening here means one shape reaches the UI. Endpoints that are already
 * flat pass through untouched, because each branch only fires when the nested
 * group is actually present.
 */
function flattenPeriod(period: unknown): unknown {
  if (!period || typeof period !== "object" || Array.isArray(period)) return period;

  const raw = period as Record<string, unknown>;
  // observations/summary nests the measurements one level deeper again.
  const merged: Record<string, unknown> =
    raw.summary && typeof raw.summary === "object" && !Array.isArray(raw.summary)
      ? { ...raw, ...(raw.summary as Record<string, unknown>) }
      : { ...raw };

  const obj = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  /*
   * Read every nested group first, then remove the group keys, then write the
   * flat fields. Doing it in that order matters: "humidity" is both a group
   * name and a flat field name, so lifting in place would either skip the
   * write or delete the value it had just written.
   */
  const groups = {
    temp: obj(merged.temp),
    dewpt: obj(merged.dewpt),
    humidity: obj(merged.humidity),
    precip: obj(merged.precip),
    snow: obj(merged.snow),
    wind: obj(merged.wind),
    pressure: obj(merged.pressure),
    visibility: obj(merged.visibility),
    uvi: obj(merged.uvi),
    weather: obj(merged.weather),
  };

  for (const [key, value] of Object.entries(groups)) {
    if (value) delete merged[key];
  }

  const set = (to: string, value: unknown) => {
    if (value !== undefined && merged[to] === undefined) merged[to] = value;
  };

  const { temp, dewpt, humidity, precip, snow, wind, pressure, visibility, uvi, weather } = groups;

  set("maxTempC", temp?.maxC); set("maxTempF", temp?.maxF);
  set("minTempC", temp?.minC); set("minTempF", temp?.minF);
  set("avgTempC", temp?.avgC); set("avgTempF", temp?.avgF);

  set("avgDewpointC", dewpt?.avgC); set("avgDewpointF", dewpt?.avgF);
  set("dewpointC", dewpt?.avgC);    set("dewpointF", dewpt?.avgF);

  set("humidity", humidity?.avg);
  set("minHumidity", humidity?.min);
  set("maxHumidity", humidity?.max);

  set("precipMM", precip?.totalMM); set("precipIN", precip?.totalIN);
  set("snowCM", snow?.totalCM);     set("snowIN", snow?.totalIN);

  set("windSpeedMaxKPH", wind?.maxKPH); set("windSpeedMaxMPH", wind?.maxMPH);
  set("windSpeedKPH", wind?.avgKPH);    set("windSpeedMPH", wind?.avgMPH);
  set("windGustKPH", wind?.gustKPH);    set("windGustMPH", wind?.gustMPH);
  set("windDirMax", wind?.maxDir);      set("windDirMaxDEG", wind?.maxDirDEG);

  set("pressureMB", pressure?.avgMB); set("pressureIN", pressure?.avgIN);
  set("visibilityKM", visibility?.avgKM); set("visibilityMI", visibility?.avgMI);
  set("maxUvi", uvi?.max);

  if (weather) {
    set("weatherPrimary", weather.primary);
    set("weatherPrimaryCoded", weather.primaryCoded);
    set("icon", weather.icon);
    const phrase = weather.phrase;
    const phraseText =
      typeof phrase === "string"
        ? phrase
        : obj(phrase)?.phrase;
    merged.weather =
      typeof phraseText === "string"
        ? phraseText
        : typeof weather.primary === "string"
          ? weather.primary
          : undefined;
  }

  /*
   * Last line of defence. Any value the UI puts in a text node must be a
   * primitive; an object here is what produced React error #31.
   */
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      delete merged[key];
    }
  }

  return merged;
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
  let section = await unwrapFirst(
    xwFetch<RawPlace | RawPlace[]>(
      `places/${encodeURIComponent(location)}`,
      {},
      TTL.places
    )
  );

  /*
   * `places/{query}` wants an identifier — coordinates, a postcode, an airport
   * code, or "city,state,country". A bare place name is not one: `?p=Swansea`
   * returned invalid_location for every endpoint on the dashboard, because the
   * place never resolved and nothing downstream was even attempted.
   *
   * That matters beyond a hand-typed URL. `?p=` is what the app writes when a
   * place is chosen and therefore what gets shared, and page.tsx feeds the
   * value straight through. So one search — the same `places/search` this app
   * already uses for autocomplete, and which answers fine when the lookup does
   * not — turns a name into an identifier. Only on failure, so a query that
   * already resolves still costs exactly one request.
   */
  if (!section.ok && section.code === "invalid_location") {
    const search = await unwrapFirst(
      xwFetch<RawPlace | RawPlace[]>(
        "places/search",
        { query: `name:^${location.trim().toLowerCase()}`, limit: "1" },
        TTL.places
      )
    );
    if (search.ok && search.data) section = search;
  }

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


/**
 * Probe one complete layer stack — exactly what the map panel requests, not a
 * simplified pair — and fingerprint the bytes that come back.
 *
 * The fingerprint is the point. "The map never changes" has two very different
 * causes: the service returning the same picture whatever it is asked for, or
 * the browser failing to show a picture that did change. Comparing hashes
 * across stacks separates the two, which no amount of reading the code can.
 */
export async function probeMapStack(
  layers: string,
  lat: number,
  lon: number,
  zoom: number
): Promise<{
  layers: string;
  zoom: number;
  ok: boolean;
  status: number | null;
  bytes: number | null;
  hash: string | null;
  detail: string | null;
}> {
  const base = { layers, zoom };
  const url = buildMapUrl({
    layers,
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
    zoom,
    width: 300,
    height: 200,
    offset: "current",
  });
  if (!url) {
    return { ...base, ok: false, status: null, bytes: null, hash: null, detail: "no credentials" };
  }

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return {
        ...base,
        ok: false,
        status: res.status,
        bytes: null,
        hash: null,
        detail:
          (await res.text().catch(() => "")).slice(0, 160) || `HTTP ${res.status}`,
      };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const { createHash } = await import("node:crypto");
    return {
      ...base,
      ok: true,
      status: res.status,
      bytes: buffer.length,
      hash: createHash("sha1").update(buffer).digest("hex").slice(0, 12),
      detail: res.headers.get("content-type"),
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      status: null,
      bytes: null,
      hash: null,
      detail: err instanceof Error ? err.name : "fetch failed",
    };
  }
}

/**
 * Probe a single raster layer against the live maps service.
 *
 * Layer codes cannot be verified from source — they depend on what an
 * account's plan serves, and guessing them has now cost two rounds of
 * blind fixes. This asks the service directly, one tiny image per layer, so
 * /api/diagnostics can report exactly which codes work for this key.
 */
export async function probeMapLayer(
  layer: string,
  lat: number,
  lon: number
): Promise<{ layer: string; ok: boolean; status: number | null; detail: string | null }> {
  // Pair every weather layer with a base so a failure is attributable to the
  // layer under test rather than to an empty stack.
  const layers = layer === "flat" ? "flat" : `flat,${layer}`;
  const url = buildMapUrl({
    layers,
    lat: Number(lat.toFixed(3)),
    lon: Number(lon.toFixed(3)),
    zoom: 5,
    width: 100,
    height: 100,
    offset: "current",
  });
  if (!url) {
    return { layer, ok: false, status: null, detail: "no credentials" };
  }

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const type = res.headers.get("content-type") ?? "";
      // A 200 that is not an image means the service answered with an error page.
      if (!type.startsWith("image/")) {
        return { layer, ok: false, status: res.status, detail: `content-type ${type}` };
      }
      return { layer, ok: true, status: res.status, detail: null };
    }
    return { layer, ok: false, status: res.status, detail: `HTTP ${res.status}` };
  } catch (err) {
    return {
      layer,
      ok: false,
      status: null,
      detail:
        err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable",
    };
  }
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
