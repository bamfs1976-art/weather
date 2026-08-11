/** Met Office NSWWS warning levels, in the order they escalate. */
export type WarningLevel = "yellow" | "amber" | "red" | "unknown";

export interface WeatherWarning {
  id: string;
  level: WarningLevel;
  /** "rain", "wind", "snow and ice"… parsed out of the title. */
  hazard: string | null;
  title: string;
  description: string | null;
  /** The feed's own free-text validity window, shown rather than parsed. */
  validity: string | null;
  issuedISO: string | null;
  link: string | null;
}

/** AuroraWatch UK status, lowest to highest. */
export type AuroraLevel = "green" | "yellow" | "amber" | "red" | "unknown";

export interface AuroraStatus {
  level: AuroraLevel;
  /** What the level means, in AuroraWatch's own terms. */
  meaning: string;
  /** Whether it is worth going outside — anything above green. */
  alert: boolean;
  updatedISO: string | null;
}
