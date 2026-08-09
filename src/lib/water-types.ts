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

/** One observed sea level at a tide gauge. */
export interface TideReading {
  timeISO: string;
  levelM: number;
}

/** A high or low water that has already occurred, found in the level series. */
export interface TideExtreme extends TideReading {
  kind: "high" | "low";
}

export interface TideGauge {
  id: string;
  label: string;
  distanceKM: number | null;
  unit: string | null;
  latest: TideReading | null;
  /** The last 48 hours, oldest first. */
  readings: TideReading[];
  extremes: TideExtreme[];
  /** Peak-to-trough over the series — a rough spring/neap indicator. */
  rangeM: number | null;
  /** Null when the last two readings are identical, i.e. at the turn. */
  rising: boolean | null;
  /** Which query form produced the series — reported by diagnostics. */
  via?: string | null;
}

export interface BathingWater {
  id: string;
  name: string;
  district: string | null;
  lat: number | null;
  lon: number | null;
  distanceKM: number | null;
  /** Most recent in-season sample; null outside the sampling season. */
  latestSampleISO: string | null;
  /** Excellent · Good · Sufficient · Poor, for that single sample. */
  latestSampleClass: string | null;
  /** The published annual classification, from four years of samples. */
  annualClass: string | null;
  profileUrl: string | null;
  /** Which query form produced this — reported by diagnostics. */
  via?: string | null;
}

export interface WaterPayload {
  place: { lat: number; lon: number; name: string };
  fetchedAt: string;
  sections: {
    floods: Section<FloodWarning[]>;
    rivers: Section<RiverStation[]>;
    marine: Section<MarineConditions>;
    tides: Section<TideGauge>;
    bathing: Section<BathingWater[]>;
  };
}
