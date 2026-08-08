import type { Section } from "./weather-types";

/* ----------------------------- carbon ----------------------------- */

export interface GenerationFuel {
  fuel: string;
  percent: number;
}

export interface CarbonPeriod {
  fromISO: string;
  toISO: string;
  forecast: number | null;
  actual: number | null;
  /** "very low" | "low" | "moderate" | "high" | "very high" */
  index: string | null;
}

export interface CarbonIntensity {
  regionName: string | null;
  dnoRegion: string | null;
  postcode: string | null;
  current: CarbonPeriod | null;
  /** Half-hourly periods for the next 24 hours. */
  forecast: CarbonPeriod[];
  generationMix: GenerationFuel[];
  /** Cleanest upcoming half-hour slot, for "when to run the washing machine". */
  greenest: CarbonPeriod | null;
  dirtiest: CarbonPeriod | null;
}

/* ------------------------------ crime ----------------------------- */

export interface CrimeCategoryCount {
  category: string;
  label: string;
  count: number;
}

export interface CrimeSummary {
  /** Month the data covers, "YYYY-MM". Police data lags by roughly two months. */
  month: string;
  total: number;
  categories: CrimeCategoryCount[];
  /** Streets with the most reports that month. */
  topStreets: { name: string; count: number }[];
  neighbourhood: { force: string; name: string; id: string } | null;
  radiusMiles: number;
}

/* ---------------------------- football ---------------------------- */

export interface Fixture {
  id: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  utcDateISO: string;
  status: string;
  matchday: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  venueIsHome: boolean;
}

export interface TeamForm {
  teamName: string;
  crestUrl: string | null;
  competition: string | null;
  position: number | null;
  playedGames: number | null;
  points: number | null;
  won: number | null;
  draw: number | null;
  lost: number | null;
  goalDifference: number | null;
  next: Fixture[];
  recent: Fixture[];
}

/* ----------------------------- marine ----------------------------- */

export interface MarineHour {
  timeISO: string;
  waveHeightM: number | null;
  waveDirectionDeg: number | null;
  wavePeriodS: number | null;
  swellHeightM: number | null;
  seaTempC: number | null;
}

export interface MarineConditions {
  latitude: number;
  longitude: number;
  hours: MarineHour[];
  current: MarineHour | null;
  maxWaveM: number | null;
}

/* ---------------------------- payload ----------------------------- */

export interface LocalPayload {
  place: { lat: number; lon: number; name: string };
  fetchedAt: string;
  sections: {
    carbon: Section<CarbonIntensity>;
    crime: Section<CrimeSummary>;
    football: Section<TeamForm>;
  };
}
