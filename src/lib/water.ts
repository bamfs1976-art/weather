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

import { latLonToGrid } from "./osgb";
import type { Section } from "./weather-types";
import type {
  BathingWater,
  FloodWarning,
  MarineConditions,
  MarineHour,
  RiverMeasure,
  RiverStation,
  TideExtreme,
  TideGauge,
  TideReading,
} from "./water-types";

/* Overridable so the EA response handling can be tested offline. */
const EA_BASE =
  process.env.EA_BASE_URL ?? "https://environment.data.gov.uk/flood-monitoring";
const BWQ_BASE =
  process.env.BWQ_BASE_URL ?? "https://environment.data.gov.uk";
const MARINE_BASE = "https://marine-api.open-meteo.com/v1/marine";

const TTL = {
  floods: 300,
  readings: 600,
  marine: 1_800,
  // Samples are weekly in season and the annual class changes once a year,
  // so this is the one feed where a long cache costs nothing.
  bathing: 21_600,
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
  timeoutMs = 8_000
): Promise<Section<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate },
      headers: {
        Accept: "application/json",
        /*
         * Defra's linked-data platform returns 403 to requests with no
         * User-Agent, which is what every bathing water URL did in production
         * while flood-monitoring — a different service on the same host —
         * answered fine. Serverless fetch sends none by default.
         */
        "User-Agent": "swanseaweather/1.0 (+https://swanseaweather.netlify.app)",
        ...headers,
      },
      // Cap each upstream so one slow service can't run the serverless
      // function out of time and take the whole payload down with it.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return fail<T>("The service did not respond in time.", "timeout");
    }
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

interface RawReading {
  "@id"?: string;
  measure?: string;
  dateTime?: string;
  value?: number;
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
  limit = 3,
  offsetMinutes: number | null = null
): Promise<Section<RiverStation[]>> {
  const url = `${EA_BASE}/id/stations?lat=${lat}&long=${lon}&dist=${distKm}&parameter=level&_limit=20`;
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
      let lookupFailed = false;
      if (notation) {
        /*
         * Two calls, because the Environment Agency returns `latestReading` as
         * a URI string rather than an embedded object unless you ask for the
         * full view. Reading only the object form meant every value came back
         * null and the panel reported "no gauge is currently reporting" even
         * though gauges were right there. `readings?latest` gives the values
         * directly; `measures` gives the metadata (parameter, qualifier, unit)
         * to label them with.
         */
        const [measureSection, readingSection] = await Promise.all([
          getJSON<{ items?: RawMeasure | RawMeasure[] }>(
            `${EA_BASE}/id/stations/${encodeURIComponent(notation)}/measures`,
            TTL.readings
          ),
          getJSON<{ items?: RawReading | RawReading[] }>(
            `${EA_BASE}/id/stations/${encodeURIComponent(notation)}/readings?latest`,
            TTL.readings
          ),
        ]);

        // Latest value per measure URI.
        const latest = new Map<string, { value: number | null; dateTime: string | null }>();
        if (readingSection.ok && readingSection.data) {
          for (const reading of toArray(readingSection.data.items)) {
            const measureId = str(reading.measure);
            if (!measureId) continue;
            latest.set(measureId, {
              value: num(reading.value),
              dateTime: str(reading.dateTime),
            });
          }
        }

        if (!measureSection.ok) lookupFailed = true;
        if (measureSection.ok && measureSection.data) {
          measures = toArray(measureSection.data.items).map((measure) => {
            const measureId = str(measure["@id"]) ?? "";
            // Prefer the embedded object when the API does supply one.
            const embedded =
              typeof measure.latestReading === "object" && measure.latestReading
                ? measure.latestReading
                : undefined;
            const fromReadings = latest.get(measureId);
            const value = num(embedded?.value) ?? fromReadings?.value ?? null;
            const when = str(embedded?.dateTime) ?? fromReadings?.dateTime ?? null;
            const { state, rangePosition } = classify(value, low, high);
            return {
              id: measureId || notation,
              parameter: str(measure.parameter) ?? "level",
              parameterName: str(measure.parameterName) ?? "Water level",
              qualifier: str(measure.qualifier),
              unit: str(measure.unitName),
              value,
              dateTimeISO: when ? withOffset(when, offsetMinutes) : null,
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
        measures,
        lookupFailed,
      } satisfies RiverStation;
    })
  );

  const withMeasures = stations.filter((station) => station.measures.length > 0);
  if (withMeasures.length === 0) {
    /*
     * Distinguish "this gauge publishes nothing" from "the request for its
     * measures did not come back". Both used to say the former, which sent me
     * looking at the wrong thing when a burst of requests was being throttled
     * and the gauges were fine.
     */
    const failed = stations.some((station) => station.lookupFailed);
    return fail<RiverStation[]>(
      failed
        ? "Gauges were found nearby, but the Environment Agency did not return their measurements in time."
        : "Gauges were found nearby but none publishes a measurement series.",
      failed ? "timeout" : "warn_no_data"
    );
  }

  /*
   * Stations with no current value are kept rather than dropped — a gauge that
   * exists but is briefly silent is worth showing as such, and hiding it made
   * the whole card look empty when only the readings lookup had failed.
   */
  return succeed(withMeasures);
}

/* ------------------------------------------------------------------ */
/* Tides (EA tide gauge network — free, no key)                        */
/* ------------------------------------------------------------------ */

/**
 * Sea level from the nearest tide gauge, with the recent turning points.
 *
 * A deliberate limitation, stated here because it changes what the card can
 * honestly claim: these are *measurements*, not predictions. The Environment
 * Agency's gauge network reports observed sea level every fifteen minutes, so
 * the high and low waters below are ones that have already happened. A
 * published tide table works the other way round — it predicts them — and that
 * needs an Admiralty subscription. What this gives instead is the actual water
 * level right now and the state of the tide, which for "is the beach in or
 * out" is arguably the more useful of the two.
 */
export async function getTideGauge(
  lat: number,
  lon: number,
  offsetMinutes: number | null = null,
  distKm = 60
): Promise<Section<TideGauge>> {
  const stationSection = await getJSON<{ items?: RawStation | RawStation[] }>(
    `${EA_BASE}/id/stations?type=TideGauge&lat=${lat}&long=${lon}&dist=${distKm}&_limit=10`,
    TTL.readings
  );
  if (!stationSection.ok || !stationSection.data) {
    return { ok: false, data: null, error: stationSection.error, code: stationSection.code };
  }

  const nearest = toArray(stationSection.data.items)
    .map((item) => {
      const sLat = num(firstOf(item.lat));
      const sLon = num(firstOf(item.long));
      return {
        item,
        distance:
          sLat !== null && sLon !== null ? distanceKM(lat, lon, sLat, sLon) : null,
      };
    })
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))[0];

  if (!nearest) {
    return fail<TideGauge>(
      "No tide gauge within range — the network covers the coast only.",
      "warn_no_data"
    );
  }

  const notation =
    str(nearest.item.notation) ?? str(nearest.item["@id"])?.split("/").pop() ?? "";
  if (!notation) {
    return fail<TideGauge>("The nearest tide gauge has no station id.", "bad_response");
  }

  // 48 hours at four readings an hour, oldest first, so the series can be
  // charted directly and the turning points found by walking it.
  /*
   * Try more than one documented form and keep the first that yields a usable
   * series. The station lookup succeeds and the readings come back empty often
   * enough — reported live as "not currently reporting" while the gauge was
   * plainly fine — that pinning this on one URL shape is a guess, and guessing
   * URL shapes has cost this project a lot of rounds. `via` records which form
   * worked so diagnostics can report it rather than leaving it a mystery.
   */
  /*
   * 24 hours rather than 48, and 100 rows rather than 250. The wider query
   * timed out in production: two tidal cycles is all the turning-point finder
   * needs, and asking the Environment Agency for a quarter of the rows is the
   * difference between answering and not.
   */
  /*
   * One request, twelve hours, sixty rows.
   *
   * This started as 48 hours at 250 rows, which timed out; then as a chain of
   * three fallbacks, which timed out *and* pushed the whole burst of
   * Environment Agency calls over what the service will absorb — river levels,
   * which had been working for weeks, started reporting no gauges at all. The
   * fallbacks were treating a throughput problem as a URL problem and making it
   * worse. Twelve hours still spans a full tidal cycle, which is all the
   * turning-point finder needs to place a high and a low.
   */
  const since = new Date(Date.now() - 13 * 3600_000).toISOString().slice(0, 19) + "Z";
  const station = `${EA_BASE}/id/stations/${encodeURIComponent(notation)}`;
  const via = "since+sorted";

  const readingSection = await getJSON<{ items?: RawReading | RawReading[] }>(
    `${station}/readings?since=${encodeURIComponent(since)}&_sorted&_limit=60`,
    TTL.readings,
    {},
    6_000
  );

  const readings = readingSection.ok && readingSection.data
    ? parseReadings(readingSection.data.items, offsetMinutes)
    : [];
  const lastError: Section<TideGauge> | null = readingSection.ok
    ? null
    : { ok: false, data: null, error: readingSection.error, code: readingSection.code };

  if (readings.length === 0 && lastError) return lastError;

  if (readings.length < 4) {
    return fail<TideGauge>(
      readings.length === 0
        ? "The nearest tide gauge returned no readings."
        : `The nearest tide gauge returned only ${readings.length} readings — too few to find high and low water.`,
      "warn_no_data"
    );
  }

  const levels = readings.map((r) => r.levelM);
  const latest = readings[readings.length - 1];
  const previous = readings[readings.length - 2];

  return succeed({
    id: notation,
    label: str(firstOf(nearest.item.label)) ?? notation,
    distanceKM: nearest.distance,
    unit: "m",
    latest,
    readings,
    via,
    extremes: findTurningPoints(readings),
    rangeM: Math.max(...levels) - Math.min(...levels),
    rising: latest.levelM === previous.levelM ? null : latest.levelM > previous.levelM,
  });
}

/** Rows to a sorted level series, dropping anything without a time and value. */
function parseReadings(
  items: RawReading | RawReading[] | undefined,
  offsetMinutes: number | null
): TideReading[] {
  return toArray(items)
    .map((reading) => {
      const when = str(reading.dateTime);
      const level = num(reading.value);
      return when !== null && level !== null
        ? { timeISO: withOffset(when, offsetMinutes), levelM: level, at: Date.parse(when) }
        : null;
    })
    .filter((r): r is TideReading & { at: number } => r !== null)
    .sort((a, b) => a.at - b.at)
    .map(({ timeISO, levelM }) => ({ timeISO, levelM }));
}

/**
 * Find high and low waters in a level series.
 *
 * A plain "higher than both neighbours" test finds dozens of false peaks,
 * because a gauge in a swell records noise of a few centimetres on top of a
 * curve that moves metres. So a point has to be the extreme of a window either
 * side of it, and consecutive turning points must alternate high/low and sit at
 * least three hours apart — half a tidal cycle being roughly six.
 */
function findTurningPoints(readings: TideReading[]): TideExtreme[] {
  /*
   * Work on a smoothed copy. Around high and low water the tide is nearly
   * flat — it moves less in a quarter of an hour than a gauge's own noise does
   * — so taking the single highest sample puts the turn wherever the noise
   * happened to peak, which measured up to fifteen minutes out against a
   * synthetic curve with a known answer. A centred mean cannot shift a
   * symmetric peak, so it costs nothing and removes most of that error.
   */
  const smooth = smoothLevels(readings.map((r) => r.levelM), 2);
  const WINDOW = 8; // ±2 hours at four readings an hour
  /*
   * The window shrinks at the ends of the series, because the most recent turn
   * is the one people care about and a fixed window can never see it: a high
   * water ninety minutes ago has only six readings after it, so requiring eight
   * hides it and the card reports a high from half a day earlier instead. An
   * hour either side is still ample to distinguish a real turn from noise,
   * given the alternation and spacing rules below.
   */
  const MIN_SIDE = 4;
  const MIN_GAP_MS = 3 * 3600_000;
  const found: TideExtreme[] = [];

  for (let i = MIN_SIDE; i < readings.length - MIN_SIDE; i++) {
    const level = smooth[i];
    const side = Math.min(WINDOW, i, readings.length - 1 - i);
    let isHigh = true;
    let isLow = true;
    for (let j = i - side; j <= i + side; j++) {
      if (j === i) continue;
      if (smooth[j] > level) isHigh = false;
      if (smooth[j] < level) isLow = false;
    }
    if (!isHigh && !isLow) continue;

    const kind: "high" | "low" = isHigh ? "high" : "low";
    const refined = refineTurn(readings, smooth, i);
    const at = Date.parse(refined.timeISO);
    const last = found[found.length - 1];
    if (last) {
      const gap = at - Date.parse(last.timeISO);
      if (gap < MIN_GAP_MS) {
        // Same turning point seen twice: keep whichever is more extreme.
        const better =
          kind === "high" ? refined.levelM > last.levelM : refined.levelM < last.levelM;
        if (kind === last.kind && better) {
          found[found.length - 1] = { ...refined, kind };
        }
        continue;
      }
      if (kind === last.kind) continue;
    }
    found.push({ ...refined, kind });
  }

  return found;
}

/** Centred moving average. Radius 0 returns the input unchanged. */
function smoothLevels(levels: number[], radius: number): number[] {
  if (radius <= 0) return levels;
  return levels.map((_, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(levels.length - 1, i + radius);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += levels[j];
    return sum / (to - from + 1);
  });
}

/**
 * Place the turn between samples by fitting a parabola through the smoothed
 * neighbours. Readings arrive every fifteen minutes, so without this the answer
 * can only ever be a multiple of fifteen; with it, a flat peak resolves to
 * roughly the nearest minute.
 */
function refineTurn(
  readings: TideReading[],
  smooth: number[],
  i: number
): TideReading {
  const fallback = { timeISO: readings[i].timeISO, levelM: smooth[i] };
  if (i <= 0 || i >= readings.length - 1) return fallback;

  const before = smooth[i - 1];
  const at = smooth[i];
  const after = smooth[i + 1];
  const denominator = before - 2 * at + after;
  if (denominator === 0) return fallback;

  // Vertex of the parabola through the three points, in samples from i.
  const offset = (0.5 * (before - after)) / denominator;
  if (!Number.isFinite(offset) || Math.abs(offset) > 1) return fallback;

  const t = Date.parse(readings[i].timeISO);
  const step =
    Date.parse(readings[i + 1].timeISO) - Date.parse(readings[i - 1].timeISO);
  if (Number.isNaN(t) || !Number.isFinite(step) || step <= 0) return fallback;

  const shifted = new Date(t + offset * (step / 2));
  // Keep the offset the series carries rather than collapsing to UTC.
  const zone = readings[i].timeISO.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "Z";
  const stamp =
    zone === "Z"
      ? shifted.toISOString().replace(/\.\d{3}Z$/, "Z")
      : new Date(shifted.getTime() + zoneOffsetMs(zone))
          .toISOString()
          .replace(/\.\d{3}Z$/, "") + zone;

  return { timeISO: stamp, levelM: at - 0.25 * (before - after) * offset };
}

function zoneOffsetMs(zone: string): number {
  const match = zone.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

/* ------------------------------------------------------------------ */
/* Bathing water quality (EA/NRW — free, no key)                       */
/* ------------------------------------------------------------------ */

interface RawBathingWater {
  item?: RawBathingItem | RawBathingItem[];
}

interface RawBathingItem {
  bathingWater?: {
    _about?: string;
    name?: { _value?: string } | string;
    district?: { name?: { _value?: string } | string } | string;
    samplingPoint?: { lat?: number; long?: number };
  };
  sampleClassification?: { name?: { _value?: string } | string };
  sampleDateTime?: { inXSDDateTime?: { _value?: string } } | string;
  complianceClassification?: { name?: { _value?: string } | string };
  latestComplianceAssessment?: { complianceClassification?: { name?: { _value?: string } | string } };
}

/** The Defra linked-data API wraps most strings as { _value }. */
function linked(value: unknown): string | null {
  if (typeof value === "string") return str(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("_value" in record) return str(record._value);
    if ("name" in record) return linked(record.name);
  }
  return null;
}

/**
 * Designated bathing waters near a point, with their most recent sample.
 *
 * Queried by National Grid reference because the Defra service indexes on
 * eastings and northings and offers no lat/long filter — see lib/osgb.ts.
 * Sampling runs May to September, so out of season the newest sample is
 * legitimately months old and the annual classification is the live number.
 */
export async function getBathingWaters(
  lat: number,
  lon: number,
  limit = 5
): Promise<Section<BathingWater[]>> {
  const grid = latLonToGrid(lat, lon);
  if (!grid) {
    return fail<BathingWater[]>(
      "Bathing water quality is published for England and Wales only.",
      "warn_no_data"
    );
  }

  /*
   * Several documented shapes, tried in order. The England path returned HTTP
   * 403 in production while every other feed on the same host worked, so
   * something about that exact URL is wrong rather than the service being
   * down — and Welsh bathing waters are published under their own dataset
   * path, which is where Gower beaches would actually live. Rather than pick
   * one and hope, try each and report which answered.
   */
  const e = Math.round(grid.easting);
  const n = Math.round(grid.northing);
  /*
   * One request. Four different URL shapes were tried in production and every
   * one returned 403, including with a User-Agent — so the path was never the
   * problem and the extra three only added load to a host that was already
   * struggling. Welsh bathing waters live under the Wales dataset, so that is
   * the one worth keeping.
   */
  const via = "wales/latest-nearest";
  const section = await getJSON<{ result?: RawBathingWater }>(
    `${BWQ_BASE}/wales/bathing-waters/data/bathing-water-quality/in-season/latest-nearest/easting/${e}/northing/${n}.json?_pageSize=${limit}`,
    TTL.bathing,
    {},
    6_000
  );

  if (!section || !section.ok || !section.data) {
    return {
      ok: false,
      data: null,
      error: section?.error ?? "Bathing water quality unavailable.",
      code: section?.code ?? "network",
    };
  }

  const items = toArray(section.data.result?.item);
  if (items.length === 0) {
    return fail<BathingWater[]>(
      "No designated bathing water found near this location.",
      "warn_no_data"
    );
  }

  const waters: BathingWater[] = items.slice(0, limit).map((item): BathingWater => {
    const water = item.bathingWater ?? {};
    const point = water.samplingPoint ?? {};
    const pLat = num(point.lat);
    const pLon = num(point.long);
    const sampledAt =
      typeof item.sampleDateTime === "string"
        ? str(item.sampleDateTime)
        : str(item.sampleDateTime?.inXSDDateTime?._value);

    return {
      id: str(water._about) ?? linked(water.name) ?? "",
      name: linked(water.name) ?? "Bathing water",
      district: linked(water.district),
      lat: pLat,
      lon: pLon,
      distanceKM:
        pLat !== null && pLon !== null ? distanceKM(lat, lon, pLat, pLon) : null,
      latestSampleISO: sampledAt,
      latestSampleClass: linked(item.sampleClassification),
      annualClass:
        linked(item.complianceClassification) ??
        linked(item.latestComplianceAssessment?.complianceClassification),
      profileUrl: str(water._about),
      via,
    };
  });

  return succeed(
    waters.sort((a, b) => (a.distanceKM ?? 1e9) - (b.distanceKM ?? 1e9))
  );
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
