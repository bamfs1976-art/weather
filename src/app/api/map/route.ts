import { NextRequest, NextResponse } from "next/server";
import { buildMapUrl, hasCredentials } from "@/lib/xweather";

export const dynamic = "force-dynamic";

/**
 * Layer tokens the UI is allowed to request. The credentials live in the
 * upstream URL path, so this route must never interpolate unvalidated input.
 */
const ALLOWED_LAYERS = new Set([
  // base maps
  "flat",
  "flat-dk",
  "blue-marble",
  "satellite",
  "sat-global",
  "water-depth",
  // overlays
  "admin-cities",
  "admin-cities-dk",
  "admin-states",
  "admin-states-dk",
  "countries",
  "counties",
  "states",
  "interstates",
  "roads",
  "water",
  // weather layers
  "radar",
  "radar-global",
  "alerts",
  "temperatures",
  "wind-speeds",
  "wind-dir",
  "dew-points",
  "humidity",
  "pressure-isobars",
  "precip",
  "precip-1hr",
  "precip-24hr",
  "snow-depth",
  "clouds",
  "lightning-strikes-5m-icons",
  "stormcells",
  "fires",
  "smoke",
  "air-quality-index",
  "heat-index",
  "wind-chill",
  "tropical-cyclones",
  "visibility",
  "uv-index",
]);

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

  const rawLayers = (params.get("layers") ?? "flat-dk,radar,admin-cities-dk")
    .split(",")
    .map((layer) => layer.trim())
    .filter(Boolean);

  if (rawLayers.length === 0 || rawLayers.length > 8) {
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

  const url = buildMapUrl({
    layers: rawLayers.join(","),
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
    zoom: Math.round(clamp(Number(params.get("zoom")) || 7, 1, 15)),
    width: Math.round(clamp(Number(params.get("w")) || 900, 100, 1600)),
    height: Math.round(clamp(Number(params.get("h")) || 560, 100, 1200)),
    offset,
  });

  if (!url) {
    return NextResponse.json(
      { error: "Xweather credentials are not configured." },
      { status: 503 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { next: { revalidate: 120 } });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the Xweather maps service." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error:
          upstream.status === 403
            ? "Xweather refused the map request (HTTP 403) — the credentials are rejected or raster maps are not in your subscription."
            : `Xweather maps returned HTTP ${upstream.status}.`,
      },
      { status: upstream.status === 403 ? 403 : 502 }
    );
  }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=120",
    },
  });
}
