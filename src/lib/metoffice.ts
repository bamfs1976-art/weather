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
import type {
  MetOfficeDaily,
  MetOfficeDay,
  MetOfficeForecast,
  MetOfficeHour,
  MetOfficeStep,
  MetOfficeThreeHourly,
} from "./metoffice-types";
import type { ConditionKind } from "./weather-format";

const BASE =
  process.env.METOFFICE_BASE_URL ??
  "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point";

/*
 * Cache lifetimes, in seconds. The free plan allows 360 calls a day, reset at
 * 00:00 UTC, and two endpoints are now in play rather than one.
 *
 * Half an hour each would be 96 calls a day for a single location — three
 * saved places and the allowance is gone before evening. An hour for the
 * hourly run and three for the daily is 32 a day per location, so eleven
 * places fit. Nothing is lost by it: the site-specific model runs hourly, and
 * the displayed "now" is chosen per request from the cached 48-hour series
 * rather than being whatever the cache happened to store, so a cached series
 * shows the right hour regardless of its age.
 */
const TTL = 3_600;
const TTL_DAILY = 10_800;
/** Three-hourly covers a week; three hours of cache is 8 calls a day. */
const TTL_THREE_HOURLY = 10_800;

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

  /*
   * Hourly fields that were being fetched and thrown away.
   *
   * The site-specific API does not support parameter subsetting — every
   * request returns all 18 hourly parameters whatever you intend to read — so
   * these cost nothing beyond the call already being made. The dew point in
   * particular was a live gap: NowPanel reads `dewpointC` for its tile and for
   * the "Comfortable / Humid" hints, and there was no Met Office field feeding
   * it, so those went blank the moment the Met Office became the primary.
   */
  screenDewPointTemperature?: number;
  precipitationRate?: number;
  totalSnowAmount?: number;
  maxScreenAirTemp?: number;
  minScreenAirTemp?: number;
  max10mWindGust?: number;

  /*
   * Daily-only fields. A daily step describes a whole day rather than an
   * instant, so the Met Office splits each measurement into a day and a night
   * half and prefixes it accordingly, and the wind and humidity values are
   * sampled at midday and midnight rather than averaged.
   *
   * Optional like everything else here — these names come from the published
   * documentation and no Met Office host is reachable from this build
   * environment, so a name that turns out to be wrong must yield null rather
   * than throw. /api/diagnostics reports whether the request worked at all,
   * and a card full of dashes with a successful request is the signature of a
   * wrong name rather than a wrong path.
   */
  daySignificantWeatherCode?: number;
  nightSignificantWeatherCode?: number;
  dayMaxScreenTemperature?: number;
  nightMinScreenTemperature?: number;
  dayMaxFeelsLikeTemp?: number;
  nightMinFeelsLikeTemp?: number;
  dayProbabilityOfPrecipitation?: number;
  nightProbabilityOfPrecipitation?: number;
  midday10MWindSpeed?: number;
  midnight10MWindSpeed?: number;
  midday10MWindGust?: number;
  midnight10MWindGust?: number;
  midday10MWindDirection?: number;
  midnight10MWindDirection?: number;
  middayRelativeHumidity?: number;
  midnightRelativeHumidity?: number;
  middayVisibility?: number;
  midnightVisibility?: number;
  maxUvIndex?: number;

  /*
   * The daily response carries 41 parameters and the app was reading 19. The
   * rest are the interesting ones, and they are already in every response.
   *
   * The bounds are a real Met Office confidence interval: the lower bound is
   * the value there is a 97.5% probability of exceeding, the upper the value
   * there is a 97.5% probability of staying below — a 95% interval on the day's
   * headline temperature, published per site, for free.
   */
  dayLowerBoundMaxTemp?: number;
  dayUpperBoundMaxTemp?: number;
  nightLowerBoundMinTemp?: number;
  nightUpperBoundMinTemp?: number;
  dayLowerBoundMaxFeelsLikeTemp?: number;
  dayUpperBoundMaxFeelsLikeTemp?: number;
  nightLowerBoundMinFeelsLikeTemp?: number;
  nightUpperBoundMinFeelsLikeTemp?: number;

  /*
   * Probability by precipitation type, rather than the one blended
   * probOfPrecipitation the app was showing. "Sferics" is a lightning strike
   * within 50 km — the Met Office's own answer to a card that currently costs
   * an Xweather access.
   */
  dayProbabilityOfRain?: number;
  nightProbabilityOfRain?: number;
  dayProbabilityOfHeavyRain?: number;
  nightProbabilityOfHeavyRain?: number;
  dayProbabilityOfSnow?: number;
  nightProbabilityOfSnow?: number;
  dayProbabilityOfHeavySnow?: number;
  nightProbabilityOfHeavySnow?: number;
  dayProbabilityOfHail?: number;
  nightProbabilityOfHail?: number;
  dayProbabilityOfSferics?: number;
  nightProbabilityOfSferics?: number;

  /*
   * Three-hourly names its own fields: there is no instantaneous
   * `screenTemperature` because a three-hour step is a period, and the
   * feels-like drops the "erature". Read tolerantly, with the hourly names as
   * fallbacks, so whichever spelling arrives is used.
   */
  feelsLikeTemp?: number;
  probOfRain?: number;
  probOfHeavyRain?: number;
  probOfSnow?: number;
  probOfHeavySnow?: number;
  probOfHail?: number;
  probOfSferics?: number;
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
/**
 * One site-specific request, as far as the time series.
 *
 * Shared by `hourly` and `daily` because every failure mode here belongs to
 * the product rather than to the action: the same key, the same 360-a-day
 * allowance, the same GeoJSON envelope. The two differ only in which fields
 * they read out of `timeSeries`, so that is the only part left to the callers.
 */
async function fetchTimeSeries(
  action: "hourly" | "three-hourly" | "daily",
  lat: number,
  lon: number,
  revalidate: number
): Promise<
  | { ok: true; feature: NonNullable<RawResponse["features"]>[number]; steps: RawTimeStep[] }
  | { ok: false; error: string; code: string }
> {
  const key = process.env.METOFFICE_API_KEY;
  if (!key) {
    return {
      ok: false,
      error:
        "Met Office data is off — set METOFFICE_API_KEY to switch it on. The free DataHub plan allows 360 calls a day.",
      code: "no_credentials",
    };
  }

  const url =
    `${BASE}/${action}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&excludeParameterMetadata=true&includeLocationName=true`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", apikey: key },
      next: { revalidate },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { ok: false, error: "The Met Office did not respond in time.", code: "timeout" };
    }
    return { ok: false, error: "Could not reach the Met Office.", code: "network" };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error:
        "The Met Office rejected the API key. Check METOFFICE_API_KEY and that the Site Specific product is subscribed on your DataHub account.",
      code: "unauthorised",
    };
  }
  if (res.status === 429) {
    return {
      ok: false,
      error:
        "Met Office daily request limit reached — the free plan allows 360 calls a day, resetting at midnight UTC.",
      code: "rate_limited",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `The Met Office returned HTTP ${res.status}.`,
      code: `http_${res.status}`,
    };
  }

  let raw: RawResponse;
  try {
    raw = (await res.json()) as RawResponse;
  } catch {
    return {
      ok: false,
      error: "The Met Office returned a response that was not JSON.",
      code: "bad_response",
    };
  }

  const feature = raw.features?.[0];
  const steps = feature?.properties?.timeSeries;
  if (!Array.isArray(steps) || steps.length === 0) {
    return {
      ok: false,
      error: "The Met Office returned no forecast for this point.",
      code: "warn_no_data",
    };
  }

  return { ok: true, feature: feature!, steps };
}

export async function getMetOfficeHourly(
  lat: number,
  lon: number
): Promise<Section<MetOfficeForecast>> {
  const answer = await fetchTimeSeries("hourly", lat, lon, TTL);
  if (!answer.ok) return fail<MetOfficeForecast>(answer.error, answer.code);
  const { feature, steps } = answer;

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
        dewPointC: num(step.screenDewPointTemperature),
        precipRateMMH: num(step.precipitationRate),
        snowMM: num(step.totalSnowAmount),
        maxTempC: num(step.maxScreenAirTemp),
        minTempC: num(step.minScreenAirTemp),
        maxGustKPH: (() => {
          const ms = num(step.max10mWindGust);
          return ms === null ? null : ms * 3.6;
        })(),
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

/**
 * Daily forecast for a point — the same site-specific product, `daily` action.
 *
 * **The field names below follow the published documentation and could not be
 * verified from this machine**, which is the same caveat the hourly parser
 * carries and the reason both are written the way they are: every field is
 * optional and coerced, so a name that turns out to be wrong yields null for
 * that value rather than throwing, and `/api/diagnostics` reports whether the
 * request itself worked. The *path* is not a guess — it is the action sibling
 * of the `hourly` endpoint already proven in production against the same
 * subscription, which is the distinction CLAUDE.md draws between adding an
 * action and hunting for a product.
 *
 * Cached for three hours: a daily forecast that moves within three hours is
 * not a daily forecast.
 */
export async function getMetOfficeDaily(
  lat: number,
  lon: number
): Promise<Section<MetOfficeDaily>> {
  const answer = await fetchTimeSeries("daily", lat, lon, TTL_DAILY);
  if (!answer.ok) return fail<MetOfficeDaily>(answer.error, answer.code);
  const { feature, steps } = answer;

  const days: MetOfficeDay[] = steps
    .map((step) => {
      const time = typeof step.time === "string" ? step.time : null;
      if (!time) return null;

      const dayCode = num(step.daySignificantWeatherCode);
      const nightCode = num(step.nightSignificantWeatherCode);
      const windMS = num(step.midday10MWindSpeed) ?? num(step.midnight10MWindSpeed);
      const gustMS = num(step.midday10MWindGust) ?? num(step.midnight10MWindGust);
      const visM = num(step.middayVisibility) ?? num(step.midnightVisibility);

      return {
        timeISO: time,
        maxTempC: num(step.dayMaxScreenTemperature),
        minTempC: num(step.nightMinScreenTemperature),
        maxFeelsLikeC: num(step.dayMaxFeelsLikeTemp),
        minFeelsLikeC: num(step.nightMinFeelsLikeTemp),
        dayPop: num(step.dayProbabilityOfPrecipitation),
        nightPop: num(step.nightProbabilityOfPrecipitation),
        windKPH: windMS === null ? null : windMS * 3.6,
        windGustKPH: gustMS === null ? null : gustMS * 3.6,
        windDirDEG:
          num(step.midday10MWindDirection) ?? num(step.midnight10MWindDirection),
        humidity:
          num(step.middayRelativeHumidity) ?? num(step.midnightRelativeHumidity),
        visibilityKM: visM === null ? null : visM / 1000,
        maxUvi: num(step.maxUvIndex),
        dayKind: (dayCode !== null ? WEATHER_CODES[dayCode]?.kind : undefined) ?? "unknown",
        nightKind:
          (nightCode !== null ? WEATHER_CODES[nightCode]?.kind : undefined) ?? "unknown",
        day: {
          pop: num(step.dayProbabilityOfPrecipitation),
          rain: num(step.dayProbabilityOfRain),
          heavyRain: num(step.dayProbabilityOfHeavyRain),
          snow: num(step.dayProbabilityOfSnow),
          heavySnow: num(step.dayProbabilityOfHeavySnow),
          hail: num(step.dayProbabilityOfHail),
          sferics: num(step.dayProbabilityOfSferics),
        },
        night: {
          pop: num(step.nightProbabilityOfPrecipitation),
          rain: num(step.nightProbabilityOfRain),
          heavyRain: num(step.nightProbabilityOfHeavyRain),
          snow: num(step.nightProbabilityOfSnow),
          heavySnow: num(step.nightProbabilityOfHeavySnow),
          hail: num(step.nightProbabilityOfHail),
          sferics: num(step.nightProbabilityOfSferics),
        },
        maxTempBounds: {
          lowerC: num(step.dayLowerBoundMaxTemp),
          upperC: num(step.dayUpperBoundMaxTemp),
        },
        minTempBounds: {
          lowerC: num(step.nightLowerBoundMinTemp),
          upperC: num(step.nightUpperBoundMinTemp),
        },
        maxFeelsLikeBounds: {
          lowerC: num(step.dayLowerBoundMaxFeelsLikeTemp),
          upperC: num(step.dayUpperBoundMaxFeelsLikeTemp),
        },
        minFeelsLikeBounds: {
          lowerC: num(step.nightLowerBoundMinFeelsLikeTemp),
          upperC: num(step.nightUpperBoundMinFeelsLikeTemp),
        },
      } satisfies MetOfficeDay;
    })
    .filter((day): day is MetOfficeDay => day !== null);

  if (days.length === 0) {
    return fail<MetOfficeDaily>("The Met Office response held no usable days.", "bad_response");
  }

  const distance = num(feature?.properties?.requestPointDistance);

  return {
    ok: true,
    data: {
      siteName: feature?.properties?.location?.name ?? null,
      distanceKM: distance === null ? null : distance / 1000,
      days,
      modelRunISO:
        typeof feature?.properties?.modelRunDate === "string"
          ? feature.properties.modelRunDate
          : null,
    },
    error: null,
    code: null,
  };
}

/**
 * Three-hourly forecast — 168 hours, so a full week at three-hour resolution.
 *
 * The third of the three site-specific actions, and the one the app was not
 * using. It shares the same free 360-a-day allowance as `hourly` and `daily`,
 * costs 8 calls a day at this cache, and is the only one of the three that
 * reaches beyond 48 hours at sub-daily resolution.
 *
 * A three-hour step is a *period*, so its field names differ from hourly in
 * two ways that matter: there is no instantaneous `screenTemperature` (the
 * temperature arrives as a max and a min over the step), and the feels-like
 * loses its "erature". Both hourly spellings are accepted as fallbacks so
 * whichever the gateway actually sends is the one used — the same tolerance
 * the rest of this file applies, for the same reason.
 */
export async function getMetOfficeThreeHourly(
  lat: number,
  lon: number
): Promise<Section<MetOfficeThreeHourly>> {
  const answer = await fetchTimeSeries("three-hourly", lat, lon, TTL_THREE_HOURLY);
  if (!answer.ok) return fail<MetOfficeThreeHourly>(answer.error, answer.code);
  const { feature, steps } = answer;

  const out: MetOfficeStep[] = steps
    .map((step) => {
      const time = typeof step.time === "string" ? step.time : null;
      if (!time) return null;
      const code = num(step.significantWeatherCode);
      const mapped = code !== null ? WEATHER_CODES[code] : undefined;
      const windMS = num(step.windSpeed10m);
      const gustMS = num(step.windGustSpeed10m);
      const maxGustMS = num(step.max10mWindGust);
      const visM = num(step.visibility);
      const pressurePa = num(step.mslp);

      return {
        timeISO: time,
        maxTempC: num(step.maxScreenAirTemp) ?? num(step.screenTemperature),
        minTempC: num(step.minScreenAirTemp) ?? num(step.screenTemperature),
        feelsLikeC: num(step.feelsLikeTemp) ?? num(step.feelsLikeTemperature),
        pop: num(step.probOfPrecipitation),
        precipMM: num(step.totalPrecipAmount),
        snowMM: num(step.totalSnowAmount),
        windKPH: windMS === null ? null : windMS * 3.6,
        windGustKPH: gustMS === null ? null : gustMS * 3.6,
        maxGustKPH: maxGustMS === null ? null : maxGustMS * 3.6,
        windDirDEG: num(step.windDirectionFrom10m),
        humidity: num(step.screenRelativeHumidity),
        visibilityKM: visM === null ? null : visM / 1000,
        pressureMB: pressurePa === null ? null : pressurePa / 100,
        uvi: num(step.uvIndex),
        rain: num(step.probOfRain),
        heavyRain: num(step.probOfHeavyRain),
        snow: num(step.probOfSnow),
        hail: num(step.probOfHail),
        sferics: num(step.probOfSferics),
        kind: mapped?.kind ?? "unknown",
        night: mapped?.night ?? false,
      } satisfies MetOfficeStep;
    })
    .filter((step): step is MetOfficeStep => step !== null);

  if (out.length === 0) {
    return fail<MetOfficeThreeHourly>(
      "The Met Office response held no usable three-hourly steps.",
      "bad_response"
    );
  }

  const distance = num(feature?.properties?.requestPointDistance);

  return {
    ok: true,
    data: {
      siteName: feature?.properties?.location?.name ?? null,
      distanceKM: distance === null ? null : distance / 1000,
      steps: out,
      modelRunISO:
        typeof feature?.properties?.modelRunDate === "string"
          ? feature.properties.modelRunDate
          : null,
    },
    error: null,
    code: null,
  };
}
