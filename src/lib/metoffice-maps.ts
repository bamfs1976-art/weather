/**
 * SERVER ONLY — discovery for the Met Office DataHub map-images product.
 *
 * This file deliberately does not render a map yet. The product exists, the
 * host and the auth header are known, and the free plan allows 1000 images a
 * day — but the request path is not documented anywhere reachable from this
 * machine, and inventing raster URLs is precisely the mistake that took the
 * Xweather map down under every setting for five rounds of blind fixes.
 *
 * So: ask the service. WMTS publishes a capabilities document listing every
 * layer and the exact tile URL template, which is the correct way to learn a
 * tile service rather than pattern-matching a guess. `/api/diagnostics` runs
 * this and reports what came back; the real client gets written from that
 * answer.
 *
 * https://datahub.metoffice.gov.uk/docs/f/category/map-images/type/map-images/api-documentation
 */

const HOST =
  process.env.METOFFICE_MAP_BASE_URL ?? "https://data.hub.api.metoffice.gov.uk";

export function hasMetOfficeMapKey(): boolean {
  return Boolean(process.env.METOFFICE_MAP_API_KEY ?? process.env.METOFFICE_API_KEY);
}

export interface MapDiscoveryAttempt {
  url: string;
  status: number | null;
  contentType: string | null;
  /** Layer identifiers, when the response was a capabilities document. */
  layers?: string[];
  /** The templated tile URL WMTS advertises, which is what a client needs. */
  tileTemplate?: string | null;
  /** First part of the body, so an unexpected shape is still readable. */
  sample?: string;
  error?: string;
}

/**
 * Plausible entry points, in the order most likely to be right.
 *
 * DataHub's site-specific product lives at `/sitespecific/v0/point/...`, so the
 * map product almost certainly follows `/{product}/{version}/...`. Both the
 * OGC-standard capabilities paths and a plain JSON layer listing are covered,
 * because the docs describe the service as WMTS *and* as a set of single-tile
 * overlay images, which are usually two different endpoints.
 */
function candidates(): string[] {
  const wmtsQuery = "?service=WMTS&request=GetCapabilities&version=1.0.0";
  return [
    `${HOST}/map-images/1.0.0/wmts${wmtsQuery}`,
    `${HOST}/map-images/1.0.0/WMTS/1.0.0/WMTSCapabilities.xml`,
    `${HOST}/map-images/1.0.0/layers`,
    `${HOST}/map-images/1.0.0/capabilities`,
    `${HOST}/mapimages/1.0.0/wmts${wmtsQuery}`,
    `${HOST}/map-images/v1/wmts${wmtsQuery}`,
  ];
}

/** Layer identifiers from a WMTS capabilities document, without an XML parser. */
function layersFromXml(xml: string): string[] {
  const layers: string[] = [];
  // Identifiers appear in several places; only those inside <Layer> matter.
  for (const block of xml.split(/<Layer[\s>]/).slice(1)) {
    const match = block.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/);
    if (match) layers.push(match[1].trim());
  }
  return [...new Set(layers)];
}

function templateFromXml(xml: string): string | null {
  const match = xml.match(/<ResourceURL[^>]*template="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Try each candidate and describe what answered.
 *
 * Every attempt is reported, including the failures, because "all six returned
 * 404" and "one returned 401" mean very different things — the first says the
 * path is wrong, the second says the path is right and the key is not.
 */
export async function discoverMetOfficeMaps(): Promise<{
  configured: boolean;
  found: MapDiscoveryAttempt | null;
  attempts: MapDiscoveryAttempt[];
}> {
  const key = process.env.METOFFICE_MAP_API_KEY ?? process.env.METOFFICE_API_KEY;
  if (!key) {
    return { configured: false, found: null, attempts: [] };
  }

  const attempts: MapDiscoveryAttempt[] = [];
  let found: MapDiscoveryAttempt | null = null;

  for (const url of candidates()) {
    if (found) break;
    try {
      const res = await fetch(url, {
        headers: { apikey: key, accept: "application/xml, application/json;q=0.9, */*;q=0.8" },
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      const contentType = res.headers.get("content-type");
      const body = (await res.text()).slice(0, 4_000);
      const attempt: MapDiscoveryAttempt = {
        url: url.replace(key, "***"),
        status: res.status,
        contentType,
        sample: body.slice(0, 300),
      };

      if (res.ok) {
        if (/xml/i.test(contentType ?? "") || body.trimStart().startsWith("<")) {
          attempt.layers = layersFromXml(body);
          attempt.tileTemplate = templateFromXml(body);
        } else {
          try {
            const parsed = JSON.parse(body) as unknown;
            attempt.layers = Array.isArray(parsed)
              ? parsed.map((entry) => String((entry as { name?: string })?.name ?? entry)).slice(0, 40)
              : Object.keys(parsed as Record<string, unknown>).slice(0, 40);
          } catch {
            /* not JSON either — the sample above is what there is to go on */
          }
        }
        found = attempt;
      }
      attempts.push(attempt);
    } catch (err) {
      attempts.push({
        url,
        status: null,
        contentType: null,
        error: err instanceof Error ? err.name : "fetch failed",
      });
    }
  }

  return { configured: true, found, attempts };
}
