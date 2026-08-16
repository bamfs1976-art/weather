/** One hour, summarised across every ensemble member. */
export interface EnsembleHour {
  timeISO: string;
  /** The middle member — a better single answer than any one run. */
  medianC: number | null;
  /** 10th and 90th percentile: eight members in ten fall inside this band. */
  p10C: number | null;
  p90C: number | null;
  /** Share of members producing at least 0.1 mm in this hour, 0–100. */
  rainChance: number | null;
  members: number;
}

export interface EnsembleForecast {
  model: string;
  note: string;
  members: number;
  hours: EnsembleHour[];
}
