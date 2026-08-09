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
  /** Product slugs to test for existence, most likely first. */
  slugs: string[];
  /** Resources to try under whichever slug turns out to exist. */
  resources: string[];
}

/**
 * The gateway distinguishes two kinds of 404, and the difference is the whole
 * trick.
 *
 *   "No matching resource found for given API Request"
 *       -> the product and version matched; the resource path did not.
 *   "The requested resource is not available"
 *       -> no such product at all.
 *
 * Probing a nonsense resource under a candidate slug therefore tells us whether
 * the product exists, without knowing a single real path. That turned a blind
 * search over slug x resource into two cheap passes.
 */
function apiExists(body: string): boolean {
  return /No matching resource found for given API Request/i.test(body);
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
    // map-images/1.0.0 is confirmed to exist: it answers with the
    // resource-not-matched 404 rather than the product-not-found one.
    slugs: ["map-images", "map-image", "maps"],
    resources: [
      "collections",
      "capabilities",
      "products",
      "images",
      "tiles",
      "layers",
      "wmts/1.0.0/WMTSCapabilities.xml",
      `wmts${WMTS}`,
      `?service=WMTS&request=GetCapabilities&version=1.0.0`,
    ],
  },
  {
    id: "observations",
    label: "Land observations",
    keyEnv: "METOFFICE_OBS_API_KEY",
    note: "Hourly readings from ~150 UK stations. Worth integrating — these are measurements, so they can be shown against the interpolated conditions rather than as another forecast.",
    // Every "observations" spelling tried so far returned product-not-found,
    // so the slug is the unknown here rather than the resource.
    slugs: [
      "land-observations",
      "observations",
      "land-obs",
      "surface-observations",
      "landsurface-observations",
      "obs",
    ],
    resources: ["collections", "sites", "stations", "capabilities", "latest", "hourly"],
  },
  {
    id: "atmospheric",
    label: "Atmospheric models",
    keyEnv: "METOFFICE_ATMO_API_KEY",
    note: "Gridded model output as GRIB2, delivered against orders placed in the portal. Poor fit for this app: the files are hundreds of megabytes and GRIB2 needs decoding a serverless function cannot sensibly do.",
    slugs: ["atmospheric-models"],
    resources: ["orders", "collections"],
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

interface Fetched {
  status: number | null;
  contentType: string | null;
  body: string;
  error?: string;
}

async function get(url: string, key: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { apikey: key, accept: "application/json, application/xml;q=0.9, */*;q=0.8" },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: (await res.text()).slice(0, 6_000),
    };
  } catch (err) {
    return {
      status: null,
      contentType: null,
      body: "",
      error: err instanceof Error ? err.name : "fetch failed",
    };
  }
}

function describe(url: string, got: Fetched): DiscoveryAttempt {
  return {
    url,
    status: got.status,
    contentType: got.contentType,
    sample: got.body.slice(0, 200),
    error: got.error,
  };
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

  if (!key) return { ...base, verdict: `${product.keyEnv} not set` };

  /*
   * Pass one: which slug is a real product? A deliberately nonsense resource is
   * requested under each, because the gateway's two different 404s answer that
   * question without needing to know any real path.
   */
  let slug: string | null = null;
  for (const candidate of product.slugs) {
    const url = `${HOST}/${candidate}/1.0.0/__probe`;
    const got = await get(url, key);
    base.attempts.push(describe(url, got));
    if (got.status === 401 || got.status === 403) {
      return {
        ...base,
        verdict: `${candidate} exists but rejected the key — check it matches this product's subscription`,
      };
    }
    if (apiExists(got.body) || (got.status !== null && got.status < 400)) {
      slug = candidate;
      break;
    }
  }

  if (!slug) {
    return {
      ...base,
      verdict:
        "no product slug matched — every candidate returned product-not-found, so the slug itself is wrong. Copy the endpoint from the DataHub product page.",
    };
  }

  /* Pass two: the resource, under the slug now known to exist. */
  for (const resource of product.resources) {
    const url = `${HOST}/${slug}/1.0.0/${resource}`;
    const got = await get(url, key);
    if (got.status !== null && got.status >= 200 && got.status < 300) {
      const attempt = describe(url, got);
      if (/xml/i.test(got.contentType ?? "") || got.body.trimStart().startsWith("<")) {
        attempt.items = itemsFromXml(got.body);
        attempt.tileTemplate = templateFromXml(got.body);
      } else {
        try {
          attempt.items = itemsFromJson(JSON.parse(got.body));
        } catch {
          /* neither XML nor JSON — the sample is what there is to go on */
        }
      }
      return {
        ...base,
        // On success the failed attempts are noise, and this gets read on a phone.
        attempts: [],
        endpoint: url,
        items: attempt.items ?? null,
        tileTemplate: attempt.tileTemplate ?? null,
        verdict: "found — build the client from the identifiers above",
      };
    }
    base.attempts.push(describe(url, got));
  }

  return {
    ...base,
    verdict: `product "${slug}" exists but none of the tried resources matched — the slug is right and the resource is not. Copy the exact path from the DataHub product page.`,
  };
}

export async function discoverDataHub(): Promise<ProductDiscovery[]> {
  return Promise.all(PRODUCTS.map(probe));
}
