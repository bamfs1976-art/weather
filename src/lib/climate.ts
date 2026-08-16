/**
 * SERVER ONLY — long-run climate context from ERA5 reanalysis.
 *
 * Open-Meteo's archive endpoint serves daily values back to 1940, free and
 * without a key. That is the one thing this app could not do: the Xweather
 * archive answers "what was it like last Tuesday", and this answers "is this
 * August unusual", which is the question people actually ask about weather.
 *
 * **This is reanalysis, not observation.** Open-Meteo say so plainly: beyond
 * about a week the values come from a model run backwards over the historical
 * record rather than from a station that was standing there. For a 1 km grid
 * cell over Swansea that is a very good estimate and not a measurement, and the
 * card says as much — an eighty-year "record" presented as fact would be a
 * bigger lie than anything else on the page.
 *
 * One request per location per day. The response is reduced to a summary here
 * rather than shipped to the browser: thirty thousand daily values is about a
 * third of a megabyte, and none of it is needed client-side.
 */

import type { Section } from "./weather-types";
import type { ClimateContext } from "./climate-types";

const BASE =
  process.env.OPEN_METEO_ARCHIVE ?? "https://archive-api.open-meteo.com/v1/archive";

/** Values for a date that has already passed never change; a day is generous. */
const TTL = 86_400;

/** ERA5 begins in 1940. Asking for earlier just wastes the request. */
const FIRST_YEAR = 1940;

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export async function getClimateContext(
  lat: number,
  lon: number,
  now = new Date()
): Promise<Section<ClimateContext>> {
  /*
   * ERA5 lags real time by about five days, so the range stops a week back.
   * Asking up to today returns nulls at the tail, which would drag the "so far
   * this month" mean towards nothing.
   */
  const end = new Date(now.getTime() - 7 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${FIRST_YEAR}-01-01&end_date=${iso(end)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=UTC`;

  let parsed: unknown;
  try {
    const res = await fetch(url, {
      next: { revalidate: TTL },
      headers: { Accept: "application/json" },
      // Eighty-five years of daily values is a large response; allow for it.
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 429) {
      return fail("Open-Meteo rate limit reached — the daily cache will recover it.", "rate_limited");
    }
    if (!res.ok) return fail(`The climate archive returned HTTP ${res.status}.`, `http_${res.status}`);
    parsed = await res.json();
  } catch (err) {
    const timedOut = err instanceof Error && /Timeout|Abort/.test(err.name);
    return fail(
      timedOut
        ? "The climate archive did not respond in time."
        : "Could not reach the climate archive.",
      timedOut ? "timeout" : "network"
    );
  }

  const daily = (parsed as { daily?: Record<string, unknown> })?.daily;
  const time = Array.isArray(daily?.time) ? (daily.time as unknown[]) : [];
  if (time.length === 0) return fail("The climate archive returned no days.", "bad_response");

  const tmax = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const tmin = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const rain = Array.isArray(daily?.precipitation_sum) ? daily.precipitation_sum : [];

  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const thisYear = now.getUTCFullYear();

  /* Same calendar month, every year: mean daily max, and total rainfall. */
  const monthMax = new Map<number, number[]>();
  const monthRain = new Map<number, number[]>();
  /* Same calendar date, every year: for the record high and low. */
  let recordHigh: { c: number; year: number } | null = null;
  let recordLow: { c: number; year: number } | null = null;

  for (let i = 0; i < time.length; i++) {
    const stamp = String(time[i] ?? "");
    const y = Number(stamp.slice(0, 4));
    const m = Number(stamp.slice(5, 7));
    const d = Number(stamp.slice(8, 10));
    if (!Number.isFinite(y) || m !== month) continue;

    const hi = num(tmax[i]);
    const lo = num(tmin[i]);
    const mm = num(rain[i]);

    if (hi !== null) {
      const list = monthMax.get(y) ?? [];
      list.push(hi);
      monthMax.set(y, list);
    }
    if (mm !== null) {
      const list = monthRain.get(y) ?? [];
      list.push(mm);
      monthRain.set(y, list);
    }

    if (d === day) {
      if (hi !== null && (recordHigh === null || hi > recordHigh.c)) recordHigh = { c: hi, year: y };
      if (lo !== null && (recordLow === null || lo < recordLow.c)) recordLow = { c: lo, year: y };
    }
  }

  if (monthMax.size === 0) {
    return fail("The climate archive covered no matching days.", "warn_no_data");
  }

  /*
   * Complete years only for the ranking. The current month is still running, so
   * comparing a half-finished August against eighty complete ones would rank it
   * against a different thing — and that is exactly the sort of quiet
   * apples-to-oranges the rest of this app has been bitten by.
   */
  const yearlyMeans = [...monthMax.entries()]
    .filter(([year]) => year < thisYear)
    .map(([year, values]) => ({ year, meanC: mean(values)! }))
    .filter((entry) => Number.isFinite(entry.meanC))
    .sort((a, b) => b.meanC - a.meanC);

  const soFar = mean(monthMax.get(thisYear) ?? []);
  const longTerm = mean(yearlyMeans.map((e) => e.meanC));
  const rankAmong = yearlyMeans.length;
  const warmerThan =
    soFar === null ? null : yearlyMeans.filter((e) => e.meanC < soFar).length;

  const rainYears = [...monthRain.entries()]
    .filter(([year]) => year < thisYear)
    .map(([, values]) => values.reduce((a, b) => a + b, 0));
  const rainSoFar = (monthRain.get(thisYear) ?? []).reduce((a, b) => a + b, 0);

  return {
    ok: true,
    data: {
      firstYear: Number(String(time[0] ?? "").slice(0, 4)) || FIRST_YEAR,
      lastDayISO: String(time[time.length - 1] ?? ""),
      month,
      monthMeanMaxC: soFar,
      longTermMeanMaxC: longTerm,
      /* Rank counting downwards: 1 = warmest such month on record. */
      rank: warmerThan === null ? null : rankAmong - warmerThan + 1,
      yearsCompared: rankAmong,
      warmest: yearlyMeans[0] ?? null,
      coldest: yearlyMeans[yearlyMeans.length - 1] ?? null,
      recordHigh,
      recordLow,
      monthRainMM: rainSoFar,
      longTermRainMM: mean(rainYears),
    },
    error: null,
    code: null,
  };
}
