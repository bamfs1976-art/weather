import type { ConditionKind } from "./weather-format";

/** One hour of Met Office site-specific forecast, normalised to the app's units. */
export interface MetOfficeHour {
  timeISO: string;
  tempC: number | null;
  feelsLikeC: number | null;
  /** Probability of precipitation, 0–100. */
  pop: number | null;
  precipMM: number | null;
  windKPH: number | null;
  windGustKPH: number | null;
  windDirDEG: number | null;
  humidity: number | null;
  visibilityKM: number | null;
  pressureMB: number | null;
  uvi: number | null;
  /** Dew point at 1.5 m. Free — it is in every hourly response already. */
  dewPointC: number | null;
  precipRateMMH: number | null;
  snowMM: number | null;
  /** Max and min over the previous hour, and the hour's strongest gust. */
  maxTempC: number | null;
  minTempC: number | null;
  maxGustKPH: number | null;
  kind: ConditionKind;
  night: boolean;
}

/** A day or night half of a daily step, so the two read symmetrically. */
export interface MetOfficeHalf {
  /** Probability of any precipitation, 0–100. */
  pop: number | null;
  rain: number | null;
  heavyRain: number | null;
  snow: number | null;
  heavySnow: number | null;
  hail: number | null;
  /** Probability of a lightning strike within 50 km, 0–100. */
  sferics: number | null;
}

/**
 * A Met Office 95% confidence interval on a temperature.
 *
 * `lower` is the value there is a 97.5% probability of exceeding and `upper`
 * the value there is a 97.5% probability of staying below, so the gap between
 * them is how sure the Met Office is about that day.
 */
export interface MetOfficeBounds {
  lowerC: number | null;
  upperC: number | null;
}

/** One day of Met Office site-specific daily forecast, in the app's units. */
export interface MetOfficeDay {
  /** Midnight-to-midnight local day the entry covers. */
  timeISO: string;
  maxTempC: number | null;
  minTempC: number | null;
  maxFeelsLikeC: number | null;
  minFeelsLikeC: number | null;
  /** Daytime and night-time probability of precipitation, 0–100. */
  dayPop: number | null;
  nightPop: number | null;
  windKPH: number | null;
  windGustKPH: number | null;
  windDirDEG: number | null;
  humidity: number | null;
  visibilityKM: number | null;
  maxUvi: number | null;
  dayKind: ConditionKind;
  nightKind: ConditionKind;
  /** Per-type probabilities, day half and night half. */
  day: MetOfficeHalf;
  night: MetOfficeHalf;
  /** The Met Office's own confidence interval on the day's headline numbers. */
  maxTempBounds: MetOfficeBounds;
  minTempBounds: MetOfficeBounds;
  maxFeelsLikeBounds: MetOfficeBounds;
  minFeelsLikeBounds: MetOfficeBounds;
}

/** One three-hourly step: a period, so temperature comes as a max and a min. */
export interface MetOfficeStep {
  timeISO: string;
  maxTempC: number | null;
  minTempC: number | null;
  feelsLikeC: number | null;
  pop: number | null;
  precipMM: number | null;
  snowMM: number | null;
  windKPH: number | null;
  windGustKPH: number | null;
  maxGustKPH: number | null;
  windDirDEG: number | null;
  humidity: number | null;
  visibilityKM: number | null;
  pressureMB: number | null;
  uvi: number | null;
  rain: number | null;
  heavyRain: number | null;
  snow: number | null;
  hail: number | null;
  sferics: number | null;
  kind: ConditionKind;
  night: boolean;
}

export interface MetOfficeThreeHourly {
  siteName: string | null;
  distanceKM: number | null;
  steps: MetOfficeStep[];
  modelRunISO: string | null;
}

export interface MetOfficeDaily {
  siteName: string | null;
  distanceKM: number | null;
  days: MetOfficeDay[];
  modelRunISO: string | null;
}

export interface MetOfficeForecast {
  /** Name the Met Office gave the nearest forecast point. */
  siteName: string | null;
  distanceKM: number | null;
  hours: MetOfficeHour[];
  /** When the model run was issued, if the response says. */
  modelRunISO: string | null;
}

/** One hour where both providers have a value, ready to compare. */
export interface ComparisonHour {
  timeISO: string;
  xweatherTempC: number | null;
  metofficeTempC: number | null;
  /** Met Office minus Xweather, in °C. Positive means the Met Office is warmer. */
  tempDeltaC: number | null;
  xweatherPop: number | null;
  metofficePop: number | null;
  popDelta: number | null;
}

export interface ForecastComparison {
  hours: ComparisonHour[];
  /** Mean absolute temperature difference across the overlap, in °C. */
  meanAbsTempDeltaC: number | null;
  /** The hour where the two disagree most about temperature. */
  widestTemp: ComparisonHour | null;
  /** The hour where they disagree most about rain. */
  widestPop: ComparisonHour | null;
  /** Signed mean: consistently positive means one provider runs warmer. */
  biasC: number | null;
  /** Hours compared. Zero means the two never lined up. */
  overlap: number;
}
