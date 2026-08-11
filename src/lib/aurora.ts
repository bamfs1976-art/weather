/**
 * SERVER ONLY — AuroraWatch UK (Lancaster University).
 *
 * Geomagnetic activity measured by magnetometers in the UK, graded green /
 * yellow / amber / red. Free, no key; AuroraWatch ask for a User-Agent that
 * identifies the app and **a minimum of three minutes between requests**, which
 * the cache below enforces at ten.
 *
 * https://aurorawatch.lancs.ac.uk/api-info/
 *
 * This is a geomagnetic measurement for the UK as a whole, not a
 * location-specific forecast: it takes no coordinates, and the same status
 * applies everywhere. Swansea is far enough south that anything below amber is
 * unlikely to be visible, which is why the card says what the level means
 * rather than just showing a colour.
 */

import type { Section } from "./weather-types";
import type { AuroraLevel, AuroraStatus } from "./warning-types";

const BASE =
  process.env.AURORAWATCH_BASE ?? "https://aurorawatch-api.lancs.ac.uk/0.2/status";

/** Well above the three minutes AuroraWatch ask for. */
const TTL = 600;

/** AuroraWatch's own descriptions of each level. */
const MEANING: Record<AuroraLevel, string> = {
  green: "No significant activity. Aurora is unlikely to be visible.",
  yellow: "Minor geomagnetic activity. Aurora may be visible by camera from Scotland.",
  amber: "Amber alert — aurora is likely visible by camera from much of the UK, and by eye from Scotland.",
  red: "Red alert — aurora is likely visible by eye from anywhere in the UK, weather permitting.",
  unknown: "Status not available.",
};

function fail<T>(error: string, code: string | null = null): Section<T> {
  return { ok: false, data: null, error, code };
}

function toLevel(raw: string | null | undefined): AuroraLevel {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "green" || value === "yellow" || value === "amber" || value === "red"
    ? value
    : "unknown";
}

export async function getAuroraStatus(): Promise<Section<AuroraStatus>> {
  const url = `${BASE}/current-status.xml`;

  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: TTL },
      headers: {
        Accept: "application/xml, text/xml",
        // AuroraWatch identify callers by User-Agent rather than by key.
        "User-Agent": "swanseaweather/1.0 (+https://swanseaweather.netlify.app)",
      },
      signal: AbortSignal.timeout(6_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && /Timeout|Abort/.test(err.name);
    return fail(
      timedOut ? "AuroraWatch did not respond in time." : "Could not reach AuroraWatch.",
      timedOut ? "timeout" : "network"
    );
  }

  if (!res.ok) {
    return fail(`AuroraWatch returned HTTP ${res.status}.`, `http_${res.status}`);
  }

  const body = await res.text();
  /*
   * Read the attribute rather than an element: the status is published as
   * `<site_status status_id="green"/>`. Both spellings of the attribute are
   * accepted because the API has more than one live version and this is one
   * short request — not worth a second round trip to find out which answered.
   */
  const match = body.match(/status_id\s*=\s*"([^"]+)"/i) ?? body.match(/<status[^>]*>([^<]+)</i);
  const level = toLevel(match?.[1]);
  if (level === "unknown") {
    return fail("AuroraWatch returned a status this app did not recognise.", "bad_response");
  }

  const updated = body.match(/<updated[^>]*>\s*<datetime>([^<]+)<\/datetime>/i)
    ?? body.match(/<datetime>([^<]+)<\/datetime>/i);
  const at = updated ? Date.parse(updated[1]) : NaN;

  return {
    ok: true,
    data: {
      level,
      meaning: MEANING[level],
      alert: level === "amber" || level === "red",
      updatedISO: Number.isFinite(at) ? new Date(at).toISOString() : null,
    },
    error: null,
    code: null,
  };
}
