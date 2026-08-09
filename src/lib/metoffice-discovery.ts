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

interface Product {
  id: string;
  label: string;
  keyEnv: string;
  /** What the product is for, and whether it is worth integrating. */
  note: string;
  /**
   * Version segments to try. Not always "1.0.0": the one DataHub path this
   * codebase knows works is `/sitespecific/v0/point/hourly`, so a product that
   * answers product-not-found under 1.0.0 has not been ruled out until v0 has
   * been tried too.
   */
  versions: string[];
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
    note: "Fixed-resolution PNGs of the Global 10 km model (precipitation rate, surface temperature, MSLP), rendered against an order defined in the DataHub portal. Not worth integrating: it is not radar, the three parameters are already covered by Xweather rasters, and those redraw at any zoom while these do not.",
    // Confirmed from the Met Office's own map_images_download utility rather
    // than inferred: the product is order-based like atmospheric models, which
    // is why every collection/layer/WMTS-shaped guess returned the
    // resource-not-matched 404 under a slug that was right all along.
    // https://github.com/MetOffice/weather_datahub_utilities
    versions: ["1.0.0"],
    slugs: ["map-images"],
    resources: ["orders", "runs?sort=RUNDATETIME"],
  },
  {
    id: "observations",
    label: "Land observations",
    keyEnv: "METOFFICE_OBS_API_KEY",
    note: "Hourly readings from ~150 UK stations. Worth integrating — these are measurements, so they can be shown against the interpolated conditions rather than as another forecast.",
    // Six spellings returned product-not-found under 1.0.0, which rules out the
    // slugs only for that version. Site-specific lives at v0, so both are tried
    // before concluding anything.
    versions: ["1.0.0", "v0"],
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
    versions: ["1.0.0"],
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
  let found: { slug: string; version: string } | null = null;
  outer: for (const candidate of product.slugs) {
    for (const version of product.versions) {
      const url = `${HOST}/${candidate}/${version}/__probe`;
      const got = await get(url, key);
      base.attempts.push(describe(url, got));
      if (got.status === 401 || got.status === 403) {
        return {
          ...base,
          verdict: `${candidate}/${version} exists but rejected the key — check it matches this product's subscription`,
        };
      }
      if (apiExists(got.body) || (got.status !== null && got.status < 400)) {
        found = { slug: candidate, version };
        break outer;
      }
    }
  }

  if (!found) {
    return {
      ...base,
      verdict: `no product matched — every candidate slug returned product-not-found under ${product.versions.join(" and ")}, so the slug itself is wrong. Open this product in the DataHub portal and copy the request URL it shows.`,
    };
  }

  const { slug, version } = found;

  /* Pass two: the resource, under the slug and version now known to exist. */
  for (const resource of product.resources) {
    const url = `${HOST}/${slug}/${version}/${resource}`;
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
    verdict: `product "${slug}/${version}" exists but none of the tried resources matched — the slug is right and the resource is not. Copy the exact path from the DataHub product page.`,
  };
}

/**
 * A slug supplied at request time, tried ahead of the built-in candidates.
 *
 * Twelve probes have failed to find land observations, and the next guess is
 * worth less than the answer sitting on the user's DataHub product page. This
 * lets them try it straight from the browser —
 * `/api/diagnostics?p=Swansea&product=land-observations-1.0.0` — instead of
 * waiting on a code change and a redeploy to test a one-word hypothesis.
 *
 * Only `[a-z0-9-]` survives, and the URL is always rebuilt against HOST: the
 * value reaches an outbound fetch that carries the API key, so it is matched
 * against a character class rather than merely escaped.
 */
const SEGMENT = /^[a-z0-9-]{1,64}$/;

function parseOverride(raw: string | null | undefined): Product["slugs"] | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return SEGMENT.test(trimmed) ? [trimmed] : null;
}

export function overrideVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return /^[a-z0-9.]{1,16}$/.test(trimmed) ? trimmed : null;
}

export async function discoverDataHub(options?: {
  /** Product slug to try first, for the product whose slug is still unknown. */
  productSlug?: string | null;
  /** Version segment to try first, since not every product is at 1.0.0. */
  productVersion?: string | null;
}): Promise<ProductDiscovery[]> {
  const extraSlug = parseOverride(options?.productSlug);
  const extraVersion = overrideVersion(options?.productVersion);

  const products = PRODUCTS.map((product) => {
    if (product.id !== "observations" || (!extraSlug && !extraVersion)) return product;
    return {
      ...product,
      slugs: [...(extraSlug ?? []), ...product.slugs],
      versions: [...(extraVersion ? [extraVersion] : []), ...product.versions],
    };
  });

  return Promise.all(products.map(probe));
}
