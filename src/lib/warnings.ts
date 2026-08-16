/**
 * SERVER ONLY — Met Office National Severe Weather Warning Service.
 *
 * The gap this fills: Xweather's `alerts` endpoint answers for UK coordinates
 * but its alert network is NWS-derived, and UK warnings come from NSWWS, which
 * is a different system. A query for Swansea returned zero records — one sample
 * that may simply mean "nothing in force", but the Met Office is the
 * authoritative publisher for the UK either way.
 *
 * **This is a public cache endpoint, not a documented API.** The supported
 * route is the NSWWS product on DataHub, which needs registration. This feed is
 * what Home Assistant's feedreader and MMM-UKMOWeatherWarnings both read, so it
 * is well-trodden, but it could change shape without notice. That is survivable
 * here: the parser is tolerant, and a dead feed blanks one card rather than the
 * page. If it ever goes for good, the DataHub product is the replacement.
 *
 * https://www.metoffice.gov.uk/weather/guides/warnings
 */

import type { Section } from "./weather-types";
import type { WarningLevel, WeatherWarning } from "./warning-types";

const BASE =
  process.env.METOFFICE_WARNINGS_BASE ??
  "https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region";

/*
 * MeteoAlarm carries the same Met Office warnings as CAP inside an Atom feed.
 *
 * It is preferred over the RSS above because CAP publishes severity, urgency,
 * certainty, onset and expiry as *fields*. The RSS has none of that: the level
 * is parsed out of the title, which is why this file has a `levelFrom()` regex
 * and a caveat about the feed changing shape without notice. The Met Office
 * publishes to MeteoAlarm as a EUMETNET member, so this is the same authority
 * through a machine-readable door.
 *
 * The RSS stays as the fallback. It is regional where this feed is national, so
 * when MeteoAlarm answers its entries are filtered to the region by areaDesc.
 * https://feeds.meteoalarm.org/
 */
/*
 * An ordered candidate list, first that answers wins — the same reasoning as
 * `MODELS` and `ENSEMBLES`. Production reported the single hard-coded URL as
 * unreachable, and from a build environment that cannot reach MeteoAlarm there
 * is no way to tell a renamed feed from a blocked one by inspection. Guessing a
 * replacement outright would just swap one unverified URL for another; trying
 * the documented shapes in order costs one extra request on the failing path
 * and makes the answer show up in diagnostics, which is where the last four
 * upstream mysteries were actually settled.
 *
 * Delete any entry that is permanently reported as `http-404`; keep whichever
 * one answers. METEOALARM_BASE overrides the list entirely, for tests.
 */
const METEOALARM_FEEDS: string[] = process.env.METEOALARM_BASE
  ? // Comma-separated, so the fall-through itself is testable rather than only
    // the single-URL case. Blank entries are dropped rather than fetched.
    process.env.METEOALARM_BASE.split(",").map((u) => u.trim()).filter(Boolean)
  : [
      "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-united-kingdom",
      "https://feeds.meteoalarm.org/api/v1/warnings/feeds-united-kingdom",
      "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-rss-united-kingdom",
    ];

/** Warnings change slowly and are issued hours ahead; ten minutes is plenty. */
const TTL = 600;

/**
 * Met Office warning regions, as coarse bounding boxes.
 *
 * The feed is per-region, so a location has to be mapped to one. These boxes
 * are deliberately rough — they only have to pick the right feed, and every
 * region's warnings are national-scale weather rather than street-level. A
 * point that matches nothing falls back to the UK-wide feed, which is a
 * superset, so the failure mode is "too many warnings" rather than "none".
 */
const REGIONS: { id: string; name: string; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
  { id: "wl", name: "Wales", minLat: 51.3, maxLat: 53.5, minLon: -5.4, maxLon: -2.6 },
  { id: "sw", name: "South West England", minLat: 49.8, maxLat: 52.1, minLon: -6.5, maxLon: -1.6 },
  { id: "se", name: "South East England", minLat: 50.5, maxLat: 52.2, minLon: -1.8, maxLon: 1.9 },
  { id: "wm", name: "West Midlands", minLat: 51.9, maxLat: 53.2, minLon: -3.2, maxLon: -1.2 },
  { id: "em", name: "East Midlands", minLat: 52.3, maxLat: 53.7, minLon: -1.9, maxLon: 0.6 },
  { id: "ee", name: "East of England", minLat: 51.5, maxLat: 53.1, minLon: -0.8, maxLon: 1.8 },
  { id: "nw", name: "North West England", minLat: 52.9, maxLat: 55.2, minLon: -3.7, maxLon: -1.9 },
  { id: "ne", name: "North East England", minLat: 54.0, maxLat: 55.9, minLon: -2.7, maxLon: -0.6 },
  { id: "yh", name: "Yorkshire & Humber", minLat: 53.2, maxLat: 54.6, minLon: -2.6, maxLon: 0.3 },
  { id: "ni", name: "Northern Ireland", minLat: 54.0, maxLat: 55.4, minLon: -8.3, maxLon: -5.3 },
  { id: "st", name: "Central, Tayside & Fife", minLat: 55.8, maxLat: 57.0, minLon: -5.2, maxLon: -2.4 },
  { id: "gr", name: "Grampian", minLat: 56.6, maxLat: 58.0, minLon: -4.2, maxLon: -1.7 },
  { id: "hi", name: "Highlands & Islands", minLat: 56.4, maxLat: 61.0, minLon: -8.7, maxLon: -0.7 },
  { id: "sw-scot", name: "SW Scotland, Lothian & Borders", minLat: 54.6, maxLat: 56.3, minLon: -5.4, maxLon: -1.9 },
];

export function regionFor(lat: number, lon: number): { id: string; name: string } {
  const hit = REGIONS.find(
    (r) => lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon
  );
  return hit ? { id: hit.id, name: hit.name } : { id: "UK", name: "United Kingdom" };
}

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

/** Strip tags and decode the handful of entities RSS actually uses. */
function text(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? text(match[1]) : null;
}

/**
 * The level is carried in the title — "Yellow warning of rain affecting Wales".
 * There is no machine-readable severity field on this feed, which is one of the
 * reasons it is a cache rather than an API.
 */
function levelFrom(title: string): WarningLevel {
  const lower = title.toLowerCase();
  if (lower.includes("red warning")) return "red";
  if (lower.includes("amber warning")) return "amber";
  if (lower.includes("yellow warning")) return "yellow";
  return "unknown";
}

/** "Yellow warning of rain affecting Wales" -> "rain". */
function hazardFrom(title: string): string | null {
  const match = title.match(/warning of ([^,]+?)(?: affecting| for |$)/i);
  if (match) return match[1].trim();
  // CAP events are already the hazard ("Rain", "Wind", "Snow-Ice").
  const known = title.match(/\b(rain|wind|snow|ice|fog|thunder\w*|heat|cold|flood)\b/i);
  return known ? known[1].toLowerCase() : null;
}

/**
 * The feed puts validity in the description as free text, e.g.
 * "valid from 1500 Mon 11 Aug to 2100 Mon 11 Aug". It is shown as published
 * rather than parsed into timestamps: a mis-parsed warning window is worse than
 * no window, and the string is already human-readable.
 */
function validityFrom(description: string): string | null {
  const match = description.match(/valid from[^.]*/i);
  return match ? match[0].trim() : null;
}

/** CAP severity is a controlled vocabulary, which is the entire point of it. */
function levelFromCap(severity: string | null, event: string | null): WarningLevel {
  switch ((severity ?? "").trim().toLowerCase()) {
    case "extreme":
    case "severe":
      return "red";
    case "moderate":
      return "amber";
    case "minor":
      return "yellow";
    default:
      // Some producers put the colour in the event text instead.
      return levelFrom(event ?? "");
  }
}

/**
 * MeteoAlarm's UK Atom feed, filtered to the region.
 *
 * Returns null rather than an error Section: this is an upgrade over the RSS,
 * not a replacement, so anything unexpected falls through to the feed that was
 * already working instead of blanking the banner.
 */
/**
 * Why the CAP feed did or did not supply the warnings.
 *
 * An empty feed and a broken one both used to come back as `null`, which made
 * them indistinguishable in the diagnostics report — "via: nswws-rss" could
 * mean MeteoAlarm had nothing to say on a quiet day, or that the URL was wrong
 * and had never once worked. Only the second is a fault, so the reason is
 * carried out rather than discarded.
 */
export type CapReason =
  | "ok"
  /** The request completed and the feed said no: `http-404`, `http-403`, … */
  | `http-${number}`
  /** DNS, TLS, connection refused, or an egress policy. */
  | "network"
  | "timeout"
  | "not-xml"
  | "no-entries"
  | "none-for-region";

/** Fetch one candidate feed. Returns the body, or why it could not be used. */
async function fetchCapFeed(
  url: string
): Promise<{ body: string; reason: CapReason } | { body: null; reason: CapReason }> {
  try {
    const res = await fetch(url, {
      next: { revalidate: TTL },
      headers: {
        /*
         * Accept anything, because a narrow Accept list is what was actually
         * wrong. Production reported `http-406` — Not Acceptable — which says
         * the URL exists and egress works, and that the server could not
         * produce any of `application/atom+xml, application/xml, text/xml`.
         * Content negotiation was rejecting us, not the address. The body is
         * sniffed for feed markup below either way, so accepting anything
         * costs nothing: a wrong content type still fails as `not-xml`.
         */
        Accept: "*/*",
        "User-Agent": "swanseaweather/1.0 (+https://swanseaweather.netlify.app)",
      },
      signal: AbortSignal.timeout(6_000),
    });
    /*
     * A refusal and a wrong address are different problems and only one of
     * them is fixable by changing the URL, so the status is carried out rather
     * than flattened. Production reported `unreachable`, which was true and
     * useless — it could equally have been a 404 from a renamed feed or an
     * egress policy on the host, and those call for opposite responses.
     */
    if (!res.ok) return { body: null, reason: `http-${res.status}` as CapReason };
    const body = await res.text();
    /* CAP entries may arrive as Atom <entry> or as RSS <item>. */
    if (!/<feed|<entry|<item/i.test(body)) return { body: null, reason: "not-xml" };
    return { body, reason: "ok" };
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { body: null, reason: timedOut ? "timeout" : "network" };
  }
}

async function fromMeteoAlarm(
  region: { id: string; name: string }
): Promise<{ warnings: WeatherWarning[] | null; reason: CapReason; feed: string | null }> {
  let body: string | null = null;
  let feed: string | null = null;
  /*
   * Every candidate's outcome, not just the last one's. The first version
   * overwrote `reason` each pass, so production reported `http-406` and there
   * was no way to know whether the other two feeds had said the same thing or
   * something completely different — the identical mistake this whole field
   * exists to stop, made one level further in.
   */
  const attempts: { url: string; reason: CapReason }[] = [];

  for (const url of METEOALARM_FEEDS) {
    const attempt = await fetchCapFeed(url);
    attempts.push({ url, reason: attempt.reason });
    if (attempt.body !== null) {
      body = attempt.body;
      feed = url;
      break;
    }
  }
  if (body === null) {
    return {
      warnings: null,
      // Every candidate failed, so name each one: "http-406; http-404; network".
      reason: (attempts.map((a) => a.reason).join("; ") || "network") as CapReason,
      feed: null,
    };
  }

  const entries = body.split(/<entry[\s>]|<item[\s>]/i).slice(1);
  const out: WeatherWarning[] = [];
  for (const raw of entries) {
    /*
     * The national feed covers every UK region, so entries are matched against
     * the region this location maps to. An entry naming no area at all is kept:
     * a UK-wide warning applies here too, and dropping it would be the one
     * failure mode this card must not have.
     */
    const area = tag(raw, "cap:areaDesc") ?? tag(raw, "areaDesc");
    if (area && !new RegExp(region.name.split(/[ &,]+/)[0], "i").test(area)) continue;

    const event = tag(raw, "cap:event") ?? tag(raw, "event") ?? tag(raw, "title");
    if (!event) continue;
    const severity = tag(raw, "cap:severity") ?? tag(raw, "severity");
    const onset = tag(raw, "cap:onset") ?? tag(raw, "onset");
    const expires = tag(raw, "cap:expires") ?? tag(raw, "expires");

    const window =
      onset && expires
        ? `Valid from ${onset.replace("T", " ").slice(0, 16)} to ${expires
            .replace("T", " ")
            .slice(0, 16)}`
        : null;

    out.push({
      id: tag(raw, "id") ?? `${event}-${onset ?? ""}`,
      level: levelFromCap(severity, event),
      hazard: hazardFrom(event) ?? event,
      title: area ? `${event} affecting ${area}` : event,
      description:
        tag(raw, "cap:description") ?? tag(raw, "description") ?? tag(raw, "summary"),
      validity: window,
      issuedISO: (() => {
        const sent = tag(raw, "cap:sent") ?? tag(raw, "updated") ?? tag(raw, "published");
        const at = sent ? Date.parse(sent) : NaN;
        return Number.isFinite(at) ? new Date(at).toISOString() : null;
      })(),
      link: tag(raw, "link") ?? "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings",
    });
  }

  if (out.length > 0) return { warnings: out, reason: "ok", feed };
  // A feed that parsed but held nothing for here is working, just quiet.
  return {
    warnings: null,
    reason: entries.length === 0 ? "no-entries" : "none-for-region",
    feed,
  };
}

export async function getWeatherWarnings(
  lat: number,
  lon: number
): Promise<
  Section<{
    region: string;
    regionId: string;
    via: string;
    /** Why CAP did or did not answer — see CapReason. Reported by diagnostics. */
    capReason: CapReason;
    /** Which candidate feed answered, so a working URL can be kept. */
    capFeed: string | null;
    warnings: WeatherWarning[];
  }>
> {
  const region = regionFor(lat, lon);

  /*
   * CAP first. Only if it gives nothing usable does the title-parsing RSS run,
   * so the structured source is the one normally in play and the scraped one is
   * genuinely a fallback rather than the default.
   */
  const cap = await fromMeteoAlarm(region);
  if (cap.warnings) {
    const RANK: Record<WarningLevel, number> = { red: 0, amber: 1, yellow: 2, unknown: 3 };
    cap.warnings.sort((a, b) => RANK[a.level] - RANK[b.level]);
    return {
      ok: true,
      data: {
        region: region.name,
        regionId: region.id,
        via: "meteoalarm-cap",
        capReason: cap.reason,
        capFeed: cap.feed,
        warnings: cap.warnings,
      },
      error: null,
      code: null,
    };
  }

  const url = `${BASE}/${encodeURIComponent(region.id)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: TTL },
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "swanseaweather/1.0 (+https://swanseaweather.netlify.app)",
      },
      signal: AbortSignal.timeout(6_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && /Timeout|Abort/.test(err.name);
    return fail(
      timedOut
        ? "The Met Office warnings feed did not respond in time."
        : "Could not reach the Met Office warnings feed.",
      timedOut ? "timeout" : "network"
    );
  }

  if (!res.ok) {
    return fail(`The warnings feed returned HTTP ${res.status}.`, `http_${res.status}`);
  }

  const body = await res.text();
  if (!/<rss|<feed|<channel/i.test(body)) {
    return fail("The warnings feed did not return RSS.", "bad_response");
  }

  const items = body.split(/<item[\s>]/i).slice(1);
  const warnings: WeatherWarning[] = [];

  for (const raw of items) {
    const title = tag(raw, "title");
    if (!title) continue;
    /*
     * When nothing is in force the feed still returns an item saying so, rather
     * than an empty channel. Treating that as a warning would put a permanent
     * banner on the page.
     */
    if (/there are currently no severe weather warnings|no warnings/i.test(title)) continue;

    const description = tag(raw, "description") ?? "";
    warnings.push({
      id: tag(raw, "guid") ?? tag(raw, "link") ?? title,
      level: levelFrom(title),
      hazard: hazardFrom(title),
      title,
      description: description || null,
      validity: validityFrom(description),
      issuedISO: (() => {
        const published = tag(raw, "pubDate");
        if (!published) return null;
        const at = Date.parse(published);
        return Number.isFinite(at) ? new Date(at).toISOString() : null;
      })(),
      link: tag(raw, "link"),
    });
  }

  const RANK: Record<WarningLevel, number> = { red: 0, amber: 1, yellow: 2, unknown: 3 };
  warnings.sort((a, b) => RANK[a.level] - RANK[b.level]);

  return {
    ok: true,
    data: {
      region: region.name,
      regionId: region.id,
      via: "nswws-rss",
      capReason: cap.reason,
      capFeed: cap.feed,
      warnings,
    },
    error: null,
    code: null,
  };
}
