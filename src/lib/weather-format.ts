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
