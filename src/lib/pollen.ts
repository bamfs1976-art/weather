/**
 * Server-side client for pollen, from the Open-Meteo air quality API.
 *
 * Keyless, like the marine feed already in use, and drawn from the 11 km CAMS
 * European forecast — so it covers the UK but returns nothing outside Europe.
 * https://open-meteo.com/en/docs/air-quality-api
 *
 * It carries its own small fetch helper rather than sharing the one in
 * water.ts. That file is about rivers and the sea; reaching into it for a
 * generic helper would couple two unrelated features together for the sake of
 * twenty lines.
 */

import type { Section } from "./weather-types";
import type { PollenBand, PollenForecast, PollenHour, PollenSpecies } from "./pollen-types";

const BASE = process.env.OPEN_METEO_AIR_BASE ?? "https://air-quality-api.open-meteo.com/v1/air-quality";

/**
 * The species CAMS publishes, in the order they are shown. Olive and ragweed
 * barely register in south Wales but cost nothing to carry and matter if the
 * location is moved south.
 */
export const SPECIES: { key: PollenSpecies; field: string; label: string }[] = [
  { key: "grass", field: "grass_pollen", label: "Grass" },
  { key: "birch", field: "birch_pollen", label: "Birch" },
  { key: "alder", field: "alder_pollen", label: "Alder" },
  { key: "mugwort", field: "mugwort_pollen", label: "Mugwort" },
  { key: "olive", field: "olive_pollen", label: "Olive" },
  { key: "ragweed", field: "ragweed_pollen", label: "Ragweed" },
];

/**
 * Grains per cubic metre at which each species moves up a band.
 *
 * These are the thresholds in common European use rather than anything
 * Open-Meteo publishes — the API returns a bare concentration. They differ
 * sharply by species because birch and alder routinely reach counts that would
 * be extraordinary for grass, so a single shared scale would call an ordinary
 * spring day "very high" and a genuinely bad one the same. Treat them as
 * indicative bands, which is all a pollen count ever is.
 */
const THRESHOLDS: Record<PollenSpecies, [number, number, number]> = {
  //          low>  moderate>  high>
  grass: [30, 50, 150],
  birch: [10, 50, 500],
  alder: [10, 50, 500],
  mugwort: [10, 50, 500],
  olive: [10, 50, 200],
  ragweed: [5, 20, 50],
};

export function bandFor(species: PollenSpecies, value: number | null): PollenBand {
  if (value === null || !Number.isFinite(value) || value <= 0) return "none";
  const [low, moderate, high] = THRESHOLDS[species];
  if (value < low) return "low";
  if (value < moderate) return "moderate";
  if (value < high) return "high";
  return "very high";
}

const BAND_RANK: Record<PollenBand, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
  "very high": 4,
};

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

interface RawPollen {
  hourly?: Record<string, unknown>;
  utc_offset_seconds?: number;
}

function numbers(value: unknown): (number | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : null
  );
}

/**
 * Pollen for the next few days at a point.
 *
 * `offsetMinutes` re-expresses timestamps in the location's own offset, the
 * same convention the rest of the app uses so everything reads as
 * local-for-the-place.
 */
export async function getPollen(
  lat: number,
  lon: number,
  offsetMinutes: number | null = null,
  days = 4
): Promise<Section<PollenForecast>> {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${SPECIES.map((s) => s.field).join(",")}` +
    `&forecast_days=${days}&timeformat=unixtime`;

  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: 1_800 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return fail<PollenForecast>("The pollen service did not respond in time.", "timeout");
    }
    return fail<PollenForecast>("Could not reach the pollen service.", "network");
  }

  if (!res.ok) {
    return fail<PollenForecast>(
      `The pollen service returned HTTP ${res.status}.`,
      `http_${res.status}`
    );
  }

  let raw: RawPollen;
  try {
    raw = (await res.json()) as RawPollen;
  } catch {
    return fail<PollenForecast>("The pollen service returned a malformed response.", "bad_response");
  }

  const times = numbers(raw.hourly?.time);
  if (times.length === 0) {
    return fail<PollenForecast>(
      "No pollen forecast is published for this location — CAMS covers Europe only.",
      "warn_no_data"
    );
  }

  const series = new Map<PollenSpecies, (number | null)[]>();
  for (const species of SPECIES) {
    series.set(species.key, numbers(raw.hourly?.[species.field]));
  }

  // Every species null at every hour means the grid has no data here, which is
  // a different thing from a genuine zero count and should not read as "none".
  const anyData = SPECIES.some((s) =>
    (series.get(s.key) ?? []).some((v) => v !== null)
  );
  if (!anyData) {
    return fail<PollenForecast>(
      "No pollen forecast is published for this location — CAMS covers Europe only.",
      "warn_no_data"
    );
  }

  const offsetMs = (offsetMinutes ?? 0) * 60_000;
  const hours: PollenHour[] = times.map((seconds, index) => {
    const at = new Date((seconds ?? 0) * 1000 + offsetMs);
    const sign = (offsetMinutes ?? 0) >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes ?? 0);
    const stamp =
      offsetMinutes === null
        ? at.toISOString().replace(/\.\d{3}Z$/, "Z")
        : at.toISOString().replace(/\.\d{3}Z$/, "") +
          `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    const values = {} as Record<PollenSpecies, number | null>;
    for (const species of SPECIES) {
      values[species.key] = series.get(species.key)?.[index] ?? null;
    }
    return { timeISO: stamp, values };
  });

  // "Now" is the last hour that has already started, not simply hours[0].
  const nowSeconds = Date.now() / 1000;
  let currentIndex = times.findIndex((t) => (t ?? 0) > nowSeconds) - 1;
  if (currentIndex < 0) currentIndex = 0;
  const current = hours[currentIndex] ?? null;

  // Peak per species across the next 24 hours, which is what a sufferer
  // actually wants to know before deciding about the afternoon.
  const window = hours.slice(currentIndex, currentIndex + 24);
  const peaks = SPECIES.map((species) => {
    const values = window
      .map((hour) => hour.values[species.key])
      .filter((v): v is number => v !== null);
    const peak = values.length ? Math.max(...values) : null;
    return {
      species: species.key,
      label: species.label,
      value: peak,
      band: bandFor(species.key, peak),
    };
  }).sort((a, b) => BAND_RANK[b.band] - BAND_RANK[a.band] || (b.value ?? 0) - (a.value ?? 0));

  const overallBand = peaks.length ? peaks[0].band : "none";

  return {
    ok: true,
    data: { hours, current, currentIndex, peaks, overallBand },
    error: null,
    code: null,
  };
}
