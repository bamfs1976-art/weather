/**
 * SERVER ONLY — endpoint discovery for Met Office DataHub products.
 *
 * Four DataHub products are subscribed. Site-specific is integrated in
 * lib/metoffice.ts; land observations was resolved and then dropped (see
 * below); map images and atmospheric models are what remain here.
 *
 * This module does not integrate anything. It asks each service where it lives
 * and reports the answer through /api/diagnostics, so a client would get
 * written from what the service says rather than from a plausible-looking
 * guess. That distinction is not pedantry: guessing raster URLs took the
 * Xweather map down under every setting for five rounds, and the same failure
 * here would be harder to spot because a wrong path and an unsubscribed
 * product both look like "no data".
 *
 * Both remaining products resolve, and neither is worth integrating — they are
 * order-based file deliveries and the app already covers what they carry. The
 * entries stay so the subscriptions stay visible, not as a step towards use.
 *
 * Land observations lived at `/observation-land/1/{6-character geohash}`, which
 * took a slug read off the product page to find. It is gone from the list on
 * purpose: the cell for an arbitrary postcode contains no station, and
 * Xweather's `observations` endpoints already supply real station readings — so
 * it was a second source for something the app was not missing. Do not add it
 * back without a reason that survives that sentence.
 *
 * Each product stops at its first success, and diagnostics is the only caller.
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
  /**
   * What a total miss means for this product. Once a slug is known to be right,
   * "the slug is wrong" stops being the useful advice — the subscription or the
   * key is the thing left to check.
   */
  whenMissing?: string;
  /**
   * What it means when the product answered but no resource did. The generic
   * advice ("the resource is wrong") is false once the API has replied in its
   * own voice below the version segment.
   */
  resourceMissing?: string;
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
 * Both of the gateway's 404s are JSON `"type": "Status report"` envelopes, and
 * nothing else it fronts speaks that way. So anything that is *not* one is the
 * product itself replying — which makes even a rejection proof of existence.
 *
 * This is not hypothetical tidiness. Land observations answered
 * `400 text/plain: "geohash must be exactly 6 chars"`, and the probe threw it
 * away because it only recognised 2xx and the resource-not-matched 404. That
 * response was the whole answer: the product was there, and it had just named
 * the shape of its own request path.
 */
function gatewayEnvelope(body: string): boolean {
  return /"type"\s*:\s*"Status report"/i.test(body);
}

function productAnswered(got: Fetched): boolean {
  if (got.status === null) return false;
  if (got.status < 400) return true;
  if (apiExists(got.body)) return true;
  return got.body.trim().length > 0 && !gatewayEnvelope(got.body);
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
  /** The start of a successful response, so the client is written from it. */
  sample?: string | null;
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
      let record = entry as Record<string, unknown>;
      // GeoJSON keeps the readable fields one level down, under `properties`.
      if (record.properties && typeof record.properties === "object") {
        record = { ...record, ...(record.properties as Record<string, unknown>) };
      }
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
      if (productAnswered(got)) {
        found = { slug: candidate, version };
        break outer;
      }
      /*
       * `__probe` alone would miss a gateway that answers on the bare base and
       * reports product-not-found for anything below it — which is exactly the
       * shape a "/{product}/{version}" URL with no resource suggests. One more
       * request per rejected candidate, and only when the first said no.
       */
      const bare = `${HOST}/${candidate}/${version}`;
      const root = await get(bare, key);
      base.attempts.push(describe(bare, root));
      if (productAnswered(root)) {
        found = { slug: candidate, version };
        break outer;
      }
    }
  }

  if (!found) {
    return {
      ...base,
      verdict:
        `no product matched — ${product.slugs.join(", ")} returned product-not-found under ${product.versions.join(" and ")}. ` +
        (product.whenMissing ??
          "The slug itself is wrong; open this product in the DataHub portal and copy the request URL it shows."),
    };
  }

  const { slug, version } = found;

  /* Pass two: the resource, under the slug and version now known to exist. */
  const root = `${HOST}/${slug}/${version}`;
  for (const resource of product.resources) {

    // An empty resource means the base itself, without a trailing slash: some
    // gateways answer there with a listing and 404 on `.../1/`.
    const url = resource ? `${root}/${resource}` : root;
    const got = await get(url, key);
    if (got.status !== null && got.status >= 200 && got.status < 300) {
      const attempt = describe(url, got);
      /*
       * Keep a generous sample on success. The identifiers alone do not say
       * what a field is called or what units it is in, and writing the client
       * from a shape nobody has looked at is how the map went down.
       */
      attempt.sample = got.body.slice(0, 1_500);
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
        sample: attempt.sample ?? null,
        verdict: "found — build the client from the identifiers above",
      };
    }
    base.attempts.push(describe(url, got));
  }

  return {
    ...base,
    verdict:
      `product "${slug}/${version}" exists but returned nothing usable. ` +
      (product.resourceMissing ??
        "The slug is right and the resource is not; copy the exact path from the DataHub product page."),
  };
}

export async function discoverDataHub(): Promise<ProductDiscovery[]> {
  return Promise.all(PRODUCTS.map(probe));
}
