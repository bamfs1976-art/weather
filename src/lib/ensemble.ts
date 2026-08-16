/**
 * SERVER ONLY — probabilistic forecast from an ensemble.
 *
 * The Model agreement card compares four *deterministic* models: one run each,
 * and their spread is a proxy for confidence. An ensemble is the real thing —
 * the same model run many times from slightly different starting conditions, so
 * "30% chance of rain" is a count of members rather than an inference from four
 * disagreeing forecasts.
 *
 * Open-Meteo's ensemble endpoint is free and keyless like the rest of them, and
 * returns each member as its own suffixed field (`temperature_2m_member01`…).
 * The member count differs per model and changes when a centre re-tunes its
 * system, so the parser counts what arrives rather than assuming a number.
 *
 * https://open-meteo.com/en/docs/ensemble-api
 *
 * Identifiers could not be verified from the build environment. As with the
 * deterministic models, each candidate is requested on its own so a wrong name
 * costs only itself, and `/api/diagnostics` reports which answered.
 */

import type { Section } from "./weather-types";
import type { EnsembleForecast, EnsembleHour } from "./ensemble-types";

const BASE =
  process.env.OPEN_METEO_ENSEMBLE ?? "https://ensemble-api.open-meteo.com/v1/ensemble";

const TTL = 3_600;

/** Most locally relevant first; the first one that answers is used. */
export const ENSEMBLES: { id: string; label: string; note: string }[] = [
  {
    id: "ukmo_global_ensemble_20km",
    label: "MOGREPS-G",
    note: "Met Office global ensemble",
  },
  { id: "ecmwf_ifs025", label: "ECMWF ENS", note: "ECMWF ensemble" },
  { id: "icon_eu", label: "ICON-EU EPS", note: "DWD European ensemble" },
];

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Every `field` and `field_memberNN` column present in the response. */
function memberSeries(
  hourly: Record<string, unknown>,
  field: string
): (number | null)[][] {
  const keys = Object.keys(hourly).filter(
    (k) => k === field || k.startsWith(`${field}_member`)
  );
  return keys
    .map((k) => (Array.isArray(hourly[k]) ? (hourly[k] as unknown[]).map(num) : null))
    .filter((series): series is (number | null)[] => series !== null);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const value = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  return Math.round(value * 10) / 10;
}

async function fetchEnsemble(
  lat: number,
  lon: number,
  hours: number,
  model: (typeof ENSEMBLES)[number]
): Promise<EnsembleForecast | null> {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=temperature_2m,precipitation&models=${encodeURIComponent(model.id)}` +
    `&forecast_hours=${hours}&timeformat=unixtime`;

  try {
    const res = await fetch(url, {
      next: { revalidate: TTL },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as { hourly?: Record<string, unknown> };
    const hourly = parsed?.hourly;
    const time = Array.isArray(hourly?.time) ? (hourly.time as unknown[]) : [];
    if (!hourly || time.length === 0) return null;

    const temps = memberSeries(hourly, "temperature_2m");
    const rains = memberSeries(hourly, "precipitation");
    // One member is not an ensemble; it is just a forecast with extra steps.
    if (temps.length < 3) return null;

    const out: EnsembleHour[] = [];
    for (let i = 0; i < time.length; i++) {
      const at = num(time[i]);
      if (at === null) continue;

      const t = temps.map((s) => s[i]).filter((v): v is number => v !== null).sort((a, b) => a - b);
      const wet = rains.map((s) => s[i]).filter((v): v is number => v !== null);

      out.push({
        timeISO: new Date(at * 1000).toISOString(),
        medianC: percentile(t, 0.5),
        p10C: percentile(t, 0.1),
        p90C: percentile(t, 0.9),
        /*
         * Probability as a member count, which is what an ensemble is for:
         * the share of runs producing measurable rain in this hour. 0.1 mm is
         * the usual threshold for "measurable" — anything less is a trace and
         * counting it would inflate every probability on the card.
         */
        rainChance: wet.length
          ? Math.round((wet.filter((v) => v >= 0.1).length / wet.length) * 100)
          : null,
        members: t.length,
      });
    }

    if (out.length === 0) return null;
    return { model: model.label, note: model.note, members: temps.length, hours: out };
  } catch {
    return null;
  }
}

export async function getEnsemble(
  lat: number,
  lon: number,
  hours = 48
): Promise<Section<EnsembleForecast>> {
  for (const model of ENSEMBLES) {
    const result = await fetchEnsemble(lat, lon, hours, model);
    if (result) return { ok: true, data: result, error: null, code: null };
  }
  return fail(
    `No ensemble answered. Tried ${ENSEMBLES.map((e) => e.id).join(", ")} — Open-Meteo needs no key, so a permanent failure means the identifiers are wrong.`,
    "warn_no_data"
  );
}
