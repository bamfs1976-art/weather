/** MET Norway Locationforecast, in this app's own units and vocabulary. */

import type { ConditionKind } from "./weather-format";

export interface MetNoHour {
  timeISO: string;
  tempC: number | null;
  feelsLikeC: number | null;
  humidity: number | null;
  pressureMB: number | null;
  windSpeedKPH: number | null;
  windDirDEG: number | null;
  cloudCover: number | null;
  /** Millimetres in the hour beginning at timeISO. */
  precipMM: number | null;
  /** Probability of precipitation, where MET Norway supplies one. */
  pop: number | null;
  symbol: string | null;
  kind: ConditionKind;
  night: boolean;
}

export interface MetNoForecast {
  updatedISO: string | null;
  hours: MetNoHour[];
}
