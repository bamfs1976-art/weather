/** Where this month sits against the whole ERA5 record for the same month. */
export interface ClimateContext {
  firstYear: number;
  /** Last day the archive actually covered — ERA5 lags real time by days. */
  lastDayISO: string;
  /** 1–12, the calendar month being compared. */
  month: number;
  /** Mean daily maximum for this month so far, this year. */
  monthMeanMaxC: number | null;
  /** Mean daily maximum for the same month averaged over every complete year. */
  longTermMeanMaxC: number | null;
  /** 1 = warmest such month on record. Null when this month has no data yet. */
  rank: number | null;
  /** How many complete years the rank is out of. */
  yearsCompared: number;
  warmest: { year: number; meanC: number } | null;
  coldest: { year: number; meanC: number } | null;
  /** Hottest and coldest this calendar date has ever been. */
  recordHigh: { c: number; year: number } | null;
  recordLow: { c: number; year: number } | null;
  monthRainMM: number;
  longTermRainMM: number | null;
}
