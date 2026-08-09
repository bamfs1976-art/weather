export type PollenSpecies =
  | "grass"
  | "birch"
  | "alder"
  | "mugwort"
  | "olive"
  | "ragweed";

export type PollenBand = "none" | "low" | "moderate" | "high" | "very high";

export interface PollenHour {
  timeISO: string;
  /** Grains per cubic metre, per species. Null where the model has no value. */
  values: Record<PollenSpecies, number | null>;
}

export interface PollenPeak {
  species: PollenSpecies;
  label: string;
  /** Highest concentration in the next 24 hours. */
  value: number | null;
  band: PollenBand;
}

export interface PollenForecast {
  hours: PollenHour[];
  current: PollenHour | null;
  /** Index into `hours` of the current hour, so charts can mark "now". */
  currentIndex: number;
  /** Per-species peak over the next 24 hours, worst band first. */
  peaks: PollenPeak[];
  /** The worst band any species reaches in the next 24 hours. */
  overallBand: PollenBand;
}
