/**
 * SERVER ONLY — MET Norway Locationforecast 2.0.
 *
 * A third forecast beside Xweather and the Met Office. Free, worldwide, no key
 * and no registration — but MET Norway require a User-Agent that identifies the
 * application and gives a contact address, and they block callers who do not
 * send one. That header is not optional politeness here; it is the terms.
 *
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation
 *
 * Two of their rules shape this file:
 *
 *  1. **Coordinates must be truncated to four decimals.** Requests with more
 *     precision are rejected, and it also means two nearby places share a cache
 *     entry rather than each costing a request.
 *  2. **Do not poll faster than the data changes.** Their forecasts update
 *     roughly hourly, so the cache is an hour.
 *
 * As with the Met Office client, no upstream is reachable from the build
 * environment, so every field is optional and coerced, and a shape that does
 * not match returns a Section error rather than throwing.
 */

import type { Section } from "./weather-types";
import type { ConditionKind } from "./weather-format";
import type { MetNoForecast, MetNoHour } from "./metno-types";

const BASE =
  process.env.METNO_BASE_URL ?? "https://api.met.no/weatherapi/locationforecast/2.0";

/** Their model runs about hourly; polling faster only burns their bandwidth. */
const TTL = 3_600;


function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * MET Norway symbol codes are `name_variant`, e.g. "partlycloudy_night" or
 * "lightrainshowers_day". Mapping them onto this app's own vocabulary means the
 * same icon component serves all three providers.
 */
function classifySymbol(symbol: string | null): { kind: ConditionKind; night: boolean } {
  const raw = (symbol ?? "").toLowerCase();
  const night = raw.endsWith("_night");
  const name = raw.replace(/_(day|night|polartwilight)$/, "");

  const kind: ConditionKind = (() => {
    if (!name) return "unknown";
    if (name.includes("thunder")) return "tstorm";
    if (name.includes("sleet")) return "sleet";
    if (name.includes("snow")) return "snow";
    // Showers before rain: "lightrainshowers" contains both words.
    if (name.includes("showers")) return "showers";
    if (name.includes("drizzle")) return "drizzle";
    if (name.includes("rain")) return "rain";
    if (name.includes("fog")) return "fog";
    if (name === "cloudy") return "cloudy";
    if (name.includes("partlycloudy")) return "pcloudy";
    if (name.includes("fair")) return "fair";
    if (name.includes("clearsky")) return "clear";
    return "unknown";
  })();

  return { kind, night };
}

interface RawEntry {
  time?: string;
  data?: {
    instant?: { details?: Record<string, unknown> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: Record<string, unknown> };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: Record<string, unknown> };
  };
}

export async function getMetNoForecast(
  lat: number,
  lon: number,
  hours = 48
): Promise<Section<MetNoForecast>> {
  // Four decimals is their documented maximum; more is rejected outright.
  const url = `${BASE}/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: TTL },
      headers: {
        Accept: "application/json",
        // Required by MET Norway's terms, not a courtesy.
        "User-Agent": "swanseaweather/1.0 (+https://swanseaweather.netlify.app)",
      },
      signal: AbortSignal.timeout(6_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && /Timeout|Abort/.test(err.name);
    return fail(
      timedOut ? "MET Norway did not respond in time." : "Could not reach MET Norway.",
      timedOut ? "timeout" : "network"
    );
  }

  if (res.status === 403) {
    return fail(
      "MET Norway refused the request (403). They require a User-Agent identifying the app — check it is still being sent.",
      "unauthorised"
    );
  }
  if (res.status === 429) {
    return fail("MET Norway rate limit reached — the cache will recover it.", "rate_limited");
  }
  if (!res.ok) {
    return fail(`MET Norway returned HTTP ${res.status}.`, `http_${res.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return fail("MET Norway returned something that was not JSON.", "bad_response");
  }

  const root = parsed as {
    properties?: { meta?: { updated_at?: string }; timeseries?: RawEntry[] };
  };
  const series = root?.properties?.timeseries;
  if (!Array.isArray(series) || series.length === 0) {
    return fail("MET Norway returned no timeseries.", "bad_response");
  }

  const out: MetNoHour[] = [];
  for (const entry of series.slice(0, hours)) {
    const when = typeof entry?.time === "string" ? entry.time : null;
    if (!when) continue;
    const instant = entry.data?.instant?.details ?? {};
    /*
     * Precipitation lives in the *next* block rather than the instant one, and
     * the 1-hour block stops partway through the range — MET Norway drop to
     * 6-hourly further out. Falling back keeps the tail of the series usable
     * instead of showing it as dry.
     */
    const ahead = entry.data?.next_1_hours ?? entry.data?.next_6_hours;
    const symbol = ahead?.summary?.symbol_code ?? null;
    const { kind, night } = classifySymbol(symbol);

    out.push({
      timeISO: when,
      tempC: num(instant.air_temperature),
      feelsLikeC: null,
      humidity: num(instant.relative_humidity),
      pressureMB: num(instant.air_pressure_at_sea_level),
      // MET Norway publish metres per second; the app formats km/h.
      windSpeedKPH: (() => {
        const ms = num(instant.wind_speed);
        return ms === null ? null : Math.round(ms * 3.6 * 10) / 10;
      })(),
      windDirDEG: num(instant.wind_from_direction),
      cloudCover: num(instant.cloud_area_fraction),
      precipMM: num(ahead?.details?.precipitation_amount),
      pop: num(ahead?.details?.probability_of_precipitation),
      symbol,
      kind,
      night,
    });
  }

  if (out.length === 0) {
    return fail("MET Norway returned a timeseries this app could not read.", "bad_response");
  }

  return {
    ok: true,
    data: { updatedISO: root.properties?.meta?.updated_at ?? null, hours: out },
    error: null,
    code: null,
  };
}
