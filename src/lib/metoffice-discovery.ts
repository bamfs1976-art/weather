/**
 * SERVER ONLY — endpoint discovery for Met Office DataHub products.
 *
 * Four DataHub products are now subscribed, each with its own key: the
 * site-specific forecast (already integrated in lib/metoffice.ts), map images,
 * land observations, and atmospheric models. Only the first has a request path
 * this machine could establish; the rest are documented behind pages the build
 * environment cannot reach.
 *
 * This module does not integrate anything. It asks each service where it lives
 * and reports the answer through /api/diagnostics, so the clients get written
 * from a capabilities document rather than from a plausible-looking guess.
 * That distinction is not pedantry: guessing raster URLs took the Xweather map
 * down under every setting for five rounds, and the same failure here would be
 * harder to spot because a wrong path and an unsubscribed product both look
 * like "no data".
 *
 * Probing costs real quota — land observations allows 360 calls a day — so each
 * product stops at its first success and diagnostics is the only caller.
 */

const HOST =
  process.env.METOFFICE_MAP_BASE_URL ?? "https://data.hub.api.metoffice.gov.uk";

const WMTS = "?service=WMTS&request=GetCapabilities&version=1.0.0";

interface Product {
  id: string;
  label: string;
  keyEnv: string;
  /** What the product is for, and whether it is worth integrating. */
  note: string;
  paths: string[];
}

/**
 * Candidate entry points per product, most likely first.
 *
 * DataHub's one known path is `/sitespecific/v0/point/hourly`, so the shape is
 * `/{product}/{version}/{resource}`. Atmospheric models are ordered rather than
 * queried — you define an order in the portal and then collect its files — so
 * its candidates look for an order listing instead of a data endpoint.
 */
const PRODUCTS: Product[] = [
  {
    id: "map-images",
    label: "Map images",
    keyEnv: "METOFFICE_MAP_API_KEY",
    note: "UK radar and model rasters. Worth integrating — the Met Office radar over Wales is finer than the global mosaic currently shown.",
    paths: [
      `${HOST}/map-images/1.0.0/wmts${WMTS}`,
      `${HOST}/map-images/1.0.0/WMTS/1.0.0/WMTSCapabilities.xml`,
      `${HOST}/map-images/1.0.0/layers`,
      `${HOST}/map-images/1.0.0/capabilities`,
      `${HOST}/mapimages/1.0.0/wmts${WMTS}`,
      `${HOST}/map-images/v1/wmts${WMTS}`,
    ],
  },
  {
    id: "observations",
    label: "Land observations",
    keyEnv: "METOFFICE_OBS_API_KEY",
    note: "Hourly readings from ~150 UK stations. Worth integrating — these are measurements, so they can be shown against the interpolated conditions rather than as another forecast.",
    paths: [
      `${HOST}/observations/1.0.0/sites`,
      `${HOST}/observations/1.0.0/capabilities`,
      `${HOST}/land-observations/1.0.0/sites`,
      `${HOST}/observations/v1/sites`,
      `${HOST}/observations/1.0.0/stations`,
      `${HOST}/land-observations/1.0.0/capabilities`,
    ],
  },
  {
    id: "atmospheric",
    label: "Atmospheric models",
    keyEnv: "METOFFICE_ATMO_API_KEY",
    note: "Gridded model output as GRIB2, delivered against orders placed in the portal. Poor fit for this app: the files are hundreds of megabytes and GRIB2 needs decoding a serverless function cannot sensibly do.",
    paths: [
      `${HOST}/atmospheric-models/1.0.0/orders`,
      `${HOST}/atmospheric/1.0.0/orders`,
      `${HOST}/atmospheric-models/v1/orders`,
      `${HOST}/atmospheric-models/1.0.0/capabilities`,
    ],
  },
];

export interface DiscoveryAttempt {
  url: string;
  status: number | null;
  contentType: string | null;
  /** Layer or site identifiers, when the response described some. */
  items?: string[];
  /** The templated tile URL WMTS advertises, which is what a client needs. */
  tileTemplate?: string | null;
  /** First part of the body, so an unexpected shape is still readable. */
  sample?: string;
  error?: string;
}

export interface ProductDiscovery {
  product: string;
  label: string;
  keyEnv: string;
  note: string;
  configured: boolean;
  endpoint: string | null;
  items: string[] | null;
  tileTemplate: string | null;
  verdict: string;
  attempts: DiscoveryAttempt[];
}

/** Identifiers from a WMTS capabilities document, without an XML parser. */
function itemsFromXml(xml: string): string[] {
  const found: string[] = [];
  for (const block of xml.split(/<Layer[\s>]/).slice(1)) {
    const match = block.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/);
    if (match) found.push(match[1].trim());
  }
  return [...new Set(found)];
}

function templateFromXml(xml: string): string | null {
  const match = xml.match(/<ResourceURL[^>]*template="([^"]+)"/);
  return match ? match[1] : null;
}

/** Best-effort names out of whatever JSON shape a product returns. */
function itemsFromJson(parsed: unknown): string[] {
  const pick = (entry: unknown): string => {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      for (const field of ["name", "id", "identifier", "siteId", "orderId", "title"]) {
        if (typeof record[field] === "string") return record[field] as string;
      }
      return JSON.stringify(entry).slice(0, 60);
    }
    return String(entry);
  };

  if (Array.isArray(parsed)) return parsed.slice(0, 40).map(pick);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const field of ["features", "sites", "orders", "layers", "items"]) {
      if (Array.isArray(record[field])) {
        return (record[field] as unknown[]).slice(0, 40).map(pick);
      }
    }
    return Object.keys(record).slice(0, 40);
  }
  return [];
}

async function probe(product: Product): Promise<ProductDiscovery> {
  // Fall back to the site-specific key: several DataHub plans issue one key for
  // everything, and trying it is cheaper than reporting "not configured" wrongly.
  const key = process.env[product.keyEnv] ?? process.env.METOFFICE_API_KEY;
  const base: Omit<ProductDiscovery, "verdict"> = {
    product: product.id,
    label: product.label,
    keyEnv: product.keyEnv,
    note: product.note,
    configured: Boolean(process.env[product.keyEnv]),
    endpoint: null,
    items: null,
    tileTemplate: null,
    attempts: [],
  };

  if (!key) {
    return { ...base, verdict: `${product.keyEnv} not set` };
  }

  for (const url of product.paths) {
    try {
      const res = await fetch(url, {
        headers: {
          apikey: key,
          accept: "application/json, application/xml;q=0.9, */*;q=0.8",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      const contentType = res.headers.get("content-type");
      const body = (await res.text()).slice(0, 6_000);
      const attempt: DiscoveryAttempt = {
        url,
        status: res.status,
        contentType,
        sample: body.slice(0, 240),
      };

      if (res.ok) {
        if (/xml/i.test(contentType ?? "") || body.trimStart().startsWith("<")) {
          attempt.items = itemsFromXml(body);
          attempt.tileTemplate = templateFromXml(body);
        } else {
          try {
            attempt.items = itemsFromJson(JSON.parse(body));
          } catch {
            /* neither XML nor JSON — the sample is what there is to go on */
          }
        }
        base.attempts.push(attempt);
        return {
          ...base,
          endpoint: url,
          items: attempt.items ?? null,
          tileTemplate: attempt.tileTemplate ?? null,
          verdict: "found — build the client from the identifiers above",
        };
      }
      base.attempts.push(attempt);
    } catch (err) {
      base.attempts.push({
        url,
        status: null,
        contentType: null,
        error: err instanceof Error ? err.name : "fetch failed",
      });
    }
  }

  /*
   * The statuses matter more than the failure itself. All 404s means the paths
   * are wrong and the key is irrelevant; a 401 or 403 means a path was right and
   * the key or the subscription is not.
   */
  const statuses = base.attempts.map((a) => a.status);
  const authFailed = statuses.some((s) => s === 401 || s === 403);
  return {
    ...base,
    verdict: authFailed
      ? "a path was reached but the key was rejected — check the key matches this product's subscription"
      : "no candidate path answered; every attempt and its status is listed below",
  };
}

export async function discoverDataHub(): Promise<ProductDiscovery[]> {
  return Promise.all(PRODUCTS.map(probe));
}
