import type { Section } from "./weather-types";

/** A live measurement series at a river/sea gauge. */
export interface RiverMeasure {
  id: string;
  /** "level" or "flow". */
  parameter: string;
  parameterName: string;
  /** "Stage", "Downstream Stage", "Tidal Level"… */
  qualifier: string | null;
  unit: string | null;
  value: number | null;
  dateTimeISO: string | null;
  typicalLow: number | null;
  typicalHigh: number | null;
  maxOnRecord: number | null;
  /** 0 at the bottom of the typical range, 1 at the top. >1 is above typical. */
  rangePosition: number | null;
  state: "low" | "normal" | "high" | "unknown";
}

export interface RiverStation {
  id: string;
  label: string;
  riverName: string | null;
  town: string | null;
  catchment: string | null;
  lat: number | null;
  lon: number | null;
  distanceKM: number | null;
  measures: RiverMeasure[];
}

export interface FloodWarning {
  id: string;
  severity: string;
  /** 1 severe flood warning · 2 flood warning · 3 flood alert · 4 no longer in force. */
  severityLevel: number;
  description: string;
  message: string | null;
  riverOrSea: string | null;
  county: string | null;
  timeRaisedISO: string | null;
}

export interface MarineHour {
  timeISO: string;
  waveHeightM: number | null;
  waveDirectionDeg: number | null;
  wavePeriodS: number | null;
  swellHeightM: number | null;
  seaTempC: number | null;
}

export interface MarineConditions {
  hours: MarineHour[];
  current: MarineHour | null;
  maxWaveM: number | null;
  maxWaveAtISO: string | null;
}

export interface WaterPayload {
  place: { lat: number; lon: number; name: string };
  fetchedAt: string;
  sections: {
    floods: Section<FloodWarning[]>;
    rivers: Section<RiverStation[]>;
    marine: Section<MarineConditions>;
  };
}
