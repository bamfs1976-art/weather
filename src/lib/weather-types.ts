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

/** Everything the dashboard needs for a location, in one payload. */
export interface WeatherOverview {
  place: ResolvedPlace;
  fetchedAt: string;
  sections: {
    current: Section<ConditionsResponse>;
    observation: Section<ObservationResponse>;
    minutely: Section<{ periods: MinutelyPeriod[] }>;
    hourly: Section<ConditionsResponse>;
    daily: Section<ConditionsResponse>;
    dayNight: Section<ConditionsResponse>;
    alerts: Section<AlertItem[]>;
    airQuality: Section<AirQualityResponse>;
    airQualityForecast: Section<AirQualityResponse>;
    sunMoon: Section<SunMoonResponse>;
    threats: Section<ThreatItem[]>;
    lightning: Section<LightningSummaryResponse>;
    phrase: Section<{ periods: { text?: string; weatherPrimary?: string }[] }>;
    recent: Section<ConditionsResponse>;
  };
}

export interface HistoryPayload {
  place: ResolvedPlace;
  from: string;
  to: string;
  sections: {
    dailySummaries: Section<ConditionsResponse>;
    stationSummaries: Section<ConditionsResponse>;
    normals: Section<NormalsResponse>;
  };
}

export interface ArchiveDayPayload {
  place: ResolvedPlace;
  date: string;
  sections: {
    hourly: Section<ConditionsResponse>;
    observations: Section<{ periods: WeatherPeriod[] }>;
    sunMoon: Section<SunMoonResponse>;
  };
}

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
