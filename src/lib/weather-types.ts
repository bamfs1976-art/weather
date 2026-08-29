import type {
  MetOfficeDaily,
  MetOfficeForecast,
  MetOfficeThreeHourly,
} from "./metoffice-types";
import type { MetNoForecast } from "./metno-types";
import type { ModelSpread } from "./model-types";
import type { EnsembleForecast } from "./ensemble-types";
import type { AuroraStatus, WeatherWarning } from "./warning-types";
import type { PollenForecast } from "./pollen-types";
/**
 * Types for the Xweather (Vaisala) Weather API responses used by the app.
 *
 * The upstream API returns a very wide payload per endpoint. These types cover
 * the fields the UI actually reads; anything else is left untyped rather than
 * mirrored exactly, so an upstream addition never breaks the build.
 */

/** Wrapper returned by every server-side Xweather call. */
export interface Section<T> {
  ok: boolean;
  data: T | null;
  /** Human-readable reason the section is missing (auth, tier, no data...). */
  error: string | null;
  /** Upstream error code, e.g. "warn_no_data" or "permission_denied". */
  code: string | null;
}

export interface Place {
  name: string;
  state: string;
  country: string;
  countryFull?: string;
  stateFull?: string;
  region?: string;
  continent?: string;
}

export interface PlaceProfile {
  elevM?: number;
  elevFT?: number;
  pop?: number;
  tz?: string;
  tzname?: string;
  tzoffset?: number;
  isDST?: boolean;
}

export interface Loc {
  lat: number;
  long: number;
}

/** Resolved location, shared by every section of the payload. */
export interface ResolvedPlace {
  id: string;
  name: string;
  /** "Cardiff, Wales, United Kingdom" */
  displayName: string;
  lat: number;
  lon: number;
  tz: string | null;
  tzname: string | null;
  tzoffset: number | null;
  elevM: number | null;
  elevFT: number | null;
  country: string | null;
  countryFull: string | null;
  state: string | null;
  stateFull: string | null;
  profile: PlaceProfile | null;
}

/** A row from /conditions, /observations or /forecasts — field names overlap heavily. */
export interface WeatherPeriod {
  timestamp?: number;
  dateTimeISO?: string;
  /** Forecast periods use validTime; observations use ob.dateTimeISO. */
  validTime?: string;

  tempC?: number | null;
  tempF?: number | null;
  maxTempC?: number | null;
  maxTempF?: number | null;
  minTempC?: number | null;
  minTempF?: number | null;
  avgTempC?: number | null;
  avgTempF?: number | null;
  feelslikeC?: number | null;
  feelslikeF?: number | null;
  maxFeelslikeC?: number | null;
  maxFeelslikeF?: number | null;
  minFeelslikeC?: number | null;
  minFeelslikeF?: number | null;
  dewpointC?: number | null;
  dewpointF?: number | null;
  avgDewpointC?: number | null;
  avgDewpointF?: number | null;
  wetBulbC?: number | null;
  wetBulbF?: number | null;
  heatindexC?: number | null;
  heatindexF?: number | null;
  windchillC?: number | null;
  windchillF?: number | null;

  humidity?: number | null;
  minHumidity?: number | null;
  maxHumidity?: number | null;

  pressureMB?: number | null;
  pressureIN?: number | null;
  altimeterMB?: number | null;
  altimeterIN?: number | null;
  spressureMB?: number | null;
  spressureIN?: number | null;

  windSpeedKPH?: number | null;
  windSpeedMPH?: number | null;
  windSpeedKTS?: number | null;
  windDir?: string | null;
  windDirDEG?: number | null;
  windGustKPH?: number | null;
  windGustMPH?: number | null;
  windGustKTS?: number | null;
  windSpeedMaxKPH?: number | null;
  windSpeedMaxMPH?: number | null;
  windSpeedMinKPH?: number | null;
  windSpeedMinMPH?: number | null;
  windDirMax?: string | null;
  windDirMaxDEG?: number | null;

  precipMM?: number | null;
  precipIN?: number | null;
  precipRateMM?: number | null;
  precipRateIN?: number | null;
  snowCM?: number | null;
  snowIN?: number | null;
  snowDepthCM?: number | null;
  snowDepthIN?: number | null;
  iceaccumMM?: number | null;
  iceaccumIN?: number | null;
  pop?: number | null;

  sky?: number | null;
  cloudsCoded?: string | null;
  ceilingM?: number | null;
  ceilingFT?: number | null;
  visibilityKM?: number | null;
  visibilityMI?: number | null;

  uvi?: number | null;
  maxUvi?: number | null;
  solradWM2?: number | null;
  solradMinWM2?: number | null;
  solradMaxWM2?: number | null;
  ghi?: number | null;
  dni?: number | null;
  dhi?: number | null;

  weather?: string | null;
  weatherCoded?: string | null;
  weatherPrimary?: string | null;
  weatherPrimaryCoded?: string | null;
  icon?: string | null;
  isDay?: boolean;
  sunrise?: number | null;
  sunriseISO?: string | null;
  sunset?: number | null;
  sunsetISO?: string | null;
}

export interface ConditionsResponse {
  id?: string;
  loc?: Loc;
  place?: Place;
  profile?: PlaceProfile;
  periods: WeatherPeriod[];
}

export interface ObservationResponse {
  id: string;
  loc?: Loc;
  place?: Place;
  profile?: {
    tz?: string;
    tzname?: string;
    elevM?: number;
    elevFT?: number;
    /** Distance from the requested point. */
    stationDistanceKM?: number;
    stationDistanceMI?: number;
  };
  ob?: WeatherPeriod & {
    recTimestamp?: number;
    recDateTimeISO?: string;
    QC?: string;
    QCcode?: number;
    light?: number | null;
    flightRule?: string | null;
    trustFactor?: number;
  };
  relativeTo?: {
    lat: number;
    long: number;
    bearing: number;
    bearingENG: string;
    distanceKM: number;
    distanceMI: number;
  };
}

export interface MinutelyPeriod {
  timestamp: number;
  dateTimeISO: string;
  precipMM?: number | null;
  precipIN?: number | null;
  precipRateMM?: number | null;
  precipRateIN?: number | null;
  weatherPrimary?: string | null;
  weatherPrimaryCoded?: string | null;
  icon?: string | null;
}

export interface AlertDetails {
  type?: string;
  name?: string;
  loc?: string;
  emergency?: boolean;
  color?: string;
  cat?: string;
  bodyFull?: string;
  body?: string;
  priority?: number;
}

export interface AlertTimestamps {
  issuedISO?: string;
  beginsISO?: string;
  expiresISO?: string;
  addedISO?: string;
}

export interface AlertItem {
  id: string;
  details?: AlertDetails;
  timestamps?: AlertTimestamps;
  includes?: { counties?: string[]; wxzones?: string[] };
  active?: boolean;
}

export interface AirQualityPollutant {
  type: string;
  name: string;
  valuePPB?: number | null;
  valueUGM3?: number | null;
  aqi?: number | null;
  category?: string | null;
  color?: string | null;
}

export interface AirQualityPeriod {
  dateTimeISO?: string;
  timestamp?: number;
  aqi?: number | null;
  category?: string | null;
  color?: string | null;
  method?: string | null;
  dominant?: string | null;
  pollutants?: AirQualityPollutant[];
}

export interface AirQualityResponse {
  id?: string;
  loc?: Loc;
  place?: Place;
  periods: AirQualityPeriod[];
  profile?: { tz?: string; sources?: { name: string }[] };
}

export interface SunMoonResponse {
  sun?: {
    riseISO?: string | null;
    setISO?: string | null;
    transitISO?: string | null;
    midnightSunISO?: string | null;
    polarNightISO?: string | null;
    twilight?: {
      civilBeginISO?: string | null;
      civilEndISO?: string | null;
      nauticalBeginISO?: string | null;
      nauticalEndISO?: string | null;
      astronomicalBeginISO?: string | null;
      astronomicalEndISO?: string | null;
    };
  };
  moon?: {
    riseISO?: string | null;
    setISO?: string | null;
    transitISO?: string | null;
    underfootISO?: string | null;
    phase?: {
      phase?: number;
      name?: string;
      illum?: number;
      age?: number;
      angle?: number;
    };
  };
  /** Present when a date range is requested. */
  sequence?: unknown[];
}

export interface ThreatItem {
  id?: string;
  type?: string;
  name?: string;
  priority?: number;
  distanceKM?: number;
  distanceMI?: number;
  bearing?: number;
  bearingENG?: string;
  details?: Record<string, unknown>;
}

export interface LightningSummaryResponse {
  range?: { dateTimeISO?: string; maxDateTimeISO?: string; minDateTimeISO?: string };
  count?: number;
  periods?: {
    dateTimeISO?: string;
    summary?: {
      range?: { minTimestamp?: number; maxTimestamp?: number };
      count?: number;
      cg?: number;
      ic?: number;
      pulse?: number;
      polarity?: { pos?: number; neg?: number };
      distance?: { minKM?: number; maxKM?: number; minMI?: number; maxMI?: number };
    };
  }[];
  summary?: {
    count?: number;
    cg?: number;
    ic?: number;
    distance?: { minKM?: number; maxKM?: number; minMI?: number; maxMI?: number };
  };
}

export interface NormalPeriod {
  month?: number;
  day?: number;
  dateTimeISO?: string;
  maxTempC?: number | null;
  maxTempF?: number | null;
  minTempC?: number | null;
  minTempF?: number | null;
  avgTempC?: number | null;
  avgTempF?: number | null;
  precipMM?: number | null;
  precipIN?: number | null;
  snowCM?: number | null;
  snowIN?: number | null;
}

export interface NormalsResponse {
  id?: string;
  place?: Place;
  periods: NormalPeriod[];
}

/**
 * Everything the dashboard needs for a location, in one payload.
 *
 * The section maps below are `Partial` on purpose. Every one of these payloads
 * is JSON parsed off the wire and cast, so declaring a section non-optional
 * asserts a guarantee the response cannot make — a route deployed before a
 * section existed, or after one was removed, simply will not carry it. Twice
 * now a component has read `.ok` off an absent section and taken its whole tab
 * down with it. `Partial` makes the compiler ask for the guard instead.
 */
export interface WeatherOverview {
  place: ResolvedPlace;
  fetchedAt: string;
  sections: Partial<{
    /**
     * Precipitation for the next hour, from Open-Meteo's 15-minute series.
     * A model nowcast, not the radar-blended one Xweather published.
     */
    minutely: Section<{ periods: MinutelyPeriod[] }>;
    /**
     * **The only Xweather forecast left.** It exists for the comparison card
     * — the second opinion against the Met Office — not to be rendered as the
     * page's own numbers. `leadForecast` will fall back to it if the Met
     * Office is unreachable, which is the one case where it does show.
     */
    hourly: Section<ConditionsResponse>;
    /** Day and night halves, derived from the Met Office daily response. */
    dayNight: Section<ConditionsResponse>;
    /** European AQI and pollutants, CAMS via Open-Meteo. */
    airQuality: Section<AirQualityResponse>;
    /** Computed locally from the coordinates — no upstream at all. */
    sunMoon: Section<SunMoonResponse>;
    /** The trailing 24 hours, from Open-Meteo's past-days series. */
    recent: Section<ConditionsResponse>;
    /** Not Xweather — CAMS pollen via Open-Meteo, folded in here so the
     *  dashboard still loads everything in one request. */
    pollen: Section<PollenForecast>;
    /** Met Office site-specific forecast, carried for comparison. */
    metoffice: Section<MetOfficeForecast>;
    /** Met Office site-specific daily forecast, behind the 10-day tab. */
    metofficeDaily: Section<MetOfficeDaily>;
    /** Met Office three-hourly: 168 hours, so the forecast reaches a week. */
    metofficeThreeHourly: Section<MetOfficeThreeHourly>;
    /**
     * The forecast the dashboard leads with, already in the app's own shape.
     *
     * The Met Office is the authoritative forecaster for the UK and this is a
     * UK dashboard, so its numbers are the ones on the front of the page and
     * Xweather's became the second opinion rather than the source. The
     * conversion happens on the server (`metoffice-periods.ts`) so the panels
     * still read one shape and never learn there were two providers.
     *
     * A failed section here is not an error state: it means the panels fall
     * back to the Xweather sections below, which is exactly what they used to
     * render. `source` says which is on screen so a card can attribute it.
     */
    primary: Section<{
      source: "metoffice";
      siteName: string | null;
      distanceKM: number | null;
      modelRunISO: string | null;
      current: WeatherPeriod | null;
      hourly: WeatherPeriod[];
      daily: WeatherPeriod[];
      /** Three-hour steps out to a week, beyond where `hourly` stops. */
      threeHourly: WeatherPeriod[];
    }>;
    /** MET Norway, the third forecast in the comparison. */
    metno: Section<MetNoForecast>;
    /** Met Office NSWWS severe weather warnings for the location's region. */
    warnings: Section<{ region: string; regionId: string; via: string; warnings: WeatherWarning[] }>;
    /** AuroraWatch UK geomagnetic status — national, not location-specific. */
    aurora: Section<AuroraStatus>;
    /** Per-model temperature and precipitation, for how much the models agree. */
    modelSpread: Section<ModelSpread>;
    /** A true ensemble: probability as a member count rather than an inference. */
    ensemble: Section<EnsembleForecast>;
  }>;
}

export interface HistoryPayload {
  place: ResolvedPlace;
  from: string;
  to: string;
  sections: Partial<{
    dailySummaries: Section<ConditionsResponse>;
    stationSummaries: Section<ConditionsResponse>;
    normals: Section<NormalsResponse>;
  }>;
}

export interface ArchiveDayPayload {
  place: ResolvedPlace;
  date: string;
  sections: Partial<{
    hourly: Section<ConditionsResponse>;
    observations: Section<{ periods: WeatherPeriod[] }>;
    sunMoon: Section<SunMoonResponse>;
  }>;
}

/*
 * The other half of the `Partial` above. A reader can only rely on a section
 * being *possibly* there, but a route has no excuse for leaving one out — every
 * fetch already returns a `Section`, so an omission means someone forgot to
 * wire it up, not that the data was unavailable. The routes annotate what they
 * build with these, so adding a section to the interface fails the build until
 * the route supplies it.
 */
export type OverviewSections = Required<WeatherOverview["sections"]>;
export type HistorySections = Required<HistoryPayload["sections"]>;
export type ArchiveSections = Required<ArchiveDayPayload["sections"]>;

export interface PlaceSuggestion {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  country: string | null;
  state: string | null;
  /** Query string to pass back to the API as the canonical location. */
  query: string;
}

export type UnitSystem = "metric" | "imperial";

export type ThemeName = "light" | "dark";
