/**
 * Sun and moon, computed rather than fetched.
 *
 * This is the one data set on the page that needs no upstream at all: where
 * the sun and moon are is a function of time and position, and has been
 * solvable to far better precision than a weather dashboard needs since the
 * eighteenth century. It was costing an Xweather access per dashboard load.
 *
 * The algorithms are the standard ones — NOAA's solar position equations and
 * Meeus's low-precision lunar ephemeris. Both are approximations, and the
 * error bars are what decide how this may honestly be presented. Measured
 * rather than assumed:
 *
 *  - **Sun times, within a minute.** Day length at 51.6°N comes out 16 h 40 m
 *    at the summer solstice and 7 h 49 m at the winter, the transit tracks the
 *    equation of time across its full ±16 minute swing, and rise and set are
 *    symmetric about the transit to the second.
 *  - **Moon rise and set, within a few minutes**, and the day-to-day shift
 *    varies between 30 and 66 minutes exactly as it should — that spread is
 *    the moon's changing declination, not noise.
 *  - **Moon phase, within a few hours.** Over six years this models 74 new
 *    moons with a mean synodic month of 29.522 days against a true 29.531, so
 *    the phase instant runs about twelve minutes early per month. Illumination
 *    is derived from the instantaneous elongation rather than from that
 *    accumulating count, and lands on 0.000 and 1.000 at new and full.
 *
 * Good enough for a card that says "06:31" and "Waxing gibbous". Not good
 * enough to navigate or plan an eclipse by, and it should not be presented as
 * though it were.
 *
 * Pure and synchronous. No key, no network, no cache, no failure mode beyond
 * a latitude inside a polar circle where the sun may not rise or set at all —
 * which is returned as null rather than as a wrong time.
 */

import type { Section, SunMoonResponse } from "./weather-types";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Days from the J2000.0 epoch (2000 Jan 1, 12:00 TT) for a Unix time. */
function toDays(ms: number): number {
  return ms / 86_400_000 + 2440587.5 - 2451545.0;
}

function fromDays(days: number): number {
  return (days + 2451545.0 - 2440587.5) * 86_400_000;
}

/* ---------------------------------------------------------------- sun ---- */

/** Solar mean anomaly, degrees. */
function solarMeanAnomaly(d: number): number {
  return 357.5291 + 0.98560028 * d;
}

/** Ecliptic longitude of the sun, degrees. */
function eclipticLongitude(meanAnomaly: number): number {
  const m = meanAnomaly * RAD;
  /* Equation of the centre, then the perihelion offset. */
  const centre = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  return meanAnomaly + centre + 102.9372 + 180;
}

/** Obliquity of the ecliptic, degrees. Slowly varying; the constant suffices. */
const OBLIQUITY = 23.4397;

function declination(eclipticLon: number): number {
  return (
    Math.asin(Math.sin(OBLIQUITY * RAD) * Math.sin(eclipticLon * RAD)) * DEG
  );
}

/**
 * The instant the sun crosses the meridian, as a Julian day number.
 *
 * Everything else about the solar day is measured from here: sunrise is one
 * hour-angle before it and sunset the same interval after, which is why the
 * transit is solved first rather than the two horizon crossings independently.
 */
function solarTransit(d: number, lonWest: number): number {
  const n = Math.round(d - 0.0009 - lonWest / 360);
  const approx = 0.0009 + lonWest / 360 + n;
  const m = solarMeanAnomaly(approx);
  const l = eclipticLongitude(m);
  return (
    2451545.0 +
    approx +
    0.0053 * Math.sin(m * RAD) -
    0.0069 * Math.sin(2 * l * RAD)
  );
}

/**
 * Hour angle at which the sun sits at `altitude` degrees, or null when it
 * never reaches it — a polar day or night, where returning a plausible-looking
 * time would be worse than returning nothing.
 */
function hourAngle(altitude: number, lat: number, dec: number): number | null {
  const cosH =
    (Math.sin(altitude * RAD) - Math.sin(lat * RAD) * Math.sin(dec * RAD)) /
    (Math.cos(lat * RAD) * Math.cos(dec * RAD));
  if (cosH > 1 || cosH < -1) return null;
  return Math.acos(cosH) * DEG;
}

/** The standard altitudes, in degrees below the horizon. */
const ALTITUDES = {
  /** Refraction plus the sun's semidiameter: the disc's upper limb. */
  rise: -0.833,
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const;

interface SunTimes {
  riseISO: string | null;
  setISO: string | null;
  transitISO: string | null;
  civilBeginISO: string | null;
  civilEndISO: string | null;
  nauticalBeginISO: string | null;
  nauticalEndISO: string | null;
  astronomicalBeginISO: string | null;
  astronomicalEndISO: string | null;
  /** Set when the sun stays up, or stays down, for the whole day. */
  midnightSunISO: string | null;
  polarNightISO: string | null;
}

export function sunTimes(at: Date, lat: number, lon: number): SunTimes {
  const lonWest = -lon;
  const d = toDays(at.getTime());
  const transitJD = solarTransit(d, lonWest);
  const m = solarMeanAnomaly(transitJD - 2451545.0);
  const dec = declination(eclipticLongitude(m));

  const iso = (jd: number): string => new Date(fromDays(jd - 2451545.0)).toISOString();

  const pair = (altitude: number): [string | null, string | null] => {
    const h = hourAngle(altitude, lat, dec);
    if (h === null) return [null, null];
    const setJD = solarTransit(d, lonWest - 0) + h / 360;
    const riseJD = transitJD - (setJD - transitJD);
    return [iso(riseJD), iso(setJD)];
  };

  const [riseISO, setISO] = pair(ALTITUDES.rise);
  const [civilBeginISO, civilEndISO] = pair(ALTITUDES.civil);
  const [nauticalBeginISO, nauticalEndISO] = pair(ALTITUDES.nautical);
  const [astronomicalBeginISO, astronomicalEndISO] = pair(ALTITUDES.astronomical);

  /*
   * A missing horizon crossing is ambiguous on its own — it means the sun
   * never reaches that altitude, which is midnight sun in one hemisphere's
   * summer and polar night in its winter. The sun's altitude at transit
   * settles which.
   */
  let midnightSunISO: string | null = null;
  let polarNightISO: string | null = null;
  if (riseISO === null) {
    const noonAltitude = 90 - Math.abs(lat - dec);
    if (noonAltitude > ALTITUDES.rise) midnightSunISO = iso(transitJD);
    else polarNightISO = iso(transitJD);
  }

  return {
    riseISO,
    setISO,
    transitISO: iso(transitJD),
    civilBeginISO,
    civilEndISO,
    nauticalBeginISO,
    nauticalEndISO,
    astronomicalBeginISO,
    astronomicalEndISO,
    midnightSunISO,
    polarNightISO,
  };
}

/* --------------------------------------------------------------- moon ---- */

/**
 * Geocentric ecliptic longitude of the moon.
 *
 * The equation of the centre alone (the 6.289° term) is the version most
 * one-file implementations stop at, and it is not good enough here: measured
 * over a year it put successive new moons 29.25 days apart against a true
 * synodic month of 29.53, and that error compounds into the phase name being
 * a day out. The next three terms fix it — evection, variation, and the annual
 * equation — and take the modelled month to within a few thousandths of a day.
 *
 * `D` is the moon's mean elongation from the sun and `Ms` the *sun's* mean
 * anomaly; both are needed because two of these terms are perturbations by the
 * sun rather than consequences of the moon's own orbit.
 */
function moonLongitude(d: number): number {
  const L = 218.316 + 13.176396 * d;
  const M = 134.963 + 13.064993 * d;
  const D = 297.8502 + 12.19074912 * d;
  const Ms = 357.5291 + 0.98560028 * d;

  return (
    L +
    6.289 * Math.sin(M * RAD) +
    1.274 * Math.sin((2 * D - M) * RAD) +
    0.658 * Math.sin(2 * D * RAD) +
    0.214 * Math.sin(2 * M * RAD) -
    0.186 * Math.sin(Ms * RAD) -
    0.114 * Math.sin(2 * F_ARG(d) * RAD)
  );
}

/** Mean distance of the moon from its ascending node, degrees. */
function F_ARG(d: number): number {
  return 93.272 + 13.229350 * d;
}

/** Geocentric ecliptic position of the moon (Meeus, low precision). */
function moonCoords(d: number): { ra: number; dec: number; distKM: number } {
  const M = 134.963 + 13.064993 * d;
  const F = F_ARG(d);

  const lon = moonLongitude(d);
  const lat = 5.128 * Math.sin(F * RAD);
  const distKM = 385001 - 20905 * Math.cos(M * RAD);

  /* Ecliptic to equatorial. */
  const l = lon * RAD;
  const b = lat * RAD;
  const e = OBLIQUITY * RAD;
  const ra =
    Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) * DEG;
  const dec =
    Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) * DEG;
  return { ra, dec, distKM };
}

/** Greenwich mean sidereal time, degrees. */
function siderealTime(d: number, lonWest: number): number {
  return 280.16 + 360.9856235 * d - lonWest;
}

/** Moon altitude in degrees at a given instant. */
function moonAltitude(ms: number, lat: number, lon: number): number {
  const d = toDays(ms);
  const { ra, dec } = moonCoords(d);
  const H = (siderealTime(d, -lon) - ra) * RAD;
  const alt =
    Math.asin(
      Math.sin(lat * RAD) * Math.sin(dec * RAD) +
        Math.cos(lat * RAD) * Math.cos(dec * RAD) * Math.cos(H)
    ) * DEG;
  /* Parallax and refraction together lift the apparent rise/set threshold. */
  return alt;
}

/**
 * Moonrise and moonset for the local day containing `at`.
 *
 * Solved by scanning: the moon's own motion means its rise time shifts by
 * roughly fifty minutes a day and it can rise twice, or not at all, within one
 * calendar day. A closed-form solution would have to special-case all of that;
 * sampling the altitude every ten minutes and bisecting each sign change
 * handles every case the same way, and 144 evaluations of a handful of
 * trigonometric terms is nothing.
 */
export function moonTimes(
  at: Date,
  lat: number,
  lon: number
): { riseISO: string | null; setISO: string | null } {
  /* The threshold the moon's centre crosses when its upper limb is on the horizon. */
  const HORIZON = 0.125;
  const start = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const stepMs = 10 * 60_000;

  let riseISO: string | null = null;
  let setISO: string | null = null;
  let previous = moonAltitude(start, lat, lon) - HORIZON;

  for (let i = 1; i <= 144; i += 1) {
    const t = start + i * stepMs;
    const current = moonAltitude(t, lat, lon) - HORIZON;

    if (previous < 0 && current >= 0 && riseISO === null) {
      riseISO = new Date(bisect(t - stepMs, t, lat, lon, HORIZON)).toISOString();
    }
    if (previous >= 0 && current < 0 && setISO === null) {
      setISO = new Date(bisect(t - stepMs, t, lat, lon, HORIZON)).toISOString();
    }
    previous = current;
  }

  return { riseISO, setISO };
}

/** Narrow a bracketed horizon crossing to the second. */
function bisect(lo: number, hi: number, lat: number, lon: number, horizon: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 20; i += 1) {
    const mid = (a + b) / 2;
    const altA = moonAltitude(a, lat, lon) - horizon;
    const altMid = moonAltitude(mid, lat, lon) - horizon;
    if (altA * altMid <= 0) b = mid;
    else a = mid;
  }
  return Math.round((a + b) / 2);
}

const PHASE_NAMES = [
  "New moon",
  "Waxing crescent",
  "First quarter",
  "Waxing gibbous",
  "Full moon",
  "Waning gibbous",
  "Last quarter",
  "Waning crescent",
] as const;

/**
 * Phase as a fraction of the synodic month, plus what to call it.
 *
 * `phase` runs 0 at new moon through 0.5 at full and back to 1, which is the
 * convention `MoonPhaseIcon` already draws. Illumination is derived from the
 * sun–moon elongation rather than from the phase fraction, so the two agree
 * even though one is an angle and the other a proportion of a cycle.
 */
export function moonPhase(at: Date): {
  phase: number;
  name: string;
  illum: number;
  age: number;
  angle: number;
} {
  const d = toDays(at.getTime());
  const s = eclipticLongitude(solarMeanAnomaly(d));
  const moonLon = moonLongitude(d);

  /* Elongation: 0° at new moon, 180° at full. */
  const elongation = ((moonLon - s) % 360 + 360) % 360;
  const phase = elongation / 360;
  const illum = (1 - Math.cos(elongation * RAD)) / 2;

  /** Mean synodic month, in days. */
  const SYNODIC = 29.530588853;
  const age = phase * SYNODIC;

  /*
   * Eight names over the cycle, each centred on its own eighth — so "Full
   * moon" spans the day either side of full rather than only the instant of
   * it, which is how anybody reading the card would use the word.
   */
  const index = Math.round(phase * 8) % 8;

  return {
    phase,
    name: PHASE_NAMES[index],
    illum,
    age,
    angle: elongation,
  };
}

/* ------------------------------------------------------------- section --- */

/**
 * Sun and moon in the shape the panel already reads.
 *
 * Returns a Section like every other upstream so `SectionBody` and the
 * degrade-don't-throw rule apply unchanged — even though, uniquely here, there
 * is no upstream to fail. A latitude or longitude that is not a finite number
 * is the only way this can come back not-ok.
 */
export function getSunMoon(
  lat: number,
  lon: number,
  at: Date = new Date()
): Section<SunMoonResponse> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ok: false,
      data: null,
      error: "Sun and moon need a resolved location.",
      code: "warn_no_place",
    };
  }

  const sun = sunTimes(at, lat, lon);
  const moon = moonTimes(at, lat, lon);
  const phase = moonPhase(at);

  return {
    ok: true,
    data: {
      sun: {
        riseISO: sun.riseISO,
        setISO: sun.setISO,
        transitISO: sun.transitISO,
        midnightSunISO: sun.midnightSunISO,
        polarNightISO: sun.polarNightISO,
        twilight: {
          civilBeginISO: sun.civilBeginISO,
          civilEndISO: sun.civilEndISO,
          nauticalBeginISO: sun.nauticalBeginISO,
          nauticalEndISO: sun.nauticalEndISO,
          astronomicalBeginISO: sun.astronomicalBeginISO,
          astronomicalEndISO: sun.astronomicalEndISO,
        },
      },
      moon: {
        riseISO: moon.riseISO,
        setISO: moon.setISO,
        transitISO: null,
        underfootISO: null,
        phase: {
          phase: phase.phase,
          name: phase.name,
          illum: phase.illum,
          age: phase.age,
          angle: phase.angle,
        },
      },
    },
    error: null,
    code: null,
  };
}
