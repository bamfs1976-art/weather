/**
 * SERVER ONLY — model spread, via Open-Meteo's per-model endpoints.
 *
 * Everything else in this app answers "what is the forecast". This answers
 * "how much do the forecasters actually agree", which is the more useful
 * question when the answer matters. Open-Meteo serves the raw output of each
 * national model separately for exactly this purpose, free and without a key,
 * at a documented limit of 10,000 requests a day.
 *
 * https://github.com/open-meteo/open-meteo
 *
 * **One request per model, not one request listing them all.** Open-Meteo does
 * accept a comma-separated `models=`, which would be a single call — but an
 * identifier it does not recognise fails the whole request, and these
 * identifiers could not be verified from the build environment (open-meteo.com
 * is unreachable here). Asking separately means a wrong name costs its own
 * model and nothing else, which is the same reason every upstream in this app
 * returns its own Section. Five requests an hour per location is about 120 a
 * day — three orders of magnitude inside the limit.
 */

import type { Section } from "./weather-types";
import type { ModelSeries, ModelSpread } from "./model-types";

const BASE = process.env.OPEN_METEO_BASE ?? "https://api.open-meteo.com/v1/forecast";

/** Their models run a few times a day; an hour is already finer than needed. */
const TTL = 3_600;

/**
 * The models to compare, most locally relevant first.
 *
 * UKMO is the home model and ECMWF is generally the best global one, so those
 * two carry most of the signal for Wales; ICON and GFS are included because a
 * spread of two is not a spread. Identifiers are unverified from here — see the
 * header — so `/api/diagnostics` reports which ones actually answered, and any
 * that never do should be deleted rather than left to fail quietly.
 */
export const MODELS: { id: string; label: string; centre: string }[] = [
  /*
   * UKV first: 2 km over the UK and Ireland, which is the finest grid anything
   * in this app sees and the one most likely to resolve a Swansea Bay shower
   * that a 10 km global model smears away. `ukmo_seamless` blends it with the
   * global run; this is the raw high-resolution model beside it, so the two
   * disagreeing is itself informative. The identifier is unverified — if
   * diagnostics reports it missing every run, it is wrong and should go.
   */
  { id: "ukmo_uk_deterministic_2km", label: "UKV 2km", centre: "Met Office" },
  { id: "ukmo_seamless", label: "UKMO", centre: "Met Office" },
  { id: "ecmwf_ifs025", label: "ECMWF", centre: "ECMWF" },
  { id: "icon_seamless", label: "ICON", centre: "DWD" },
  { id: "gfs_seamless", label: "GFS", centre: "NOAA" },
];


function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface RawModel {
  hourly?: { time?: unknown; temperature_2m?: unknown; precipitation?: unknown };
}

async function fetchModel(
  lat: number,
  lon: number,
  hours: number,
  model: (typeof MODELS)[number]
): Promise<{ time: string[]; tempC: (number | null)[]; precipMM: (number | null)[] } | null> {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=temperature_2m,precipitation&models=${encodeURIComponent(model.id)}` +
    `&forecast_hours=${hours}&timeformat=unixtime`;

  try {
    const res = await fetch(url, {
      next: { revalidate: TTL },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as RawModel;
    const time = parsed?.hourly?.time;
    if (!Array.isArray(time) || time.length === 0) return null;

    const temps = Array.isArray(parsed.hourly?.temperature_2m) ? parsed.hourly.temperature_2m : [];
    const precip = Array.isArray(parsed.hourly?.precipitation) ? parsed.hourly.precipitation : [];

    return {
      // Unix seconds, so every model lands on the same absolute instant with no
      // timezone handling — the same reason compareForecasts matches on instants.
      time: time.map((t) => new Date(num(t)! * 1000).toISOString()),
      tempC: time.map((_, i) => num(temps[i])),
      precipMM: time.map((_, i) => num(precip[i])),
    };
  } catch {
    return null;
  }
}

export async function getModelSpread(
  lat: number,
  lon: number,
  hours = 48
): Promise<Section<ModelSpread>> {
  const results = await Promise.all(MODELS.map((m) => fetchModel(lat, lon, hours, m)));

  const answered = MODELS.map((model, i) => ({ model, data: results[i] })).filter(
    (entry): entry is { model: (typeof MODELS)[number]; data: NonNullable<(typeof results)[number]> } =>
      entry.data !== null
  );
  const missing = MODELS.filter((_, i) => results[i] === null).map((m) => m.label);

  if (answered.length === 0) {
    return fail(
      "No model answered. Open-Meteo needs no key, so this is either a network problem or the model identifiers are wrong — /api/diagnostics lists them.",
      "warn_no_data"
    );
  }
  if (answered.length === 1) {
    return fail(
      `Only ${answered[0].model.label} answered, and one model is not a spread. Missing: ${missing.join(", ")}.`,
      "warn_no_data"
    );
  }

  /*
   * Align on the timestamps the first model returned rather than assuming every
   * model starts at the same hour — they are run at different times, and
   * index-to-index would compare different instants. Same trap compareForecasts
   * avoids between Xweather and the Met Office.
   */
  const hoursISO = answered[0].data.time;
  const indexOf = answered.map((entry) => {
    const map = new Map<string, number>();
    entry.data.time.forEach((t, i) => map.set(t, i));
    return map;
  });

  const models: ModelSeries[] = answered.map((entry, m) => ({
    id: entry.model.id,
    label: entry.model.label,
    centre: entry.model.centre,
    tempC: hoursISO.map((t) => {
      const i = indexOf[m].get(t);
      return i === undefined ? null : entry.data.tempC[i];
    }),
    precipMM: hoursISO.map((t) => {
      const i = indexOf[m].get(t);
      return i === undefined ? null : entry.data.precipMM[i];
    }),
  }));

  const spreadC: (number | null)[] = [];
  const meanC: (number | null)[] = [];
  for (let h = 0; h < hoursISO.length; h++) {
    const values = models.map((m) => m.tempC[h]).filter((v): v is number => v !== null);
    if (values.length < 2) {
      spreadC.push(null);
      meanC.push(values.length === 1 ? values[0] : null);
      continue;
    }
    spreadC.push(Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10);
    meanC.push(Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10);
  }

  return { ok: true, data: { hours: hoursISO, models, spreadC, meanC, missing }, error: null, code: null };
}
