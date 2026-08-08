/**
 * Server-side clients for the non-weather local data sources.
 *
 * SERVER ONLY — reads FOOTBALL_DATA_TOKEN.
 *
 *  - National Grid ESO Carbon Intensity API. No key, no registration.
 *    https://carbon-intensity.github.io/api-definitions/
 *  - data.police.uk. No key, no registration. Covers England and Wales, so
 *    South Wales Police is included.
 *    https://data.police.uk/docs/
 *  - football-data.org. Free tier needs an X-Auth-Token header.
 *    https://www.football-data.org/documentation/quickstart
 *
 * Everything returns Section<T>, so a missing token or a dead upstream shows a
 * notice on its own card instead of breaking the page.
 */

import type { Section } from "./weather-types";
import type {
  CarbonIntensity,
  CarbonPeriod,
  CrimeSummary,
  Fixture,
  GenerationFuel,
  TeamForm,
} from "./local-types";

const CARBON_BASE = "https://api.carbonintensity.org.uk";
const POLICE_BASE = "https://data.police.uk/api";
const FOOTBALL_BASE = "https://api.football-data.org/v4";

const TTL = {
  carbon: 1_800,
  crime: 86_400,
  football: 3_600,
} as const;

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function succeed<T>(data: T): Section<T> {
  return { ok: true, data, error: null, code: null };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
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
  keyed = false
): Promise<Section<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json", ...headers },
      // Cap each upstream so one slow service can't run the serverless
      // function out of time and take the whole payload down with it.
      signal: AbortSignal.timeout(8_000),
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
        keyed
          ? "The service rejected the API token for this data set."
          : `The service refused the request (HTTP ${res.status}). This feed needs no key, so a network policy is the likely cause.`,
        "unauthorised"
      );
    }
    if (res.status === 429) {
      return fail<T>("Rate limit reached — try again shortly.", "rate_limited");
    }
    if (res.status === 404) {
      return fail<T>("Nothing published for this location.", "warn_no_data");
    }
    return fail<T>(`Upstream returned HTTP ${res.status}.`, `http_${res.status}`);
  }

  try {
    return succeed((await res.json()) as T);
  } catch {
    return fail<T>("Upstream returned a response that was not JSON.", "bad_response");
  }
}

/* ------------------------------------------------------------------ */
/* Carbon intensity                                                    */
/* ------------------------------------------------------------------ */

interface RawCarbonPeriod {
  from?: string;
  to?: string;
  intensity?: { forecast?: number; actual?: number | null; index?: string };
  generationmix?: { fuel?: string; perc?: number }[];
}

interface RawRegional {
  data?: {
    regionid?: number;
    dnoregion?: string;
    shortname?: string;
    postcode?: string;
    data?: RawCarbonPeriod[];
  }[];
}

function mapPeriod(raw: RawCarbonPeriod): CarbonPeriod | null {
  const from = str(raw.from);
  const to = str(raw.to);
  if (!from || !to) return null;
  return {
    fromISO: from,
    toISO: to,
    forecast: num(raw.intensity?.forecast),
    actual: num(raw.intensity?.actual),
    index: str(raw.intensity?.index),
  };
}

/**
 * Grid carbon intensity for the region containing a postcode outcode, plus the
 * next 24 hours so the UI can point at the cleanest slot to run something.
 *
 * The API is keyed on the outward code only ("SA6", not "SA6 6NL").
 */
export async function getCarbonIntensity(
  outcode: string
): Promise<Section<CarbonIntensity>> {
  const clean = outcode.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(clean)) {
    return fail<CarbonIntensity>(
      `"${outcode}" is not a UK postcode outward code (e.g. SA6).`,
      "invalid_location"
    );
  }

  const section = await getJSON<RawRegional>(
    `${CARBON_BASE}/regional/postcode/${encodeURIComponent(clean)}/fw24h`,
    TTL.carbon
  );

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const region = section.data.data?.[0];
  const periods = (region?.data ?? [])
    .map(mapPeriod)
    .filter((p): p is CarbonPeriod => p !== null);

  if (periods.length === 0) {
    return fail<CarbonIntensity>(
      "No carbon intensity published for this region.",
      "warn_no_data"
    );
  }

  const mixSource = region?.data?.[0]?.generationmix ?? [];
  const generationMix: GenerationFuel[] = mixSource
    .map((entry) => ({
      fuel: str(entry.fuel) ?? "unknown",
      percent: num(entry.perc) ?? 0,
    }))
    .filter((entry) => entry.percent > 0)
    .sort((a, b) => b.percent - a.percent);

  const withForecast = periods.filter((p) => p.forecast !== null);
  const greenest =
    withForecast.length > 0
      ? withForecast.reduce((best, p) =>
          (p.forecast ?? Infinity) < (best.forecast ?? Infinity) ? p : best
        )
      : null;
  const dirtiest =
    withForecast.length > 0
      ? withForecast.reduce((worst, p) =>
          (p.forecast ?? -Infinity) > (worst.forecast ?? -Infinity) ? p : worst
        )
      : null;

  return succeed({
    regionName: str(region?.shortname),
    dnoRegion: str(region?.dnoregion),
    postcode: str(region?.postcode) ?? clean,
    current: periods[0],
    forecast: periods,
    generationMix,
    greenest,
    dirtiest,
  });
}


/* ------------------------------------------------------------------ */
/* Postcode lookup (postcodes.io — free, no key, UK only)              */
/* ------------------------------------------------------------------ */

const POSTCODES_BASE = "https://api.postcodes.io";

/**
 * Nearest UK postcode to a point, so the carbon API (which is keyed on the
 * outward code) can be queried from coordinates. Returns null outside the UK.
 */
export async function getOutcode(
  lat: number,
  lon: number
): Promise<{ outcode: string; postcode: string; admin: string | null } | null> {
  const section = await getJSON<{
    result?: { postcode?: string; outcode?: string; admin_district?: string }[] | null;
  }>(
    `${POSTCODES_BASE}/postcodes?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&limit=1&radius=20000`,
    TTL.crime
  );

  if (!section.ok || !section.data?.result?.length) return null;
  const hit = section.data.result[0];
  const postcode = str(hit.postcode);
  if (!postcode) return null;
  return {
    postcode,
    outcode: str(hit.outcode) ?? postcode.split(/\s+/)[0],
    admin: str(hit.admin_district),
  };
}

/**
 * Carbon intensity for a point: resolve the postcode, then ask for that
 * region. Falls back to the national figure when the point is outside the UK
 * or no postcode is nearby.
 */
export async function getCarbonForPoint(
  lat: number,
  lon: number
): Promise<Section<CarbonIntensity>> {
  const place = await getOutcode(lat, lon);
  if (place) {
    const regional = await getCarbonIntensity(place.outcode);
    if (regional.ok) return regional;
  }

  const national = await getJSON<{ data?: RawCarbonPeriod[] }>(
    `${CARBON_BASE}/intensity`,
    TTL.carbon
  );
  if (!national.ok || !national.data) {
    return {
      ok: false,
      data: null,
      error:
        national.error ??
        "No carbon intensity available for this location (the grid API covers Great Britain only).",
      code: national.code,
    };
  }

  const current = (national.data.data ?? []).map(mapPeriod).find(Boolean) ?? null;
  if (!current) {
    return fail<CarbonIntensity>("No carbon intensity published.", "warn_no_data");
  }

  const mix = await getJSON<{ data?: { generationmix?: { fuel?: string; perc?: number }[] } }>(
    `${CARBON_BASE}/generation`,
    TTL.carbon
  );

  return succeed({
    regionName: "Great Britain (national)",
    dnoRegion: null,
    postcode: null,
    current,
    forecast: [current],
    generationMix: mix.ok
      ? (mix.data?.data?.generationmix ?? [])
          .map((entry) => ({
            fuel: str(entry.fuel) ?? "unknown",
            percent: num(entry.perc) ?? 0,
          }))
          .filter((entry) => entry.percent > 0)
          .sort((a, b) => b.percent - a.percent)
      : [],
    greenest: null,
    dirtiest: null,
  });
}

/* ------------------------------------------------------------------ */
/* Crime                                                               */
/* ------------------------------------------------------------------ */

interface RawCrime {
  category?: string;
  month?: string;
  location?: { street?: { name?: string } };
}

const CRIME_LABELS: Record<string, string> = {
  "anti-social-behaviour": "Anti-social behaviour",
  "bicycle-theft": "Bicycle theft",
  burglary: "Burglary",
  "criminal-damage-arson": "Criminal damage & arson",
  drugs: "Drugs",
  "other-theft": "Other theft",
  "possession-of-weapons": "Possession of weapons",
  "public-order": "Public order",
  robbery: "Robbery",
  shoplifting: "Shoplifting",
  "theft-from-the-person": "Theft from the person",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violence & sexual offences",
  "other-crime": "Other crime",
};

function crimeLabel(category: string): string {
  return (
    CRIME_LABELS[category] ??
    category.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * Street-level crime for the most recent published month.
 *
 * The API's street-level query covers a one-mile radius around the point, and
 * publication lags real time by roughly two months — so the month is asked for
 * rather than assumed.
 */
export async function getCrimeSummary(
  lat: number,
  lon: number
): Promise<Section<CrimeSummary>> {
  const latest = await getJSON<{ date?: string }>(
    `${POLICE_BASE}/crime-last-updated`,
    TTL.crime
  );
  // "2026-06-01" -> "2026-06". If unavailable, let the API pick its default.
  const month = latest.ok ? str(latest.data?.date)?.slice(0, 7) ?? null : null;

  const query = new URLSearchParams({
    lat: lat.toFixed(5),
    lng: lon.toFixed(5),
  });
  if (month) query.set("date", month);

  const section = await getJSON<RawCrime[]>(
    `${POLICE_BASE}/crimes-street/all-crime?${query.toString()}`,
    TTL.crime
  );

  if (!section.ok || !section.data) {
    return { ok: false, data: null, error: section.error, code: section.code };
  }

  const crimes = Array.isArray(section.data) ? section.data : [];
  if (crimes.length === 0) {
    return fail<CrimeSummary>(
      "No street-level crime published for this area in the latest month.",
      "warn_no_data"
    );
  }

  const byCategory = new Map<string, number>();
  const byStreet = new Map<string, number>();
  for (const crime of crimes) {
    const category = str(crime.category) ?? "other-crime";
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    const street = str(crime.location?.street?.name);
    if (street) byStreet.set(street, (byStreet.get(street) ?? 0) + 1);
  }

  const neighbourhoodSection = await getJSON<{
    force?: string;
    neighbourhood?: string;
  }>(
    `${POLICE_BASE}/locate-neighbourhood?q=${lat.toFixed(5)},${lon.toFixed(5)}`,
    TTL.crime
  );

  let neighbourhood: CrimeSummary["neighbourhood"] = null;
  if (
    neighbourhoodSection.ok &&
    neighbourhoodSection.data?.force &&
    neighbourhoodSection.data?.neighbourhood
  ) {
    const force = neighbourhoodSection.data.force;
    const id = neighbourhoodSection.data.neighbourhood;
    const detail = await getJSON<{ name?: string }>(
      `${POLICE_BASE}/${encodeURIComponent(force)}/${encodeURIComponent(id)}`,
      TTL.crime
    );
    neighbourhood = {
      force,
      id,
      name: (detail.ok ? str(detail.data?.name) : null) ?? id,
    };
  }

  return succeed({
    month: month ?? str(crimes[0]?.month) ?? "latest",
    total: crimes.length,
    categories: [...byCategory.entries()]
      .map(([category, count]) => ({
        category,
        label: crimeLabel(category),
        count,
      }))
      .sort((a, b) => b.count - a.count),
    topStreets: [...byStreet.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    neighbourhood,
    radiusMiles: 1,
  });
}

/* ------------------------------------------------------------------ */
/* Football                                                            */
/* ------------------------------------------------------------------ */

export function hasFootballToken(): boolean {
  return Boolean(process.env.FOOTBALL_DATA_TOKEN);
}

interface RawMatch {
  id?: number;
  utcDate?: string;
  status?: string;
  matchday?: number;
  competition?: { name?: string };
  homeTeam?: { id?: number; name?: string; shortName?: string };
  awayTeam?: { id?: number; name?: string; shortName?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
}

interface RawTeam {
  id?: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

interface RawStandingsRow {
  position?: number;
  team?: { id?: number };
  playedGames?: number;
  won?: number;
  draw?: number;
  lost?: number;
  points?: number;
  goalDifference?: number;
}

function mapMatch(raw: RawMatch, teamId: number): Fixture | null {
  const utc = str(raw.utcDate);
  if (!utc) return null;
  return {
    id: num(raw.id) ?? 0,
    competition: str(raw.competition?.name) ?? "",
    homeTeam: str(raw.homeTeam?.shortName) ?? str(raw.homeTeam?.name) ?? "",
    awayTeam: str(raw.awayTeam?.shortName) ?? str(raw.awayTeam?.name) ?? "",
    utcDateISO: utc,
    status: str(raw.status) ?? "",
    matchday: num(raw.matchday),
    homeGoals: num(raw.score?.fullTime?.home),
    awayGoals: num(raw.score?.fullTime?.away),
    venueIsHome: num(raw.homeTeam?.id) === teamId,
  };
}

/**
 * Fixtures, results and league position for a club.
 *
 * The club is found by name inside a free-tier competition rather than by a
 * hard-coded id, so promotion or relegation doesn't silently break the card —
 * set FOOTBALL_COMPETITION if the club moves division.
 */
export async function getTeamForm(
  teamQuery = "Swansea",
  competitionCode = process.env.FOOTBALL_COMPETITION ?? "ELC"
): Promise<Section<TeamForm>> {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    return fail<TeamForm>(
      "Fixtures need a FOOTBALL_DATA_TOKEN. The free tier is at https://www.football-data.org/client/register.",
      "no_credentials"
    );
  }

  const headers = { "X-Auth-Token": token };

  const teamsSection = await getJSON<{ teams?: RawTeam[] }>(
    `${FOOTBALL_BASE}/competitions/${encodeURIComponent(competitionCode)}/teams`,
    TTL.football,
    headers,
    true
  );
  if (!teamsSection.ok || !teamsSection.data) {
    return { ok: false, data: null, error: teamsSection.error, code: teamsSection.code };
  }

  const needle = teamQuery.toLowerCase();
  const team = (teamsSection.data.teams ?? []).find((candidate) =>
    [candidate.name, candidate.shortName, candidate.tla]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  );

  if (!team || typeof team.id !== "number") {
    return fail<TeamForm>(
      `No club matching "${teamQuery}" in competition ${competitionCode}. If they have changed division, set FOOTBALL_COMPETITION to the right code.`,
      "warn_no_data"
    );
  }

  const teamId = team.id;

  const [scheduled, finished, standings] = await Promise.all([
    getJSON<{ matches?: RawMatch[] }>(
      `${FOOTBALL_BASE}/teams/${teamId}/matches?status=SCHEDULED&limit=5`,
      TTL.football,
      headers,
      true
    ),
    getJSON<{ matches?: RawMatch[] }>(
      `${FOOTBALL_BASE}/teams/${teamId}/matches?status=FINISHED&limit=5`,
      TTL.football,
      headers,
      true
    ),
    getJSON<{ standings?: { type?: string; table?: RawStandingsRow[] }[] }>(
      `${FOOTBALL_BASE}/competitions/${encodeURIComponent(competitionCode)}/standings`,
      TTL.football,
      headers,
      true
    ),
  ]);

  const row = standings.ok
    ? (standings.data?.standings ?? [])
        .find((entry) => (entry.type ?? "TOTAL") === "TOTAL")
        ?.table?.find((entry) => num(entry.team?.id) === teamId)
    : undefined;

  const next = (scheduled.ok ? scheduled.data?.matches ?? [] : [])
    .map((match) => mapMatch(match, teamId))
    .filter((match): match is Fixture => match !== null);

  const recent = (finished.ok ? finished.data?.matches ?? [] : [])
    .map((match) => mapMatch(match, teamId))
    .filter((match): match is Fixture => match !== null)
    .sort((a, b) => b.utcDateISO.localeCompare(a.utcDateISO));

  return succeed({
    teamName: str(team.name) ?? teamQuery,
    crestUrl: str(team.crest),
    competition: competitionCode,
    position: num(row?.position),
    playedGames: num(row?.playedGames),
    points: num(row?.points),
    won: num(row?.won),
    draw: num(row?.draw),
    lost: num(row?.lost),
    goalDifference: num(row?.goalDifference),
    next,
    recent,
  });
}
