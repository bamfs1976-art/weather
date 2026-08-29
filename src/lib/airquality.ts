/**
 * SERVER ONLY — air quality from Open-Meteo, in the shape the panel reads.
 *
 * The same CAMS-backed endpoint `pollen.ts` already calls, so this adds a
 * source the app was fetching from anyway and removes two Xweather accesses
 * from every dashboard load — `airquality` and `airquality/forecasts`.
 *
 * The conversion into Xweather's `AirQualityResponse` is deliberate and is the
 * same trick `metoffice-periods.ts` uses: the panel reads one shape, so the
 * provider swap happens here rather than in the component. Nothing in
 * `AirSunPanel` had to learn that the numbers changed hands.
 *
 * **The index is the European AQI, not the US one.** They are different
 * scales with different breakpoints and the same nominal range, so a number
 * from one read against the other's categories is wrong in a way that looks
 * plausible. `category` is computed from the European bands below rather than
 * reused from anything Xweather-shaped, and the card names the scale.
 * https://open-meteo.com/en/docs/air-quality-api
 */

import type { AirQualityPeriod, AirQualityPollutant, AirQualityResponse, Section } from "./weather-types";

const BASE =
  process.env.OPEN_METEO_AIR_BASE ?? "https://air-quality-api.open-meteo.com/v1/air-quality";

/** Cached an hour: CAMS publishes hourly and the index moves slowly. */
const TTL = 3_600;

/**
 * The pollutants the card shows, with the names it labels them by.
 *
 * Open-Meteo reports every one of these in µg/m³. Xweather's shape carries
 * both µg/m³ and ppb; only the metric one is populated, because converting to
 * ppb needs the molar mass of each gas and the card never shows ppb.
 */
const POLLUTANTS: { field: string; type: string; name: string }[] = [
  { field: "pm2_5", type: "pm2.5", name: "PM2.5" },
  { field: "pm10", type: "pm10", name: "PM10" },
  { field: "nitrogen_dioxide", type: "no2", name: "Nitrogen dioxide" },
  { field: "ozone", type: "o3", name: "Ozone" },
  { field: "sulphur_dioxide", type: "so2", name: "Sulphur dioxide" },
  { field: "carbon_monoxide", type: "co", name: "Carbon monoxide" },
];

/**
 * European AQI bands. The index is already a 0–100+ scale where each band is
 * twenty wide, so this is a lookup rather than a calculation.
 * https://www.eea.europa.eu/themes/air/air-quality-index
 */
const BANDS: { limit: number; category: string; color: string }[] = [
  { limit: 20, category: "Good", color: "50f0e6" },
  { limit: 40, category: "Fair", color: "50ccaa" },
  { limit: 60, category: "Moderate", color: "f0e641" },
  { limit: 80, category: "Poor", color: "ff5050" },
  { limit: 100, category: "Very poor", color: "960032" },
  { limit: Infinity, category: "Extremely poor", color: "7d2181" },
];

export function europeanBand(aqi: number | null): { category: string | null; color: string | null } {
  if (aqi === null || !Number.isFinite(aqi)) return { category: null, color: null };
  const band = BANDS.find((b) => aqi <= b.limit) ?? BANDS[BANDS.length - 1];
  return { category: band.category, color: band.color };
}

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

interface RawAir {
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
 * Current and forecast air quality for a point.
 *
 * Returns the whole hourly series; `periods[0]` is the hour covering now,
 * which is the convention `AirSunPanel` already relies on for the headline
 * reading, and the rest is the forecast the second card charts. One request
 * therefore does what two Xweather endpoints used to.
 */
export async function getAirQuality(
  lat: number,
  lon: number,
  offsetMinutes: number | null = null,
  hours = 48,
  now: number = Date.now()
): Promise<Section<AirQualityResponse>> {
  const fields = [...POLLUTANTS.map((p) => p.field), "european_aqi"].join(",");
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${fields}&forecast_days=3&timeformat=unixtime`;

  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: TTL },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return fail<AirQualityResponse>(
        "The air quality service did not respond in time.",
        "timeout"
      );
    }
    return fail<AirQualityResponse>("Could not reach the air quality service.", "network");
  }

  if (!res.ok) {
    return fail<AirQualityResponse>(
      `The air quality service returned HTTP ${res.status}.`,
      `http_${res.status}`
    );
  }

  let raw: RawAir;
  try {
    raw = (await res.json()) as RawAir;
  } catch {
    return fail<AirQualityResponse>(
      "The air quality service returned a malformed response.",
      "bad_response"
    );
  }

  const times = numbers(raw.hourly?.time);
  if (times.length === 0) {
    return fail<AirQualityResponse>(
      "No air quality forecast is published for this location — CAMS covers Europe only.",
      "warn_no_data"
    );
  }

  const aqiSeries = numbers(raw.hourly?.european_aqi);
  const series = new Map<string, (number | null)[]>();
  for (const pollutant of POLLUTANTS) {
    series.set(pollutant.field, numbers(raw.hourly?.[pollutant.field]));
  }

  /*
   * The offset the app formats in. Open-Meteo is asked for unix timestamps so
   * nothing here depends on its own timezone handling; the location's offset
   * is applied once, the same way every other source in the app is treated.
   */
  const offsetMs = (offsetMinutes ?? 0) * 60_000;
  const stamp = (unix: number): string =>
    new Date(unix * 1000 + offsetMs).toISOString().replace("Z", offsetLabel(offsetMinutes));

  /*
   * Start at the hour covering now rather than at the start of the series:
   * Open-Meteo returns whole days, so without this the "current" reading would
   * be midnight this morning — a stale number presented as live, which is the
   * same failure the expired-warning fix was about.
   */
  const nowSeconds = now / 1000;
  let startIndex = times.findIndex((t) => t !== null && t + 3600 > nowSeconds);
  if (startIndex < 0) startIndex = 0;

  const periods: AirQualityPeriod[] = [];
  for (let i = startIndex; i < times.length && periods.length < hours; i += 1) {
    const unix = times[i];
    if (unix === null) continue;

    const pollutants: AirQualityPollutant[] = POLLUTANTS.map((p) => ({
      type: p.type,
      name: p.name,
      valueUGM3: series.get(p.field)?.[i] ?? null,
      valuePPB: null,
      aqi: null,
      category: null,
      color: null,
    })).filter((p) => p.valueUGM3 !== null);

    const aqi = aqiSeries[i] ?? null;
    const band = europeanBand(aqi);

    periods.push({
      dateTimeISO: stamp(unix),
      timestamp: unix,
      aqi,
      category: band.category,
      color: band.color,
      method: "european_aqi",
      /* The pollutant with the highest concentration is not the dominant one
       * for the index — the index weights each against its own limit — so this
       * is left null rather than guessed from the raw numbers. */
      dominant: null,
      pollutants,
    });
  }

  if (periods.length === 0) {
    return fail<AirQualityResponse>(
      "The air quality response held no usable hours.",
      "bad_response"
    );
  }

  return {
    ok: true,
    data: {
      periods,
      profile: { sources: [{ name: "Copernicus CAMS via Open-Meteo" }] },
    },
    error: null,
    code: null,
  };
}

/** "+01:00" for the location's offset, so timestamps read local-for-the-place. */
function offsetLabel(offsetMinutes: number | null): string {
  if (offsetMinutes === null || !Number.isFinite(offsetMinutes)) return "Z";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
