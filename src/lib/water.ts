/**
 * Server-side clients for river levels, flood warnings and tide times.
 *
 * SERVER ONLY — reads ADMIRALTY_API_KEY.
 *
 * Two upstreams:
 *
 *  - Environment Agency real-time flood-monitoring API. Open Government
 *    Licence, no key, no registration. Its flood *warnings* are England-only,
 *    but the station/measure feed carries Welsh gauges owned by Natural
 *    Resources Wales under the same licence, which is what gets us the Tawe
 *    without anyone signing up for a portal account.
 *    https://environment.data.gov.uk/flood-monitoring/doc/reference
 *
 *  - UKHO ADMIRALTY UK Tidal API. Needs a free "Discovery" subscription key.
 *    This is the authoritative source for UK tide predictions, which matters
 *    in Swansea Bay where the range is among the largest anywhere.
 *    https://admiraltyapi.portal.azure-api.net/
 *
 * Both return Section<T> so a missing key or a dead upstream degrades to a
 * notice rather than an exception, exactly like the Xweather sections.
 */

import type { Section } from "./weather-types";
import type {
  FloodWarning,
  RiverMeasure,
  RiverStation,
  TidalEvent,
  TidalStation,
  TidesPayload,
} from "./water-types";

const EA_BASE = "https://environment.data.gov.uk/flood-monitoring";
const ADMIRALTY_BASE = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1";

const TTL = {
  floods: 300,
  readings: 600,
  stations: 604_800,
  tides: 3_600,
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
  headers: Record<string, string> = {},
  /** Keyed sources get a credentials message; open ones must not. */
  keyed = false
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
        keyed
          ? "The service rejected the API key for this data set."
          : "The service refused the request (HTTP " +
            res.status +
            "). This feed needs no key, so this usually means a network policy or proxy is blocking it.",
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
/* Tides                                                               */
/* ------------------------------------------------------------------ */

export function hasAdmiraltyKey(): boolean {
  return Boolean(process.env.ADMIRALTY_API_KEY);
}

interface RawTidalStationFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { Id?: string; Name?: string; Country?: string };
}

interface RawTidalEvent {
  EventType?: string;
  DateTime?: string;
  Height?: number;
  IsApproximateTime?: boolean;
  IsApproximateHeight?: boolean;
}

/**
 * Admiralty reports event times in UTC but omits the designator, so a bare
 * "2026-08-08T14:23:00" would otherwise be read as browser-local and land an
 * hour out during BST — which is a serious error for a tide table.
 */
function toInstant(value: string | null): string | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const iso = hasZone ? value : `${value}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

async function getTidalStations(): Promise<Section<TidalStation[]>> {
  const key = process.env.ADMIRALTY_API_KEY;
  if (!key) {
    return fail<TidalStation[]>(
      "Tide times need an ADMIRALTY_API_KEY. The Discovery tier is free — sign up at https://admiraltyapi.portal.azure-api.net/.",
      "no_credentials"
    );
  }

  const section = await getJSON<{ features?: RawTidalStationFeature[] }>(
    `${ADMIRALTY_BASE}/Stations`,
    TTL.stations,
    { "Ocp-Apim-Subscription-Key": key },
    true
  );

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const stations: TidalStation[] = (section.data.features ?? [])
    .map((feature) => {
      const coords = feature.geometry?.coordinates;
      return {
        id: str(feature.properties?.Id) ?? "",
        name: str(feature.properties?.Name) ?? "Unnamed station",
        // GeoJSON is [longitude, latitude].
        lon: Array.isArray(coords) ? num(coords[0]) : null,
        lat: Array.isArray(coords) ? num(coords[1]) : null,
        distanceKM: null,
      };
    })
    .filter((station) => station.id !== "");

  if (stations.length === 0) {
    return fail<TidalStation[]>("No tidal stations returned.", "warn_no_data");
  }

  return succeed(stations);
}

export async function getTides(
  lat: number,
  lon: number,
  days = 5,
  offsetMinutes: number | null = null
): Promise<Section<TidesPayload>> {
  const key = process.env.ADMIRALTY_API_KEY;
  if (!key) {
    return fail<TidesPayload>(
      "Tide times need an ADMIRALTY_API_KEY. The Discovery tier is free — sign up at https://admiraltyapi.portal.azure-api.net/.",
      "no_credentials"
    );
  }

  const stationSection = await getTidalStations();
  if (!stationSection.ok || !stationSection.data) {
    return {
      ok: false,
      data: null,
      error: stationSection.error,
      code: stationSection.code,
    };
  }

  const nearest = stationSection.data
    .map((station) => ({
      ...station,
      distanceKM:
        station.lat !== null && station.lon !== null
          ? distanceKM(lat, lon, station.lat, station.lon)
          : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => (a.distanceKM ?? 1e9) - (b.distanceKM ?? 1e9))[0];

  if (!nearest || !Number.isFinite(nearest.distanceKM ?? NaN)) {
    return fail<TidesPayload>("No tidal station near this location.", "warn_no_data");
  }

  const eventsSection = await getJSON<RawTidalEvent[]>(
    `${ADMIRALTY_BASE}/Stations/${encodeURIComponent(nearest.id)}/TidalEvents?duration=${days}`,
    TTL.tides,
    { "Ocp-Apim-Subscription-Key": key },
    true
  );

  if (!eventsSection.ok || !eventsSection.data) {
    return {
      ok: false,
      data: null,
      error: eventsSection.error,
      code: eventsSection.code,
    };
  }

  const events: TidalEvent[] = (
    Array.isArray(eventsSection.data) ? eventsSection.data : []
  )
    .map((event) => {
      const when = toInstant(str(event.DateTime));
      if (!when) return null;
      return {
        type: /high/i.test(event.EventType ?? "") ? "high" : "low",
        dateTimeISO: withOffset(when, offsetMinutes),
        heightM: num(event.Height),
        approximateTime: event.IsApproximateTime === true,
        approximateHeight: event.IsApproximateHeight === true,
      } satisfies TidalEvent;
    })
    .filter((event): event is TidalEvent => event !== null)
    .sort((a, b) => a.dateTimeISO.localeCompare(b.dateTimeISO));

  if (events.length === 0) {
    return fail<TidesPayload>(
      "The tidal station returned no events for this period.",
      "warn_no_data"
    );
  }

  return succeed({ station: nearest, events });
}
