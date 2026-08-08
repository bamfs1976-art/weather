/**
 * Server-side clients for river levels, flood warnings and sea state.
 *
 * Two upstreams, neither of which needs a key:
 *
 *  - Environment Agency real-time flood-monitoring API. Open Government
 *    Licence, no key, no registration. Its flood *warnings* are England-only,
 *    but the station/measure feed carries Welsh gauges owned by Natural
 *    Resources Wales under the same licence, which is what gets us the Tawe
 *    without anyone signing up for a portal account.
 *    https://environment.data.gov.uk/flood-monitoring/doc/reference
 *
 *  - Open-Meteo Marine for sea state. 5 km European coastal grid.
 *    https://open-meteo.com/en/docs/marine-weather-api
 *
 * Both return Section<T> so a dead upstream degrades to a notice rather than
 * an exception, exactly like the Xweather sections.
 */

import type { Section } from "./weather-types";
import type {
  FloodWarning,
  MarineConditions,
  MarineHour,
  RiverMeasure,
  RiverStation,
} from "./water-types";

const EA_BASE = "https://environment.data.gov.uk/flood-monitoring";
const MARINE_BASE = "https://marine-api.open-meteo.com/v1/marine";

const TTL = {
  floods: 300,
  readings: 600,
  marine: 1_800,
} as const;

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function succeed<T>(data: T): Section<T> {
  return { ok: true, data, error: null, code: null };
}

/** Great-circle distance in km. */
export function distanceKM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** The EA API returns `items` as an object when a query matches exactly one. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function getJSON<T>(
  url: string,
  revalidate: number,
  headers: Record<string, string> = {}
): Promise<Section<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json", ...headers },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return fail<T>(`Could not reach the service (${message}).`, "network");
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return fail<T>(
        `The service refused the request (HTTP ${res.status}). These feeds need no key, so a network policy is the likely cause.`,
        "unauthorised"
      );
    }
    if (res.status === 429) {
      return fail<T>("Rate limit reached — try again shortly.", "rate_limited");
    }
    return fail<T>(`Upstream returned HTTP ${res.status}.`, `http_${res.status}`);
  }

  try {
    return succeed((await res.json()) as T);
  } catch {
    return fail<T>("Upstream returned a response that was not JSON.", "bad_response");
  }
}


/**
 * Re-express an absolute instant as an ISO string carrying `offsetMinutes`.
 *
 * Both upstreams report in UTC, but the rest of the app formats times in the
 * offset embedded in the timestamp so everything reads as local-for-the-place.
 * Without this, a tide at 18:44 BST would display as 17:44 — an hour out, which
 * for a tide table is not a cosmetic problem.
 */
export function withOffset(iso: string, offsetMinutes: number | null): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  if (offsetMinutes === null || offsetMinutes === 0) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const shifted = new Date(ms + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${shifted.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

/* ------------------------------------------------------------------ */
/* Flood warnings                                                      */
/* ------------------------------------------------------------------ */

interface RawFlood {
  "@id"?: string;
  description?: string;
  severity?: string;
  severityLevel?: number;
  message?: string;
  timeRaised?: string;
  floodArea?: { county?: string; riverOrSea?: string };
  eaAreaName?: string;
}

export async function getFloodWarnings(
  lat: number,
  lon: number,
  distKm = 30,
  offsetMinutes: number | null = null
): Promise<Section<FloodWarning[]>> {
  const url = `${EA_BASE}/id/floods?lat=${lat}&long=${lon}&dist=${distKm}`;
  const section = await getJSON<{ items?: RawFlood | RawFlood[] }>(url, TTL.floods);

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const warnings: FloodWarning[] = toArray(section.data.items)
    .map((item) => ({
      id: str(item["@id"]) ?? str(item.description) ?? "flood",
      severity: str(item.severity) ?? "Unknown",
      severityLevel: num(item.severityLevel) ?? 4,
      description: str(item.description) ?? "Flood warning",
      message: str(item.message),
      riverOrSea: str(item.floodArea?.riverOrSea),
      county: str(item.floodArea?.county) ?? str(item.eaAreaName),
      timeRaisedISO: (() => {
        const raised = str(item.timeRaised);
        return raised ? withOffset(raised, offsetMinutes) : null;
      })(),
    }))
    // Severity 4 means "no longer in force" — keep only live ones.
    .filter((warning) => warning.severityLevel <= 3)
    .sort((a, b) => a.severityLevel - b.severityLevel);

  return succeed(warnings);
}

/* ------------------------------------------------------------------ */
/* River levels                                                        */
/* ------------------------------------------------------------------ */

interface RawStation {
  "@id"?: string;
  notation?: string;
  label?: string | string[];
  riverName?: string;
  town?: string;
  catchmentName?: string;
  lat?: number | number[];
  long?: number | number[];
  stageScale?: {
    typicalRangeLow?: number;
    typicalRangeHigh?: number;
    maxOnRecord?: { value?: number };
  };
}

interface RawMeasure {
  "@id"?: string;
  parameter?: string;
  parameterName?: string;
  qualifier?: string;
  unitName?: string;
  latestReading?: { dateTime?: string; value?: number } | string;
}

/** EA sometimes returns label/lat as a single-element array. */
function firstOf<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function classify(
  value: number | null,
  low: number | null,
  high: number | null
): { state: RiverMeasure["state"]; rangePosition: number | null } {
  if (value === null || low === null || high === null || high <= low) {
    return { state: "unknown", rangePosition: null };
  }
  const position = (value - low) / (high - low);
  if (position < 0) return { state: "low", rangePosition: position };
  if (position > 1) return { state: "high", rangePosition: position };
  return { state: "normal", rangePosition: position };
}

/**
 * Nearest river/sea gauges with their latest readings.
 *
 * Two hops: the station search gives metadata and the typical range, then each
 * station's measures carry the latest value. Only the closest few stations are
 * expanded, to keep this to a handful of requests.
 */
export async function getRiverStations(
  lat: number,
  lon: number,
  distKm = 20,
  limit = 4,
  offsetMinutes: number | null = null
): Promise<Section<RiverStation[]>> {
  const url = `${EA_BASE}/id/stations?lat=${lat}&long=${lon}&dist=${distKm}&parameter=level&_limit=40`;
  const section = await getJSON<{ items?: RawStation | RawStation[] }>(
    url,
    TTL.readings
  );

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const raw = toArray(section.data.items);
  if (raw.length === 0) {
    return fail<RiverStation[]>(
      "No river gauges found within range of this location.",
      "warn_no_data"
    );
  }

  const nearest = raw
    .map((item) => {
      const sLat = num(firstOf(item.lat));
      const sLon = num(firstOf(item.long));
      return {
        item,
        lat: sLat,
        lon: sLon,
        distance:
          sLat !== null && sLon !== null ? distanceKM(lat, lon, sLat, sLon) : null,
      };
    })
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
    .slice(0, limit);

  const stations = await Promise.all(
    nearest.map(async ({ item, lat: sLat, lon: sLon, distance }) => {
      const notation = str(item.notation) ?? str(item["@id"])?.split("/").pop() ?? "";
      const low = num(item.stageScale?.typicalRangeLow);
      const high = num(item.stageScale?.typicalRangeHigh);
      const record = num(item.stageScale?.maxOnRecord?.value);

      let measures: RiverMeasure[] = [];
      if (notation) {
        const measureSection = await getJSON<{ items?: RawMeasure | RawMeasure[] }>(
          `${EA_BASE}/id/stations/${encodeURIComponent(notation)}/measures`,
          TTL.readings
        );
        if (measureSection.ok && measureSection.data) {
          measures = toArray(measureSection.data.items).map((measure) => {
            const reading =
              typeof measure.latestReading === "object" && measure.latestReading
                ? measure.latestReading
                : undefined;
            const value = num(reading?.value);
            const { state, rangePosition } = classify(value, low, high);
            return {
              id: str(measure["@id"]) ?? notation,
              parameter: str(measure.parameter) ?? "level",
              parameterName: str(measure.parameterName) ?? "Water level",
              qualifier: str(measure.qualifier),
              unit: str(measure.unitName),
              value,
              dateTimeISO: reading?.dateTime
                ? withOffset(String(reading.dateTime), offsetMinutes)
                : null,
              typicalLow: low,
              typicalHigh: high,
              maxOnRecord: record,
              rangePosition,
              state,
            };
          });
        }
      }

      return {
        id: notation,
        label: str(firstOf(item.label)) ?? notation,
        riverName: str(item.riverName),
        town: str(item.town),
        catchment: str(item.catchmentName),
        lat: sLat,
        lon: sLon,
        distanceKM: distance,
        measures: measures.filter((m) => m.value !== null),
      } satisfies RiverStation;
    })
  );

  const withData = stations.filter((station) => station.measures.length > 0);
  if (withData.length === 0) {
    return fail<RiverStation[]>(
      "Gauges were found nearby but none is currently reporting a level.",
      "warn_no_data"
    );
  }

  return succeed(withData);
}

/* ------------------------------------------------------------------ */
/* Sea state (Open-Meteo Marine — free, no key)                        */
/* ------------------------------------------------------------------ */

interface RawMarine {
  hourly?: {
    time?: string[];
    wave_height?: (number | null)[];
    wave_direction?: (number | null)[];
    wave_period?: (number | null)[];
    swell_wave_height?: (number | null)[];
    sea_surface_temperature?: (number | null)[];
  };
  utc_offset_seconds?: number;
}

/**
 * Wave height, period, direction and sea temperature for the next 48 hours.
 *
 * Open-Meteo's marine model is a 5 km European grid; it resolves open coast
 * well but not enclosed water, so a point far inland simply returns nothing
 * and the card stays hidden.
 */
export async function getMarineConditions(
  lat: number,
  lon: number,
  offsetMinutes: number | null = null
): Promise<Section<MarineConditions>> {
  const query = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly:
      "wave_height,wave_direction,wave_period,swell_wave_height,sea_surface_temperature",
    forecast_days: "3",
    timezone: "UTC",
  });

  const section = await getJSON<RawMarine>(
    `${MARINE_BASE}?${query.toString()}`,
    TTL.marine
  );

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const hourly = section.data.hourly;
  const times = hourly?.time ?? [];
  if (times.length === 0) {
    return fail<MarineConditions>(
      "No marine forecast for this location — the model covers coastal water only.",
      "warn_no_data"
    );
  }

  const at = (list: (number | null)[] | undefined, i: number) =>
    list && i < list.length ? num(list[i]) : null;

  const hours: MarineHour[] = times.map((time, i) => ({
    // Open-Meteo returns "2026-08-08T15:00" in the requested zone (UTC here).
    timeISO: withOffset(`${time}:00Z`.replace(/:00:00Z$/, ":00Z"), offsetMinutes),
    waveHeightM: at(hourly?.wave_height, i),
    waveDirectionDeg: at(hourly?.wave_direction, i),
    wavePeriodS: at(hourly?.wave_period, i),
    swellHeightM: at(hourly?.swell_wave_height, i),
    seaTempC: at(hourly?.sea_surface_temperature, i),
  }));

  const withWave = hours.filter((hour) => hour.waveHeightM !== null);
  if (withWave.length === 0) {
    return fail<MarineConditions>(
      "No marine forecast for this location — the model covers coastal water only.",
      "warn_no_data"
    );
  }

  const now = Date.now();
  const current =
    hours.find((hour) => Date.parse(hour.timeISO) >= now) ?? hours[0] ?? null;
  const peak = withWave.reduce((best, hour) =>
    (hour.waveHeightM ?? 0) > (best.waveHeightM ?? 0) ? hour : best
  );

  return succeed({
    hours: hours.slice(0, 48),
    current,
    maxWaveM: peak.waveHeightM,
    maxWaveAtISO: peak.timeISO,
  });
}
