/**
 * SERVER ONLY — Open-Meteo's forecast API, for the two things the Met Office
 * does not publish: a sub-hourly nowcast and the hours that have just gone.
 *
 * Keyless, like the marine, pollen, model-spread and ensemble calls already in
 * the app, and pointed at the same host — so this is a source already trusted
 * here rather than a new dependency. It replaces `conditions?filter=1min` and
 * `conditions?from=-24hours`, two more Xweather accesses per dashboard load.
 *
 * Both results are converted into the shapes the panels already read, which is
 * the same approach `metoffice-periods.ts` takes and for the same reason: the
 * provider changes, the components do not.
 *
 * **The nowcast is a model, not radar.** Xweather's `1min` filter was a
 * blended radar nowcast; `minutely_15` is a 15-minute-resolution forecast from
 * the same numerical model as the rest of the series. It answers "is rain
 * coming in the next hour" well enough to be worth showing, and it is not the
 * radar-derived product it replaces — the card says so rather than implying a
 * precision it does not have.
 * https://open-meteo.com/en/docs
 */

import { conditionFields } from "./metoffice-periods";
import type { ConditionKind } from "./weather-format";
import type {
  ConditionsResponse,
  MinutelyPeriod,
  Section,
  WeatherPeriod,
} from "./weather-types";

const BASE = process.env.OPEN_METEO_BASE ?? "https://api.open-meteo.com/v1/forecast";

/** A nowcast is about the next hour, so it is the one thing kept short. */
const TTL_NOWCAST = 600;
/** The trailing window only gains an hour at a time. */
const TTL_RECENT = 1_800;

/**
 * WMO present-weather codes to the app's own vocabulary.
 *
 * Open-Meteo publishes the WMO 4677 code, which is a different scheme from
 * both the Met Office's significant weather code and Xweather's coded string.
 * This is the third such mapping in the app and they must not be conflated:
 * the numbers overlap and mean different things in each.
 */
const WMO: Record<number, ConditionKind> = {
  0: "clear",
  1: "fair",
  2: "pcloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "showers",
  81: "showers",
  82: "showers",
  85: "snow",
  86: "snow",
  95: "tstorm",
  96: "tstorm",
  99: "tstorm",
};

const LABELS: Record<ConditionKind, string> = {
  clear: "Clear",
  fair: "Fair",
  pcloudy: "Partly cloudy",
  mcloudy: "Mostly cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  showers: "Showers",
  drizzle: "Drizzle",
  tstorm: "Thunderstorms",
  snow: "Snow",
  sleet: "Sleet",
  hail: "Hail",
  fog: "Fog",
  wind: "Windy",
  hot: "Hot",
  cold: "Cold",
  unknown: "—",
};

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

interface RawForecast {
  hourly?: Record<string, unknown>;
  minutely_15?: Record<string, unknown>;
}

function numbers(value: unknown): (number | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : null
  );
}

function offsetLabel(offsetMinutes: number | null): string {
  if (offsetMinutes === null || !Number.isFinite(offsetMinutes)) return "Z";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function stamper(offsetMinutes: number | null) {
  const offsetMs = (offsetMinutes ?? 0) * 60_000;
  const label = offsetLabel(offsetMinutes);
  return (unix: number): string =>
    new Date(unix * 1000 + offsetMs).toISOString().replace("Z", label);
}

async function get(url: string, revalidate: number): Promise<RawForecast | { error: Section<never> }> {
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
    return {
      error: fail<never>(
        timedOut
          ? "Open-Meteo did not respond in time."
          : "Could not reach Open-Meteo.",
        timedOut ? "timeout" : "network"
      ),
    };
  }

  if (!res.ok) {
    return { error: fail<never>(`Open-Meteo returned HTTP ${res.status}.`, `http_${res.status}`) };
  }

  try {
    return (await res.json()) as RawForecast;
  } catch {
    return { error: fail<never>("Open-Meteo returned a malformed response.", "bad_response") };
  }
}

function isError(value: unknown): value is { error: Section<never> } {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Precipitation for the next hour, at fifteen-minute resolution.
 *
 * `minutely_15` is published for Europe and North America only; elsewhere the
 * arrays come back empty, which is reported as `warn_no_data` rather than as a
 * dry hour — "no forecast" and "no rain" must not look the same.
 */
export async function getNowcast(
  lat: number,
  lon: number,
  offsetMinutes: number | null = null,
  now: number = Date.now()
): Promise<Section<{ periods: MinutelyPeriod[] }>> {
  /*
   * Two forecast days, because a request made late in the evening would
   * otherwise have its window truncated at midnight and report the rain
   * stopping when the data merely ran out.
   */
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&minutely_15=precipitation,weather_code&forecast_days=2&timeformat=unixtime`;

  const raw = await get(url, TTL_NOWCAST);
  if (isError(raw)) return raw.error as Section<{ periods: MinutelyPeriod[] }>;

  const times = numbers(raw.minutely_15?.time);
  const precip = numbers(raw.minutely_15?.precipitation);
  const codes = numbers(raw.minutely_15?.weather_code);

  if (times.length === 0) {
    return fail(
      "No sub-hourly forecast is published for this location — Open-Meteo covers Europe and North America.",
      "warn_no_data"
    );
  }

  const stamp = stamper(offsetMinutes);
  const nowSeconds = now / 1000;
  const periods: MinutelyPeriod[] = [];

  for (let i = 0; i < times.length; i += 1) {
    const unix = times[i];
    if (unix === null || unix + 900 <= nowSeconds) continue;
    /*
     * Two hours of quarter-hours.
     *
     * One hour was the Xweather nowcast's window and it is too short for the
     * question this card actually answers — "do I need a coat before I leave"
     * is usually asked about the next hour and a half, not the next sixty
     * minutes. The series is fetched whole either way, so the extra hour costs
     * nothing; the cap exists only to stop the strip running off the card.
     */
    if (periods.length >= 8) break;

    const kind = codes[i] === null ? "unknown" : (WMO[codes[i] as number] ?? "unknown");
    const fields = conditionFields(kind, false);
    const mm = precip[i];

    periods.push({
      timestamp: unix,
      dateTimeISO: stamp(unix),
      precipMM: mm,
      precipIN: mm === null ? null : mm / 25.4,
      /* A 15-minute total expressed as an hourly rate, which is what the
       * field means and what the panel's "mm/hr" label claims. */
      precipRateMM: mm === null ? null : mm * 4,
      precipRateIN: mm === null ? null : (mm * 4) / 25.4,
      weatherPrimary: LABELS[kind],
      weatherPrimaryCoded: fields.weatherPrimaryCoded,
      icon: fields.icon,
    });
  }

  if (periods.length === 0) {
    return fail("The sub-hourly forecast held no upcoming steps.", "warn_no_data");
  }

  return { ok: true, data: { periods }, error: null, code: null };
}

/**
 * The trailing 24 hours, for the Last 24h tab.
 *
 * `past_days=1` returns yesterday and today, so the series is trimmed to the
 * hours that have actually happened — a "last 24 hours" card showing hours
 * still in the future would be the same class of error as the warning that
 * outlived its expiry.
 */
export async function getRecent(
  lat: number,
  lon: number,
  offsetMinutes: number | null = null,
  hours = 24,
  now: number = Date.now()
): Promise<Section<ConditionsResponse>> {
  const fields = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation",
    "surface_pressure",
    "pressure_msl",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "cloud_cover",
    "visibility",
    "weather_code",
  ].join(",");

  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${fields}&past_days=2&forecast_days=1&timeformat=unixtime&wind_speed_unit=kmh`;

  const raw = await get(url, TTL_RECENT);
  if (isError(raw)) return raw.error as Section<ConditionsResponse>;

  const times = numbers(raw.hourly?.time);
  if (times.length === 0) {
    return fail("Open-Meteo returned no hourly history for this point.", "warn_no_data");
  }

  const series = (field: string) => numbers(raw.hourly?.[field]);
  const temp = series("temperature_2m");
  const feels = series("apparent_temperature");
  const humidity = series("relative_humidity_2m");
  const dew = series("dew_point_2m");
  const precip = series("precipitation");
  const pressure = series("pressure_msl");
  const windKPH = series("wind_speed_10m");
  const gustKPH = series("wind_gusts_10m");
  const windDir = series("wind_direction_10m");
  const cloud = series("cloud_cover");
  const visibility = series("visibility");
  const codes = series("weather_code");

  const stamp = stamper(offsetMinutes);
  const nowSeconds = now / 1000;
  const cutoff = nowSeconds - hours * 3600;

  const periods: WeatherPeriod[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const unix = times[i];
    if (unix === null || unix < cutoff || unix > nowSeconds) continue;

    const kind = codes[i] === null ? "unknown" : (WMO[codes[i] as number] ?? "unknown");
    const fieldsFor = conditionFields(kind, false);
    const c = temp[i];
    const f = feels[i];
    const mm = precip[i];
    const kph = windKPH[i];
    const gust = gustKPH[i];
    const visM = visibility[i];

    periods.push({
      timestamp: unix,
      dateTimeISO: stamp(unix),
      tempC: c,
      tempF: c === null ? null : c * 1.8 + 32,
      feelslikeC: f,
      feelslikeF: f === null ? null : f * 1.8 + 32,
      dewpointC: dew[i],
      dewpointF: dew[i] === null ? null : (dew[i] as number) * 1.8 + 32,
      humidity: humidity[i],
      pressureMB: pressure[i],
      pressureIN: pressure[i] === null ? null : (pressure[i] as number) * 0.02953,
      windSpeedKPH: kph,
      windSpeedMPH: kph === null ? null : kph / 1.609344,
      windGustKPH: gust,
      windGustMPH: gust === null ? null : gust / 1.609344,
      windDirDEG: windDir[i],
      precipMM: mm,
      precipIN: mm === null ? null : mm / 25.4,
      sky: cloud[i],
      visibilityKM: visM === null ? null : visM / 1000,
      visibilityMI: visM === null ? null : visM / 1609.344,
      weather: LABELS[kind],
      weatherPrimary: LABELS[kind],
      weatherPrimaryCoded: fieldsFor.weatherPrimaryCoded,
      icon: fieldsFor.icon,
    });
  }

  if (periods.length === 0) {
    return fail("No hours in the trailing window came back.", "warn_no_data");
  }

  return { ok: true, data: { periods }, error: null, code: null };
}
