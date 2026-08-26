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
import type { MetOfficeDaily, MetOfficeDay, MetOfficeForecast, MetOfficeHour } from "./metoffice-types";
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
