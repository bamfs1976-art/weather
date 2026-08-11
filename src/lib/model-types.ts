/** Per-model forecast series and the disagreement between them. */

export interface ModelSeries {
  id: string;
  label: string;
  centre: string;
  /** Temperature in °C per hour, aligned to `hours` below by index. */
  tempC: (number | null)[];
  precipMM: (number | null)[];
}

export interface ModelSpread {
  /** Absolute instants every series is aligned to. */
  hours: string[];
  models: ModelSeries[];
  /** Per hour: the widest disagreement in °C across the models that answered. */
  spreadC: (number | null)[];
  /** Mean temperature across models, which is usually better than any one. */
  meanC: (number | null)[];
  /** Models asked for but unavailable, so the card can say so rather than imply agreement. */
  missing: string[];
}
