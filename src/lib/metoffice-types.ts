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
  kind: ConditionKind;
  night: boolean;
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
