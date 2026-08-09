/**
 * SERVER ONLY — Met Office Weather DataHub client.
 *
 * Site-specific ("Global Spot") forecasts, added as a second opinion beside
 * Xweather rather than as a replacement: it has no nowcast, no radar rasters
 * and no archive, which is most of what this app does.
 *
 * https://datahub.metoffice.gov.uk/docs/f/category/site-specific/overview
 *
 * Two things shape the whole design here:
 *
 *  1. **The free plan allows 360 requests a day**, reset at 00:00 UTC. That is
 *     generous for one location and easy to burn through with a few saved
 *     places and an itchy refresh finger, so responses are cached for half an
 *     hour — 48 calls a day per location — and the route never retries.
 *
 *  2. **The response shape could not be verified from this machine.** Every
 *     Met Office host is unreachable from the build environment, so the parsing
 *     below follows the published documentation and is deliberately tolerant:
 *     every field is optional, every value is coerced, and a shape that does
 *     not match returns a Section error rather than throwing. /api/diagnostics
 *     reports whether it actually worked.
 */

import type { Section } from "./weather-types";
import type { MetOfficeForecast, MetOfficeHour } from "./metoffice-types";
import type { ConditionKind } from "./weather-format";

const BASE =
  process.env.METOFFICE_BASE_URL ??
  "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point";

/** Half an hour: 48 calls a day per location, well inside the free 360. */
const TTL = 1_800;

export function hasMetOfficeKey(): boolean {
  return Boolean(process.env.METOFFICE_API_KEY);
}

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Met Office significant weather codes.
 *
 * Mapped onto the app's own condition vocabulary so one icon component serves
 * both providers. -1 means "not available"; the daytime/night split is carried
 * by the code itself rather than by a separate flag.
 * https://datahub.metoffice.gov.uk/docs/f/category/site-specific/type/site-specific/api-documentation
 */
const WEATHER_CODES: Record<number, { kind: ConditionKind; night: boolean }> = {
  0: { kind: "clear", night: true },
  1: { kind: "clear", night: false },
  2: { kind: "pcloudy", night: true },
  3: { kind: "pcloudy", night: false },
  5: { kind: "fog", night: false },
  6: { kind: "fog", night: false },
  7: { kind: "mcloudy", night: false },
  8: { kind: "cloudy", night: false },
  9: { kind: "showers", night: true },
  10: { kind: "showers", night: false },
  11: { kind: "drizzle", night: false },
  12: { kind: "rain", night: false },
  13: { kind: "showers", night: true },
  14: { kind: "showers", night: false },
  15: { kind: "rain", night: false },
  16: { kind: "sleet", night: true },
  17: { kind: "sleet", night: false },
  18: { kind: "sleet", night: false },
  19: { kind: "hail", night: true },
  20: { kind: "hail", night: false },
  21: { kind: "hail", night: false },
  22: { kind: "snow", night: true },
  23: { kind: "snow", night: false },
  24: { kind: "snow", night: false },
  25: { kind: "snow", night: true },
  26: { kind: "snow", night: false },
  27: { kind: "snow", night: false },
  28: { kind: "tstorm", night: true },
  29: { kind: "tstorm", night: false },
  30: { kind: "tstorm", night: false },
};

interface RawTimeStep {
  time?: string;
  screenTemperature?: number;
  feelsLikeTemperature?: number;
  probOfPrecipitation?: number;
  totalPrecipAmount?: number;
  windSpeed10m?: number;
  windGustSpeed10m?: number;
  windDirectionFrom10m?: number;
  screenRelativeHumidity?: number;
  visibility?: number;
  mslp?: number;
  uvIndex?: number;
  significantWeatherCode?: number;
}

interface RawResponse {
  features?: {
    geometry?: { coordinates?: number[] };
    properties?: {
      location?: { name?: string };
      requestPointDistance?: number;
      modelRunDate?: string;
      timeSeries?: RawTimeStep[];
    };
  }[];
}

/**
 * Hourly forecast for a point.
 *
 * Values arrive in SI — metres per second, pascals, metres — and are converted
 * here so the rest of the app never has to know which provider a number came
 * from.
 */
export async function getMetOfficeHourly(
  lat: number,
  lon: number
): Promise<Section<MetOfficeForecast>> {
  const key = process.env.METOFFICE_API_KEY;
  if (!key) {
    return fail<MetOfficeForecast>(
      "Met Office comparison is off — set METOFFICE_API_KEY to switch it on. The free DataHub plan allows 360 calls a day.",
      "no_credentials"
    );
  }

  const url =
    `${BASE}/hourly?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&excludeParameterMetadata=true&includeLocationName=true`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", apikey: key },
      next: { revalidate: TTL },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return fail<MetOfficeForecast>("The Met Office did not respond in time.", "timeout");
    }
    return fail<MetOfficeForecast>("Could not reach the Met Office.", "network");
  }

  if (res.status === 401 || res.status === 403) {
    return fail<MetOfficeForecast>(
      "The Met Office rejected the API key. Check METOFFICE_API_KEY and that the Site Specific product is subscribed on your DataHub account.",
      "unauthorised"
    );
  }
  if (res.status === 429) {
    return fail<MetOfficeForecast>(
      "Met Office daily request limit reached — the free plan allows 360 calls a day, resetting at midnight UTC.",
      "rate_limited"
    );
  }
  if (!res.ok) {
    return fail<MetOfficeForecast>(
      `The Met Office returned HTTP ${res.status}.`,
      `http_${res.status}`
    );
  }

  let raw: RawResponse;
  try {
    raw = (await res.json()) as RawResponse;
  } catch {
    return fail<MetOfficeForecast>(
      "The Met Office returned a response that was not JSON.",
      "bad_response"
    );
  }

  const feature = raw.features?.[0];
  const steps = feature?.properties?.timeSeries;
  if (!Array.isArray(steps) || steps.length === 0) {
    return fail<MetOfficeForecast>(
      "The Met Office returned no forecast for this point.",
      "warn_no_data"
    );
  }

  const hours: MetOfficeHour[] = steps
    .map((step) => {
      const time = typeof step.time === "string" ? step.time : null;
      if (!time) return null;
      const code = num(step.significantWeatherCode);
      const mapped = code !== null ? WEATHER_CODES[code] : undefined;
      const windMS = num(step.windSpeed10m);
      const gustMS = num(step.windGustSpeed10m);
      const visM = num(step.visibility);
      const pressurePa = num(step.mslp);

      return {
        timeISO: time,
        tempC: num(step.screenTemperature),
        feelsLikeC: num(step.feelsLikeTemperature),
        pop: num(step.probOfPrecipitation),
        precipMM: num(step.totalPrecipAmount),
        // m/s to km/h.
        windKPH: windMS === null ? null : windMS * 3.6,
        windGustKPH: gustMS === null ? null : gustMS * 3.6,
        windDirDEG: num(step.windDirectionFrom10m),
        humidity: num(step.screenRelativeHumidity),
        // metres to kilometres, pascals to millibars.
        visibilityKM: visM === null ? null : visM / 1000,
        pressureMB: pressurePa === null ? null : pressurePa / 100,
        uvi: num(step.uvIndex),
        kind: mapped?.kind ?? "unknown",
        night: mapped?.night ?? false,
      } satisfies MetOfficeHour;
    })
    .filter((hour): hour is MetOfficeHour => hour !== null);

  if (hours.length === 0) {
    return fail<MetOfficeForecast>(
      "The Met Office response held no usable hours.",
      "bad_response"
    );
  }

  const distance = num(feature?.properties?.requestPointDistance);

  return {
    ok: true,
    data: {
      siteName: feature?.properties?.location?.name ?? null,
      // The distance is published in metres from the requested point.
      distanceKM: distance === null ? null : distance / 1000,
      hours,
      modelRunISO:
        typeof feature?.properties?.modelRunDate === "string"
          ? feature.properties.modelRunDate
          : null,
    },
    error: null,
    code: null,
  };
}
