import { NextRequest, NextResponse } from "next/server";
import { buildMapUrl, hasCredentials } from "@/lib/xweather";
import {
  ALLOWED_LAYERS,
  BASE_LAYER_SET as BASE,
  DROPPABLE_LAYERS as DECORATION,
} from "@/lib/map-layers";

export const dynamic = "force-dynamic";

const OFFSET = /^(current|[+-]\d{1,4}(min|minutes|hour|hours|day|days))$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * GET /api/map?lat=&lon=&zoom=&layers=&offset=&w=&h=
 *
 * Proxies an Xweather raster map image. The client_id/client_secret pair is
 * embedded in the upstream path, so the browser never sees it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  if (!hasCredentials()) {
    return NextResponse.json(
      { error: "Xweather credentials are not configured." },
      { status: 503 }
    );
  }

  // Number(null) is 0, so check the raw params before coercing — otherwise a
  // request with no coordinates would quietly render the Gulf of Guinea.
  const latRaw = params.get("lat");
  const lonRaw = params.get("lon");
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (
    latRaw === null ||
    lonRaw === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return NextResponse.json(
      { error: "Valid 'lat' and 'lon' are required." },
      { status: 400 }
    );
  }

  const rawLayers = (params.get("layers") ?? "flat,radar-global,admin")
    .split(",")
    .map((layer) => layer.trim())
    .filter(Boolean);

  // A full stack is base + mask + view + every overlay + tracks + borders +
  // labels, which comfortably passes ten. The cap only exists to stop an
  // absurdly long URL, so it sits well above any stack the UI can build.
  if (rawLayers.length === 0 || rawLayers.length > 20) {
    return NextResponse.json({ error: "Invalid layer list." }, { status: 400 });
  }

  const invalid = rawLayers.filter((layer) => !ALLOWED_LAYERS.has(layer));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Unsupported map layer(s): ${invalid.join(", ")}` },
      { status: 400 }
    );
  }

  const offset = params.get("offset") ?? "current";
  if (!OFFSET.test(offset)) {
    return NextResponse.json({ error: "Invalid time offset." }, { status: 400 });
  }

  const geometry = {
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
    zoom: Math.round(clamp(Number(params.get("zoom")) || 7, 1, 15)),
    width: Math.round(clamp(Number(params.get("w")) || 900, 100, 1600)),
    height: Math.round(clamp(Number(params.get("h")) || 560, 100, 1200)),
    offset,
  };

  /*
   * Layer names cannot be validated ahead of time — the allow-list only stops
   * injection, it cannot know which codes this account's plan actually serves.
   * One bad name previously failed the whole request, and because the admin
   * overlay rode on every URL, that meant no map at all under any settings.
   *
   * So: try the full stack, then progressively simpler ones. Decoration goes
   * first (borders and labels are the least important), then extra weather
   * layers, then everything but the base map. The response reports which set
   * actually rendered so the UI can say what was dropped.
   */
  const base = rawLayers.filter((layer) => BASE.has(layer));
  const weather = rawLayers.filter(
    (layer) => !BASE.has(layer) && !DECORATION.has(layer)
  );
  const fallbackBase = base.length > 0 ? base : ["flat"];

  const candidates: string[][] = [
    rawLayers,
    [...base, ...weather],
    [...fallbackBase, ...weather.slice(0, 1)],
    fallbackBase,
  ];

  // Collapse consecutive duplicates so identical stacks aren't tried twice.
  const attempts: string[][] = [];
  for (const candidate of candidates) {
    const key = candidate.join(",");
    if (key && !attempts.some((a) => a.join(",") === key)) attempts.push(candidate);
  }

  let lastStatus = 0;
  let lastError = "Could not reach the Xweather maps service.";

  for (const attempt of attempts) {
    const url = buildMapUrl({ ...geometry, layers: attempt.join(",") });
    if (!url) {
      return NextResponse.json(
        { error: "Xweather credentials are not configured." },
        { status: 503 }
      );
    }

    let upstream: Response;
    try {
      /*
       * Deliberately uncached at this hop. Next's data cache is built for JSON
       * and stores the body itself; putting PNGs through it on a serverless
       * host adds a keying layer between the request and the picture, and a
       * keying layer is exactly what could serve one image for every set of
       * layers. The response below still carries max-age=120, so the CDN and
       * the browser do the caching that actually matters — closer to the user
       * and keyed on the full URL.
       */
      upstream = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
    } catch (err) {
      lastError =
        err instanceof Error && err.name === "TimeoutError"
          ? "The Xweather maps service did not respond in time."
          : "Could not reach the Xweather maps service.";
      lastStatus = 504;
      continue;
    }

    if (upstream.ok) {
      const body = await upstream.arrayBuffer();
      const used = attempt.join(",");
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "image/png",
          "Cache-Control": "public, max-age=120",
          // What actually rendered, so the client can report any downgrade.
          "X-Map-Layers": used,
          "X-Map-Requested": rawLayers.join(","),
        },
      });
    }

    lastStatus = upstream.status;
    lastError =
      upstream.status === 401
        ? "Xweather rejected the map credentials (HTTP 401)."
        : upstream.status === 403
          ? "Xweather refused the map request (HTTP 403) — raster maps may not be in your subscription."
          : `Xweather maps returned HTTP ${upstream.status} for layers: ${attempt.join(",")}`;

    // Bad credentials will not improve by simplifying the layer stack.
    if (upstream.status === 401) break;
  }

  return NextResponse.json(
    {
      error: lastError,
      triedLayers: attempts.map((a) => a.join(",")),
    },
    { status: lastStatus === 403 || lastStatus === 401 ? lastStatus : 502 }
  );
}
