/**
 * Client-safe formatting helpers. No API keys, no network — pure functions the
 * UI uses to turn Xweather's dual-unit payloads into strings.
 */

import type { UnitSystem, WeatherPeriod } from "./weather-types";

const DASH = "—";

export function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pick(
  metric: number | null | undefined,
  imperial: number | null | undefined,
  units: UnitSystem
): number | null {
  const value = units === "metric" ? metric : imperial;
  return isNum(value) ? value : null;
}

function render(
  value: number | null,
  suffix: string,
  decimals = 0
): string {
  if (value === null) return DASH;
  return `${value.toFixed(decimals)}${suffix}`;
}

/* ----------------------------- units ------------------------------ */

export const unitLabels = {
  metric: { temp: "°C", speed: "km/h", precip: "mm", snow: "cm", distance: "km", pressure: "mb", height: "m" },
  imperial: { temp: "°F", speed: "mph", precip: "in", snow: "in", distance: "mi", pressure: "in", height: "ft" },
} as const;

export function temp(
  period: Pick<WeatherPeriod, "tempC" | "tempF"> | null | undefined,
  units: UnitSystem
): string {
  if (!period) return DASH;
  return render(pick(period.tempC, period.tempF, units), "°");
}

export function tempValue(
  metric: number | null | undefined,
  imperial: number | null | undefined,
  units: UnitSystem
): number | null {
  return pick(metric, imperial, units);
}

/** Generic metric/imperial selector — handy when feeding charts raw numbers. */
export const pickUnit = tempValue;

export function formatTemp(
  metric: number | null | undefined,
  imperial: number | null | undefined,
  units: UnitSystem
): string {
  return render(pick(metric, imperial, units), "°");
}

export function formatSpeed(
  kph: number | null | undefined,
  mph: number | null | undefined,
  units: UnitSystem
): string {
  const value = pick(kph, mph, units);
  return render(value, ` ${unitLabels[units].speed}`);
}

export function formatPrecip(
  mm: number | null | undefined,
  inches: number | null | undefined,
  units: UnitSystem
): string {
  const value = pick(mm, inches, units);
  if (value === null) return DASH;
  return units === "metric"
    ? `${value.toFixed(value >= 10 ? 0 : 1)} mm`
    : `${value.toFixed(2)} in`;
}

export function formatSnow(
  cm: number | null | undefined,
  inches: number | null | undefined,
  units: UnitSystem
): string {
  const value = pick(cm, inches, units);
  if (value === null) return DASH;
  return units === "metric" ? `${value.toFixed(1)} cm` : `${value.toFixed(1)} in`;
}

export function formatDistance(
  km: number | null | undefined,
  mi: number | null | undefined,
  units: UnitSystem
): string {
  const value = pick(km, mi, units);
  if (value === null) return DASH;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unitLabels[units].distance}`;
}

export function formatPressure(
  mb: number | null | undefined,
  inHg: number | null | undefined,
  units: UnitSystem
): string {
  const value = pick(mb, inHg, units);
  if (value === null) return DASH;
  return units === "metric" ? `${value.toFixed(0)} mb` : `${value.toFixed(2)} inHg`;
}

export function formatHeight(
  m: number | null | undefined,
  ft: number | null | undefined,
  units: UnitSystem
): string {
  const value = pick(m, ft, units);
  if (value === null) return DASH;
  return `${Math.round(value).toLocaleString()} ${unitLabels[units].height}`;
}

export function formatPercent(value: number | null | undefined): string {
  return isNum(value) ? `${Math.round(value)}%` : DASH;
}

export function formatNumber(
  value: number | null | undefined,
  suffix = "",
  decimals = 0
): string {
  return isNum(value) ? `${value.toFixed(decimals)}${suffix}` : DASH;
}

/* ------------------------------ time ------------------------------ */

/**
 * Xweather ISO strings carry the location's own UTC offset (e.g.
 * "2026-08-08T14:00:00+01:00"), so formatting in that offset keeps everything
 * in local-for-the-place time regardless of where the browser is.
 */
function offsetFrom(iso: string): number | null {
  const match = iso.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!match) return iso.endsWith("Z") ? 0 : null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Returns a Date shifted so UTC getters read as the location's wall clock. */
function localDate(iso: string): Date | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const offset = offsetFrom(iso);
  if (offset === null) return date;
  return new Date(date.getTime() + offset * 60_000);
}

/** Minutes east of UTC encoded in an Xweather ISO timestamp. */
export function tzOffsetMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return offsetFrom(iso);
}

/** Wall-clock time at `offsetMinutes` east of UTC for an absolute instant. */
export function clockAt(
  instant: Date,
  offsetMinutes: number | null,
  hour12 = false
): string {
  const shifted = new Date(
    instant.getTime() + (offsetMinutes ?? -instant.getTimezoneOffset()) * 60_000
  );
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes().toString().padStart(2, "0");
  if (!hour12) return `${hours.toString().padStart(2, "0")}:${minutes}`;
  const suffix = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes} ${suffix}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatTime(iso: string | null | undefined, hour12 = false): string {
  if (!iso) return DASH;
  const date = localDate(iso);
  if (!date) return DASH;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  if (!hour12) return `${hours.toString().padStart(2, "0")}:${minutes}`;
  const suffix = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes} ${suffix}`;
}

export function formatHourLabel(iso: string | null | undefined, hour12 = false): string {
  if (!iso) return DASH;
  const date = localDate(iso);
  if (!date) return DASH;
  const hours = date.getUTCHours();
  if (!hour12) return `${hours.toString().padStart(2, "0")}:00`;
  const suffix = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}${suffix}`;
}

export function formatWeekday(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = localDate(iso);
  if (!date) return DASH;
  return WEEKDAYS[date.getUTCDay()];
}

export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = localDate(iso);
  if (!date) return DASH;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function formatDateTime(iso: string | null | undefined, hour12 = false): string {
  if (!iso) return DASH;
  return `${formatWeekday(iso)} ${formatDayMonth(iso)}, ${formatTime(iso, hour12)}`;
}

export function isoDateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return DASH;
  const diffMin = Math.round((Date.now() - then) / 60_000);
  if (Math.abs(diffMin) < 1) return "just now";
  if (diffMin > 0) {
    if (diffMin < 60) return `${diffMin} min ago`;
    const hours = Math.round(diffMin / 60);
    return hours < 24 ? `${hours} hr ago` : `${Math.round(hours / 24)} d ago`;
  }
  const ahead = Math.abs(diffMin);
  if (ahead < 60) return `in ${ahead} min`;
  const hours = Math.round(ahead / 60);
  return hours < 24 ? `in ${hours} hr` : `in ${Math.round(hours / 24)} d`;
}

/* ------------------------------ icons ----------------------------- */

/**
 * Xweather returns icon file names like "pcloudyrn.png". Rather than ship an
 * icon set, map the meaningful substrings onto emoji — legible at every size
 * and identical in both themes.
 */
export function weatherEmoji(
  icon: string | null | undefined,
  weatherPrimaryCoded?: string | null
): string {
  const name = (icon ?? "").replace(/\.(png|svg|gif)$/i, "").toLowerCase();
  const night = name.endsWith("n") && !name.endsWith("rain") && !name.endsWith("in");

  const coded = (weatherPrimaryCoded ?? "").toUpperCase();
  if (coded.includes(":T")) return "⛈️";
  if (coded.includes(":A")) return "🌨️"; // hail

  if (!name || name === "na") return "🌡️";
  if (name.includes("tstorm") || name.includes("thunder")) return "⛈️";
  if (name.includes("blizzard")) return "🌨️";
  if (name.includes("snowshowers") || name.includes("flurries")) return "🌨️";
  if (name.includes("snowtorain") || name.includes("raintosnow") || name.includes("wintrymix") || name.includes("rainandsnow")) return "🌨️";
  if (name.includes("sleet") || name.includes("freezingrain")) return "🧊";
  if (name.includes("snow")) return "❄️";
  if (name.includes("drizzle")) return "🌦️";
  if (name.includes("showers")) return "🌦️";
  if (name.includes("rain")) return "🌧️";
  if (name.includes("fog") || name.includes("hazy") || name.includes("smoke") || name.includes("haze")) return "🌫️";
  if (name.includes("dust") || name.includes("sand")) return "🌪️";
  if (name.includes("wind")) return "💨";
  if (name.includes("cold")) return "🥶";
  if (name.includes("hot")) return "🥵";
  if (name.includes("mcloudy")) return night ? "☁️" : "🌥️";
  if (name.includes("pcloudy")) return night ? "☁️" : "⛅";
  if (name.includes("cloudy")) return "☁️";
  if (name.includes("fair")) return night ? "🌙" : "🌤️";
  if (name.includes("clear") || name.includes("sunny")) return night ? "🌙" : "☀️";
  return "🌡️";
}

/* --------------------------- descriptors -------------------------- */

export function windDescription(kph: number | null | undefined): string {
  if (!isNum(kph)) return DASH;
  if (kph < 1) return "Calm";
  if (kph < 6) return "Light air";
  if (kph < 12) return "Light breeze";
  if (kph < 20) return "Gentle breeze";
  if (kph < 29) return "Moderate breeze";
  if (kph < 39) return "Fresh breeze";
  if (kph < 50) return "Strong breeze";
  if (kph < 62) return "Near gale";
  if (kph < 75) return "Gale";
  if (kph < 89) return "Strong gale";
  if (kph < 103) return "Storm";
  if (kph < 118) return "Violent storm";
  return "Hurricane force";
}

export function uviCategory(uvi: number | null | undefined): {
  label: string;
  color: string;
} {
  if (!isNum(uvi)) return { label: DASH, color: "#64748b" };
  if (uvi < 3) return { label: "Low", color: "#22c55e" };
  if (uvi < 6) return { label: "Moderate", color: "#eab308" };
  if (uvi < 8) return { label: "High", color: "#f97316" };
  if (uvi < 11) return { label: "Very high", color: "#ef4444" };
  return { label: "Extreme", color: "#a855f7" };
}

export function aqiCategory(aqi: number | null | undefined): {
  label: string;
  color: string;
  advice: string;
} {
  if (!isNum(aqi)) {
    return { label: DASH, color: "#64748b", advice: "No air quality data." };
  }
  if (aqi <= 50)
    return {
      label: "Good",
      color: "#22c55e",
      advice: "Air quality is satisfactory — outdoor activity is fine.",
    };
  if (aqi <= 100)
    return {
      label: "Moderate",
      color: "#eab308",
      advice: "Unusually sensitive people should consider limiting long outdoor exertion.",
    };
  if (aqi <= 150)
    return {
      label: "Unhealthy for sensitive groups",
      color: "#f97316",
      advice: "Sensitive groups should reduce prolonged outdoor exertion.",
    };
  if (aqi <= 200)
    return {
      label: "Unhealthy",
      color: "#ef4444",
      advice: "Everyone should limit prolonged outdoor exertion.",
    };
  if (aqi <= 300)
    return {
      label: "Very unhealthy",
      color: "#a855f7",
      advice: "Avoid outdoor exertion; keep windows closed.",
    };
  return {
    label: "Hazardous",
    color: "#7f1d1d",
    advice: "Health emergency — stay indoors.",
  };
}

export function pollutantLabel(type: string): string {
  const map: Record<string, string> = {
    "pm2.5": "PM2.5",
    pm2_5: "PM2.5",
    pm25: "PM2.5",
    pm10: "PM10",
    o3: "Ozone (O₃)",
    no2: "Nitrogen dioxide (NO₂)",
    so2: "Sulphur dioxide (SO₂)",
    co: "Carbon monoxide (CO)",
  };
  return map[type.toLowerCase()] ?? type.toUpperCase();
}

export function moonPhaseEmoji(phase: number | null | undefined): string {
  if (!isNum(phase)) return "🌙";
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0625 || p >= 0.9375) return "🌑";
  if (p < 0.1875) return "🌒";
  if (p < 0.3125) return "🌓";
  if (p < 0.4375) return "🌔";
  if (p < 0.5625) return "🌕";
  if (p < 0.6875) return "🌖";
  if (p < 0.8125) return "🌗";
  return "🌘";
}

/** Alert severity colours, keyed off the Xweather alert colour or category. */
export function alertTone(color: string | null | undefined): string {
  if (!color) return "#f59e0b";
  return color.startsWith("#") ? color : `#${color}`;
}

export function pressureTrend(
  periods: { pressureMB?: number | null }[]
): { direction: "rising" | "falling" | "steady"; changeMB: number } | null {
  const values = periods
    .map((p) => p.pressureMB)
    .filter((v): v is number => isNum(v));
  if (values.length < 2) return null;
  const recent = values.slice(-3);
  const earlier = values.slice(0, 3);
  const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const change = avg(recent) - avg(earlier);
  if (Math.abs(change) < 0.7) return { direction: "steady", changeMB: change };
  return { direction: change > 0 ? "rising" : "falling", changeMB: change };
}

export const dash = DASH;

/* ------------------------- next precipitation --------------------- */

export interface NextPrecipitation {
  /** raining right now · starting within the hour · further out · nothing forecast */
  state: "now" | "soon" | "later" | "none";
  /** When it starts. Null when it is already falling. */
  startISO: string | null;
  /** When it is expected to stop, if the data reaches that far. */
  endISO: string | null;
  minutesAway: number | null;
  durationMinutes: number | null;
  probability: number | null;
  amountMM: number | null;
  amountIN: number | null;
  /** "Rain", "Snow", "Thunderstorms"… as reported upstream. */
  type: string;
  /** How precise the answer is — drives the wording in the UI. */
  precision: "minute" | "hour" | "day";
}

const WET =
  /rain|shower|drizzle|snow|sleet|thunder|storm|flurr|freezing|wintry|hail|ice/i;

const DRY: NextPrecipitation = {
  state: "none",
  startISO: null,
  endISO: null,
  minutesAway: null,
  durationMinutes: null,
  probability: null,
  amountMM: null,
  amountIN: null,
  type: "Precipitation",
  precision: "hour",
};

function minutesUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((then - Date.now()) / 60_000));
}

function describeType(
  period: { weatherPrimary?: string | null; weatherPrimaryCoded?: string | null },
  fallback = "Precipitation"
): string {
  const primary = period.weatherPrimary;
  if (primary && WET.test(primary)) return primary;
  const coded = (period.weatherPrimaryCoded ?? "").toUpperCase();
  if (coded.includes(":S")) return "Snow";
  if (coded.includes(":T")) return "Thunderstorms";
  if (coded.includes(":ZR")) return "Freezing rain";
  if (coded.includes(":L")) return "Drizzle";
  if (coded.includes(":R")) return "Rain";
  return fallback;
}

/**
 * Answer "when will it rain next?" from the data the dashboard already holds.
 *
 * Three resolutions, best first: the minute-by-minute nowcast covers the next
 * hour exactly, the hourly forecast covers 48 hours, and the daily forecast
 * catches anything further out. Each falls through to the next only when it has
 * nothing to report, so the answer is always as precise as the data allows.
 */
export function nextPrecipitation(
  minutely: {
    dateTimeISO?: string;
    precipMM?: number | null;
    precipIN?: number | null;
    precipRateMM?: number | null;
    precipRateIN?: number | null;
    weatherPrimary?: string | null;
    weatherPrimaryCoded?: string | null;
  }[],
  hourly: WeatherPeriod[],
  daily: WeatherPeriod[],
  options: { hourlyPop?: number; dailyPop?: number } = {}
): NextPrecipitation {
  const hourlyPop = options.hourlyPop ?? 30;
  const dailyPop = options.dailyPop ?? 40;

  /* 1 — the next 60 minutes, to the minute. */
  const rate = minutely.map((p) =>
    isNum(p.precipRateMM) ? p.precipRateMM : isNum(p.precipMM) ? p.precipMM : 0
  );
  const firstWet = rate.findIndex((value) => value > 0);

  if (firstWet !== -1) {
    let end = firstWet;
    while (end < rate.length && rate[end] > 0) end += 1;
    const run = minutely.slice(firstWet, end);
    const amountMM = run.reduce((sum, p) => sum + (p.precipMM ?? 0), 0);
    const amountIN = run.reduce((sum, p) => sum + (p.precipIN ?? 0), 0);
    const startISO = minutely[firstWet].dateTimeISO ?? null;

    return {
      state: firstWet === 0 ? "now" : "soon",
      startISO: firstWet === 0 ? null : startISO,
      endISO: end < minutely.length ? (minutely[end].dateTimeISO ?? null) : null,
      minutesAway: firstWet === 0 ? 0 : minutesUntil(startISO),
      durationMinutes: end < minutely.length ? run.length : null,
      probability: null,
      amountMM,
      amountIN,
      type: describeType(minutely[firstWet], "Rain"),
      precision: "minute",
    };
  }

  /* 2 — the next 48 hours. */
  const wetHour = (p: WeatherPeriod) =>
    (isNum(p.pop) && p.pop >= hourlyPop) ||
    (isNum(p.precipMM) && p.precipMM > 0) ||
    (p.weatherPrimary ? WET.test(p.weatherPrimary) : false);

  const hourIndex = hourly.findIndex(wetHour);
  if (hourIndex !== -1) {
    let end = hourIndex;
    while (end < hourly.length && wetHour(hourly[end])) end += 1;
    const run = hourly.slice(hourIndex, end);
    const startISO =
      hourly[hourIndex].dateTimeISO ?? hourly[hourIndex].validTime ?? null;
    const away = minutesUntil(startISO);

    return {
      state: away !== null && away <= 60 ? "soon" : "later",
      startISO,
      endISO:
        end < hourly.length
          ? (hourly[end].dateTimeISO ?? hourly[end].validTime ?? null)
          : null,
      minutesAway: away,
      durationMinutes: end < hourly.length ? run.length * 60 : null,
      probability: Math.max(
        ...run.map((p) => (isNum(p.pop) ? p.pop : 0)),
        0
      ),
      amountMM: run.reduce((sum, p) => sum + (p.precipMM ?? 0), 0),
      amountIN: run.reduce((sum, p) => sum + (p.precipIN ?? 0), 0),
      type: describeType(run.find((p) => p.weatherPrimary) ?? run[0], "Rain"),
      precision: "hour",
    };
  }

  /* 3 — anything left in the 10-day outlook. */
  const dayIndex = daily.findIndex(
    (p) =>
      (isNum(p.pop) && p.pop >= dailyPop) ||
      (isNum(p.precipMM) && p.precipMM >= 0.5)
  );
  if (dayIndex !== -1) {
    const day = daily[dayIndex];
    const startISO = day.dateTimeISO ?? day.validTime ?? null;
    return {
      state: "later",
      startISO,
      endISO: null,
      minutesAway: minutesUntil(startISO),
      durationMinutes: null,
      probability: isNum(day.pop) ? day.pop : null,
      amountMM: isNum(day.precipMM) ? day.precipMM : null,
      amountIN: isNum(day.precipIN) ? day.precipIN : null,
      type: describeType(day, "Rain"),
      precision: "day",
    };
  }

  return DRY;
}

/* --------------------------- conditions --------------------------- */

/**
 * The condition vocabulary the UI draws from.
 *
 * Xweather reports conditions as icon file names ("pcloudyrn.png") and coded
 * strings (":T" for thunder). Both are parsed once, here, into a small closed
 * set — so the icon component, the hero gradient and the animated sky layer all
 * branch on the same value instead of each re-parsing the raw name slightly
 * differently.
 */
export type ConditionKind =
  | "clear"
  | "fair"
  | "pcloudy"
  | "mcloudy"
  | "cloudy"
  | "rain"
  | "showers"
  | "drizzle"
  | "tstorm"
  | "snow"
  | "sleet"
  | "hail"
  | "fog"
  | "wind"
  | "hot"
  | "cold"
  | "unknown";

export interface Condition {
  kind: ConditionKind;
  night: boolean;
}

export function classifyCondition(
  icon: string | null | undefined,
  weatherPrimaryCoded?: string | null
): Condition {
  const name = (icon ?? "").replace(/\.(png|svg|gif)$/i, "").toLowerCase();
  /*
   * Xweather marks night icons with a trailing "n" — but "rain" and several
   * others end in n too, so test the suffix only after the words that would
   * produce a false positive have been ruled out.
   */
  const night = /n$/.test(name) && !/(rain|in|sn|wn)$/.test(name);
  const coded = (weatherPrimaryCoded ?? "").toUpperCase();

  const kind = ((): ConditionKind => {
    /*
     * Prefer weatherPrimaryCoded. It is the authoritative field —
     * "coverage:intensity:weather", e.g. "::RW" for rain showers — whereas the
     * icon file name has to be pattern-matched and gets it wrong: "pcloudyr" is
     * partly cloudy *with rain*, but contains neither "rain" nor "showers", so
     * a substring match drew a sun behind a cloud next to the words "Light rain
     * showers".
     */
    const code = coded.split(":").pop() ?? "";
    switch (code) {
      case "T": return "tstorm";
      case "A": case "IP": return "hail";
      case "RW": case "L": return "showers";
      case "R": case "ZR": return "rain";
      case "S": case "SW": case "BS": return "snow";
      case "RS": case "WM": return "sleet";
      case "BR": case "F": case "H": case "K": case "FR": return "fog";
      case "BD": case "BN": case "BY": return "wind";
      case "CL": return "clear";
      case "FW": return "fair";
      case "SC": return "pcloudy";
      case "BK": return "mcloudy";
      case "OV": return "cloudy";
      default: break;
    }
    if (coded.includes(":T")) return "tstorm";
    if (coded.includes(":A")) return "hail";
    if (!name || name === "na") return "unknown";
    /*
     * Falling back to the icon name: Xweather appends a precipitation letter to
     * the cloud state, so check those suffixes before the cloud words or every
     * wet variant reads as merely cloudy.
     */
    if (/(cloudy|fair|clear)t$/.test(name)) return "tstorm";
    if (/(cloudy|fair|clear)sn?$/.test(name)) return "snow";
    if (/(cloudy|fair|clear)r$/.test(name)) return "showers";
    if (name.includes("tstorm") || name.includes("thunder")) return "tstorm";
    if (name.includes("blizzard")) return "snow";
    if (name.includes("snowshowers") || name.includes("flurries")) return "snow";
    if (
      name.includes("snowtorain") ||
      name.includes("raintosnow") ||
      name.includes("wintrymix") ||
      name.includes("rainandsnow")
    ) {
      return "sleet";
    }
    if (name.includes("sleet") || name.includes("freezingrain")) return "sleet";
    if (name.includes("snow")) return "snow";
    if (name.includes("drizzle")) return "drizzle";
    if (name.includes("showers")) return "showers";
    if (name.includes("rain")) return "rain";
    if (
      name.includes("fog") ||
      name.includes("hazy") ||
      name.includes("haze") ||
      name.includes("smoke")
    ) {
      return "fog";
    }
    if (name.includes("dust") || name.includes("sand")) return "wind";
    if (name.includes("wind")) return "wind";
    if (name.includes("cold")) return "cold";
    if (name.includes("hot")) return "hot";
    if (name.includes("mcloudy")) return "mcloudy";
    if (name.includes("pcloudy")) return "pcloudy";
    if (name.includes("cloudy")) return "cloudy";
    if (name.includes("fair")) return "fair";
    if (name.includes("clear") || name.includes("sunny")) return "clear";
    return "unknown";
  })();

  return { kind, night };
}

/** CSS custom property naming the sky gradient for a condition. */
export function skyToken({ kind, night }: Condition): string {
  switch (kind) {
    case "tstorm":
      return "--sky-storm";
    case "rain":
    case "showers":
    case "drizzle":
      return "--sky-rain";
    case "snow":
    case "sleet":
    case "hail":
      return "--sky-snow";
    case "fog":
      return "--sky-fog";
    case "cloudy":
    case "mcloudy":
      return "--sky-cloud";
    case "pcloudy":
      return night ? "--sky-clear-night" : "--sky-cloud";
    case "clear":
    case "fair":
    case "hot":
      return night ? "--sky-clear-night" : "--sky-clear-day";
    case "cold":
    case "wind":
    case "unknown":
    default:
      return night ? "--sky-clear-night" : "--sky-cloud";
  }
}

/** Which animated overlay suits a condition: drifting cloud, rain, or glow. */
export function skyMotion({ kind, night }: Condition): "cloud" | "rain" | "glow" | "none" {
  switch (kind) {
    case "rain":
    case "showers":
    case "drizzle":
    case "tstorm":
    case "snow":
    case "sleet":
    case "hail":
      return "rain";
    case "cloudy":
    case "mcloudy":
    case "pcloudy":
    case "fog":
      return "cloud";
    case "clear":
    case "fair":
    case "hot":
      return night ? "none" : "glow";
    default:
      return "none";
  }
}

/* --------------------------- comparison --------------------------- */

/**
 * Line two forecasts up hour by hour and describe where they disagree.
 *
 * Matching is by absolute instant, not by array position: the two providers
 * start at different points in the hour and Xweather timestamps carry the
 * location's offset while the Met Office publishes UTC, so comparing index 3
 * with index 3 would silently compare different times. Each Xweather hour is
 * paired with the Met Office hour nearest to it, and anything more than half an
 * hour apart is dropped rather than fudged.
 */
export function compareForecasts(
  xweather: { dateTimeISO?: string | null; tempC?: number | null; pop?: number | null }[],
  metoffice: { timeISO: string; tempC: number | null; pop: number | null }[]
): import("./metoffice-types").ForecastComparison {
  const TOLERANCE_MS = 30 * 60_000;

  const mo = metoffice
    .map((hour) => ({ at: Date.parse(hour.timeISO), hour }))
    .filter((entry) => !Number.isNaN(entry.at))
    .sort((a, b) => a.at - b.at);

  const hours: import("./metoffice-types").ComparisonHour[] = [];

  for (const period of xweather) {
    const at = period.dateTimeISO ? Date.parse(period.dateTimeISO) : NaN;
    if (Number.isNaN(at)) continue;

    let best: (typeof mo)[number] | null = null;
    let bestGap = Infinity;
    for (const entry of mo) {
      const gap = Math.abs(entry.at - at);
      if (gap < bestGap) {
        bestGap = gap;
        best = entry;
      }
      // The list is sorted, so once the gap starts growing the nearest is behind us.
      if (entry.at > at && gap > bestGap) break;
    }
    if (!best || bestGap > TOLERANCE_MS) continue;

    const xTemp = isNum(period.tempC) ? period.tempC : null;
    const mTemp = best.hour.tempC;
    const xPop = isNum(period.pop) ? period.pop : null;
    const mPop = best.hour.pop;

    hours.push({
      timeISO: period.dateTimeISO as string,
      xweatherTempC: xTemp,
      metofficeTempC: mTemp,
      tempDeltaC: xTemp !== null && mTemp !== null ? mTemp - xTemp : null,
      xweatherPop: xPop,
      metofficePop: mPop,
      popDelta: xPop !== null && mPop !== null ? mPop - xPop : null,
    });
  }

  const tempDeltas = hours
    .map((hour) => hour.tempDeltaC)
    .filter((delta): delta is number => delta !== null);

  const widestTemp =
    hours
      .filter((hour) => hour.tempDeltaC !== null)
      .sort(
        (a, b) => Math.abs(b.tempDeltaC as number) - Math.abs(a.tempDeltaC as number)
      )[0] ?? null;

  const widestPop =
    hours
      .filter((hour) => hour.popDelta !== null)
      .sort((a, b) => Math.abs(b.popDelta as number) - Math.abs(a.popDelta as number))[0] ??
    null;

  return {
    hours,
    overlap: hours.length,
    meanAbsTempDeltaC: tempDeltas.length
      ? tempDeltas.reduce((sum, d) => sum + Math.abs(d), 0) / tempDeltas.length
      : null,
    biasC: tempDeltas.length
      ? tempDeltas.reduce((sum, d) => sum + d, 0) / tempDeltas.length
      : null,
    widestTemp,
    widestPop,
  };
}

/**
 * Plain-English summary of how closely two forecasts agree.
 *
 * The thresholds are deliberately generous: a degree between two models is
 * normal and should not be dressed up as a disagreement, and treating it as one
 * would make the card cry wolf every day.
 */
export function agreementLabel(meanAbsTempDeltaC: number | null): {
  label: string;
  tone: "good" | "accent" | "warn";
} {
  if (meanAbsTempDeltaC === null) return { label: "Not comparable", tone: "accent" };
  if (meanAbsTempDeltaC < 0.75) return { label: "Close agreement", tone: "good" };
  if (meanAbsTempDeltaC < 1.5) return { label: "Broad agreement", tone: "good" };
  if (meanAbsTempDeltaC < 2.5) return { label: "Some disagreement", tone: "accent" };
  return { label: "Notable disagreement", tone: "warn" };
}
