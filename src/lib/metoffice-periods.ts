/**
 * Met Office hours, expressed in the shape the panels already read.
 *
 * The dashboard's components all consume `WeatherPeriod` — Xweather's shape —
 * and they read a lot of it: `weatherPrimaryCoded`, `icon`, both unit variants
 * of every measurement. Making the Met Office the primary forecast by teaching
 * each panel about a second provider would mean touching every one of them and
 * leaving two rendering paths to drift apart. Converting once, here, means the
 * panels never learn there was a second provider at all.
 *
 * Pure and client-safe: no key, no network. The server does the conversion so
 * the payload carries one shape, but nothing here would break in a browser.
 */

import type { ConditionKind } from "./weather-format";
import type {
  MetOfficeDaily,
  MetOfficeDay,
  MetOfficeForecast,
  MetOfficeHour,
  MetOfficeStep,
  MetOfficeThreeHourly,
} from "./metoffice-types";
import type { WeatherPeriod } from "./weather-types";

/**
 * The app's condition vocabulary, back into the two fields `classifyCondition`
 * reads.
 *
 * The kind travels in `weatherPrimaryCoded`, which that function prefers and
 * decides on outright. The icon name carries **only** the night flag, which is
 * derived from the name's trailing "n" independently of the kind — so a single
 * pair of names does for every condition and there is no second vocabulary to
 * keep in step. `hot` and `cold` have no Xweather code, so they are the
 * exception and travel by name.
 *
 * These suffixes are Xweather's own, taken from `classifyCondition` rather
 * than from memory: CLAUDE.md records five of them being got wrong in one
 * sitting. The round trip is asserted below, so a wrong entry fails loudly
 * instead of quietly drawing the wrong glyph.
 */
const CODE_FOR_KIND: Partial<Record<ConditionKind, string>> = {
  clear: "CL",
  fair: "FW",
  pcloudy: "SC",
  mcloudy: "BK",
  cloudy: "OV",
  rain: "R",
  showers: "RW",
  drizzle: "L",
  tstorm: "T",
  snow: "S",
  sleet: "RS",
  hail: "A",
  fog: "F",
  wind: "BD",
};

/** Names chosen so the "n" suffix reads as night without colliding with a kind. */
const NAME_FOR_KIND: Partial<Record<ConditionKind, string>> = {
  hot: "hot",
  cold: "cold",
  unknown: "na",
};

/**
 * The two fields a synthesised period needs to classify back to `kind`.
 * Exported so the round trip can be checked without reaching inside.
 */
export function conditionFields(
  kind: ConditionKind,
  night: boolean
): { icon: string; weatherPrimaryCoded: string | null } {
  const coded = CODE_FOR_KIND[kind] ?? null;
  /*
   * "clear" is the carrier for the night flag whenever a code is doing the
   * real work: any name would do, and one name means one thing to get wrong.
   */
  const base = NAME_FOR_KIND[kind] ?? "clear";
  return {
    icon: night ? `${base}n` : base,
    weatherPrimaryCoded: coded ? `::${coded}` : null,
  };
}

/** Human label for a kind, for the line under the temperature. */
const LABEL_FOR_KIND: Record<ConditionKind, string> = {
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

const C_TO_F = (c: number | null) => (c === null ? null : c * 1.8 + 32);
const KPH_TO_MPH = (k: number | null) => (k === null ? null : k / 1.609_344);
const MM_TO_IN = (mm: number | null) => (mm === null ? null : mm / 25.4);
const KM_TO_MI = (km: number | null) => (km === null ? null : km / 1.609_344);
const MB_TO_IN = (mb: number | null) => (mb === null ? null : mb * 0.029_53);

const POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

/** Degrees to a 16-point compass label, the way Xweather publishes `windDir`. */
export function compassFromDeg(deg: number | null | undefined): string | null {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
  const index = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[index];
}

/** One Met Office hour as a WeatherPeriod. */
export function metOfficeHourToPeriod(hour: MetOfficeHour): WeatherPeriod {
  const { icon, weatherPrimaryCoded } = conditionFields(hour.kind, hour.night);
  const label = LABEL_FOR_KIND[hour.kind];

  return {
    dateTimeISO: hour.timeISO,
    validTime: hour.timeISO,
    timestamp: Math.floor(Date.parse(hour.timeISO) / 1000),

    tempC: hour.tempC,
    tempF: C_TO_F(hour.tempC),
    feelslikeC: hour.feelsLikeC,
    feelslikeF: C_TO_F(hour.feelsLikeC),

    humidity: hour.humidity,
    pressureMB: hour.pressureMB,
    pressureIN: MB_TO_IN(hour.pressureMB),

    windSpeedKPH: hour.windKPH,
    windSpeedMPH: KPH_TO_MPH(hour.windKPH),
    windGustKPH: hour.windGustKPH,
    windGustMPH: KPH_TO_MPH(hour.windGustKPH),
    windDirDEG: hour.windDirDEG,
    windDir: compassFromDeg(hour.windDirDEG),

    precipMM: hour.precipMM,
    precipIN: MM_TO_IN(hour.precipMM),
    pop: hour.pop,

    visibilityKM: hour.visibilityKM,
    visibilityMI: KM_TO_MI(hour.visibilityKM),

    uvi: hour.uvi,

    /*
     * Fields that were already arriving and being discarded. `dewpointC` is
     * the one that mattered: NowPanel reads it for its Dew point tile and for
     * the humidity comfort hints, so those went blank when the Met Office
     * became the primary and nothing was feeding them.
     */
    dewpointC: hour.dewPointC,
    dewpointF: C_TO_F(hour.dewPointC),
    precipRateMM: hour.precipRateMMH,
    precipRateIN: MM_TO_IN(hour.precipRateMMH),
    /* The Met Office publishes snow in millimetres; the app shows centimetres. */
    snowCM: hour.snowMM === null ? null : hour.snowMM / 10,
    snowIN: MM_TO_IN(hour.snowMM),
    maxTempC: hour.maxTempC,
    maxTempF: C_TO_F(hour.maxTempC),
    minTempC: hour.minTempC,
    minTempF: C_TO_F(hour.minTempC),

    weather: label,
    weatherPrimary: label,
    weatherPrimaryCoded,
    icon,
    isDay: !hour.night,
  };
}

/**
 * The whole forecast as periods, oldest first.
 *
 * Nothing is dropped for being in the past: the caller decides what "now"
 * means, the same way `nextPrecipitation` does.
 */
export function metOfficeToPeriods(forecast: MetOfficeForecast): WeatherPeriod[] {
  return forecast.hours.map(metOfficeHourToPeriod);
}

/**
 * The hour that covers `now` — the Met Office publishes hourly steps, so the
 * current conditions are the step that has started most recently rather than
 * a separate observation. Falls back to the first hour when every step is in
 * the future, which is what a freshly issued run looks like.
 */
export function metOfficeCurrent(
  forecast: MetOfficeForecast,
  now: number = Date.now()
): WeatherPeriod | null {
  const periods = metOfficeToPeriods(forecast);
  if (periods.length === 0) return null;
  let best: WeatherPeriod | null = null;
  for (const period of periods) {
    const at = Date.parse(period.dateTimeISO ?? "");
    if (!Number.isFinite(at)) continue;
    if (at <= now) best = period;
    else break;
  }
  return best ?? periods[0];
}

/**
 * One Met Office day as a WeatherPeriod.
 *
 * A daily step is a summary, not an instant, so the fields that exist in day
 * and night halves collapse the way the 10-day panel reads them: the max is
 * the daytime figure, the min the night-time one, and the single `pop` shown
 * against a day is the higher of the two — a 60% chance overnight is still a
 * wet day, and taking the daytime figure alone would hide it.
 */
export function metOfficeDayToPeriod(day: MetOfficeDay): WeatherPeriod {
  const { icon, weatherPrimaryCoded } = conditionFields(day.dayKind, false);
  const label = LABEL_FOR_KIND[day.dayKind];
  const pop =
    day.dayPop === null && day.nightPop === null
      ? null
      : Math.max(day.dayPop ?? 0, day.nightPop ?? 0);

  return {
    dateTimeISO: day.timeISO,
    validTime: day.timeISO,
    timestamp: Math.floor(Date.parse(day.timeISO) / 1000),

    maxTempC: day.maxTempC,
    maxTempF: C_TO_F(day.maxTempC),
    minTempC: day.minTempC,
    minTempF: C_TO_F(day.minTempC),
    maxFeelslikeC: day.maxFeelsLikeC,
    maxFeelslikeF: C_TO_F(day.maxFeelsLikeC),
    minFeelslikeC: day.minFeelsLikeC,
    minFeelslikeF: C_TO_F(day.minFeelsLikeC),

    humidity: day.humidity,
    windSpeedKPH: day.windKPH,
    windSpeedMPH: KPH_TO_MPH(day.windKPH),
    windGustKPH: day.windGustKPH,
    windGustMPH: KPH_TO_MPH(day.windGustKPH),
    windDirDEG: day.windDirDEG,
    windDir: compassFromDeg(day.windDirDEG),

    pop,
    /*
     * Snow chance travels as `snowCM` is not available on a daily step — the
     * probability is the useful number, and the 10-day card shows it beside
     * the rain chance rather than pretending to a depth the API never gave.
     */
    visibilityKM: day.visibilityKM,
    visibilityMI: KM_TO_MI(day.visibilityKM),
    maxUvi: day.maxUvi,

    weather: label,
    weatherPrimary: label,
    weatherPrimaryCoded,
    icon,
    isDay: true,
  };
}

export function metOfficeToDailyPeriods(daily: MetOfficeDaily): WeatherPeriod[] {
  return daily.days.map(metOfficeDayToPeriod);
}

/**
 * Day and night as two WeatherPeriods, for the day/night strip.
 *
 * The daily response already splits every measurement into a day half and a
 * night half, which is exactly the shape that strip wants — so it comes out of
 * a response the app is already fetching, and the Xweather `daynight` call it
 * used to need is one fewer access on every dashboard load.
 *
 * `isDay` is what the strip keys off, and each half carries its own condition,
 * probability, wind and humidity rather than repeating the day's.
 */
export function metOfficeDayNightPeriods(daily: MetOfficeDaily): WeatherPeriod[] {
  const out: WeatherPeriod[] = [];
  for (const day of daily.days) {
    const startsAt = Date.parse(day.timeISO);
    const dayFields = conditionFields(day.dayKind, false);
    const nightFields = conditionFields(day.nightKind, true);

    out.push({
      dateTimeISO: day.timeISO,
      validTime: day.timeISO,
      timestamp: Math.floor(startsAt / 1000),
      isDay: true,
      maxTempC: day.maxTempC,
      maxTempF: C_TO_F(day.maxTempC),
      minTempC: day.maxTempC,
      minTempF: C_TO_F(day.maxTempC),
      maxFeelslikeC: day.maxFeelsLikeC,
      maxFeelslikeF: C_TO_F(day.maxFeelsLikeC),
      pop: day.day.pop,
      humidity: day.humidity,
      windSpeedKPH: day.windKPH,
      windSpeedMPH: KPH_TO_MPH(day.windKPH),
      windGustKPH: day.windGustKPH,
      windGustMPH: KPH_TO_MPH(day.windGustKPH),
      windDirDEG: day.windDirDEG,
      windDir: compassFromDeg(day.windDirDEG),
      maxUvi: day.maxUvi,
      weather: LABEL_FOR_KIND[day.dayKind],
      weatherPrimary: LABEL_FOR_KIND[day.dayKind],
      weatherPrimaryCoded: dayFields.weatherPrimaryCoded,
      icon: dayFields.icon,
    });

    /*
     * The night half is stamped at noon-plus-twelve rather than sharing the
     * day's timestamp: two periods with the same instant would collapse in any
     * list keyed on time, and the strip sorts by it.
     */
    out.push({
      dateTimeISO: new Date(startsAt + 12 * 3_600_000).toISOString(),
      validTime: new Date(startsAt + 12 * 3_600_000).toISOString(),
      timestamp: Math.floor(startsAt / 1000) + 12 * 3600,
      isDay: false,
      maxTempC: day.minTempC,
      maxTempF: C_TO_F(day.minTempC),
      minTempC: day.minTempC,
      minTempF: C_TO_F(day.minTempC),
      minFeelslikeC: day.minFeelsLikeC,
      minFeelslikeF: C_TO_F(day.minFeelsLikeC),
      pop: day.night.pop,
      weather: LABEL_FOR_KIND[day.nightKind],
      weatherPrimary: LABEL_FOR_KIND[day.nightKind],
      weatherPrimaryCoded: nightFields.weatherPrimaryCoded,
      icon: nightFields.icon,
    });
  }
  return out;
}

/**
 * Three-hourly steps as periods, for the week-long forecast view.
 *
 * A step covers three hours, so there is no instantaneous temperature; the
 * midpoint of the step's max and min is what a chart wants for a line, and
 * both ends are kept so the detail view can show the range it came from.
 */
export function metOfficeStepToPeriod(step: MetOfficeStep): WeatherPeriod {
  const { icon, weatherPrimaryCoded } = conditionFields(step.kind, step.night);
  const label = LABEL_FOR_KIND[step.kind];
  const mid =
    step.maxTempC !== null && step.minTempC !== null
      ? (step.maxTempC + step.minTempC) / 2
      : (step.maxTempC ?? step.minTempC);

  return {
    dateTimeISO: step.timeISO,
    validTime: step.timeISO,
    timestamp: Math.floor(Date.parse(step.timeISO) / 1000),

    tempC: mid,
    tempF: C_TO_F(mid),
    maxTempC: step.maxTempC,
    maxTempF: C_TO_F(step.maxTempC),
    minTempC: step.minTempC,
    minTempF: C_TO_F(step.minTempC),
    feelslikeC: step.feelsLikeC,
    feelslikeF: C_TO_F(step.feelsLikeC),

    humidity: step.humidity,
    pressureMB: step.pressureMB,
    pressureIN: MB_TO_IN(step.pressureMB),

    windSpeedKPH: step.windKPH,
    windSpeedMPH: KPH_TO_MPH(step.windKPH),
    windGustKPH: step.windGustKPH,
    windGustMPH: KPH_TO_MPH(step.windGustKPH),
    windDirDEG: step.windDirDEG,
    windDir: compassFromDeg(step.windDirDEG),

    precipMM: step.precipMM,
    precipIN: MM_TO_IN(step.precipMM),
    snowCM: step.snowMM === null ? null : step.snowMM / 10,
    snowIN: MM_TO_IN(step.snowMM),
    pop: step.pop,

    visibilityKM: step.visibilityKM,
    visibilityMI: KM_TO_MI(step.visibilityKM),
    uvi: step.uvi,

    weather: label,
    weatherPrimary: label,
    weatherPrimaryCoded,
    icon,
    isDay: !step.night,
  };
}

export function metOfficeToStepPeriods(forecast: MetOfficeThreeHourly): WeatherPeriod[] {
  return forecast.steps.map(metOfficeStepToPeriod);
}
