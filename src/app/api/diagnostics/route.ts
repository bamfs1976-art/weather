import { NextRequest, NextResponse } from "next/server";
import {
  hasCredentials,
  probeMapLayer,
  probeMapStack,
  resolvePlace,
  xwFetch,
} from "@/lib/xweather";
import {
  getBathingWaters,
  getFloodWarnings,
  getMarineConditions,
  getRiverStations,
  getTideGauge,
} from "@/lib/water";
import { getPollen } from "@/lib/pollen";
import { getMetOfficeHourly } from "@/lib/metoffice";
import { discoverDataHub } from "@/lib/metoffice-discovery";
import {
  BASE_LAYERS,
  DECORATION_LAYERS,
  MASK_LAYERS,
  WEATHER_OVERLAYS,
  WEATHER_VIEWS,
} from "@/lib/map-layers";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics?p=<location>
 *
 * Calls every Xweather endpoint the app uses and reports which ones answered.
 * Xweather gates data sets by subscription tier, so this is the quickest way to
 * see what your key actually unlocks before wondering why a card is empty.
 */
export async function GET(request: NextRequest) {
  const place = request.nextUrl.searchParams.get("p")?.trim() || "51.6656,-3.9333";

  if (!hasCredentials()) {
    return NextResponse.json(
      {
        credentials: false,
        error:
          "XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET are not set. Copy .env.example to .env and fill them in.",
      },
      { status: 503 }
    );
  }

  const loc = encodeURIComponent(place);
  const checks: { name: string; path: string; params?: Record<string, string> }[] = [
    { name: "places", path: `places/${loc}` },
    { name: "places/search", path: "places/search", params: { query: "name:^lond", limit: "3" } },
    { name: "conditions", path: `conditions/${loc}` },
    { name: "conditions (minutely)", path: `conditions/${loc}`, params: { filter: "1min", plimit: "5" } },
    { name: "conditions (past 24h)", path: `conditions/${loc}`, params: { from: "-24hours", to: "now", filter: "1hr", plimit: "5" } },
    { name: "conditions/summary", path: `conditions/summary/${loc}`, params: { from: "-7days", to: "-1day", filter: "day", plimit: "7" } },
    { name: "observations", path: `observations/${loc}` },
    { name: "observations/summary", path: `observations/summary/${loc}`, params: { from: "-7days", to: "-1day", plimit: "7" } },
    { name: "observations/archive", path: `observations/archive/${loc}`, params: { from: "-2days", to: "-2days", plimit: "5" } },
    { name: "forecasts (hourly)", path: `forecasts/${loc}`, params: { filter: "1hr", limit: "3" } },
    { name: "forecasts (daily)", path: `forecasts/${loc}`, params: { filter: "mdnt2mdnt", limit: "3" } },
    { name: "forecasts (day/night)", path: `forecasts/${loc}`, params: { filter: "daynight", limit: "3" } },
    { name: "alerts", path: `alerts/${loc}` },
    { name: "airquality", path: `airquality/${loc}` },
    { name: "airquality/forecasts", path: `airquality/forecasts/${loc}`, params: { filter: "1hr", limit: "3" } },
    { name: "sunmoon", path: `sunmoon/${loc}` },
    { name: "threats", path: `threats/${loc}` },
    { name: "lightning/summary", path: `lightning/summary/${loc}`, params: { radius: "50km", from: "-1hour", to: "now" } },
    { name: "phrases/summary", path: `phrases/summary/${loc}` },
    { name: "normals", path: `normals/${loc}`, params: { from: "-7days", to: "-1day", plimit: "7" } },
  ];

  const results = await Promise.all(
    checks.map(async (check) => {
      const section = await xwFetch(check.path, check.params ?? {}, 0);
      return {
        endpoint: check.name,
        ok: section.ok,
        code: section.code,
        message: section.error,
      };
    })
  );

  /*
   * The non-Xweather sources too, so one call tells you the state of every
   * upstream the app depends on.
   */
  const resolved = await resolvePlace(place);
  const point = resolved.ok && resolved.data
    ? { lat: resolved.data.lat, lon: resolved.data.lon }
    : null;

  const water = point
    ? await (async () => {
        const [floods, rivers, marine, tides, bathing, pollen, metoffice] = await Promise.all([
          getFloodWarnings(point.lat, point.lon, 30),
          getRiverStations(point.lat, point.lon, 20, 2),
          getMarineConditions(point.lat, point.lon),
          getTideGauge(point.lat, point.lon),
          getBathingWaters(point.lat, point.lon),
          getPollen(point.lat, point.lon),
          getMetOfficeHourly(point.lat, point.lon),
        ]);
        return [
          { endpoint: "EA flood-monitoring: floods", ok: floods.ok, code: floods.code, message: floods.error },
          { endpoint: "EA flood-monitoring: stations + measures", ok: rivers.ok, code: rivers.code, message: rivers.error },
          { endpoint: "EA flood-monitoring: tide gauge", ok: tides.ok, code: tides.code, message: tides.error, via: tides.data?.via ?? null, readings: tides.data?.readings.length ?? 0 },
          { endpoint: "Defra/NRW bathing water quality", ok: bathing.ok, code: bathing.code, message: bathing.error, via: bathing.data?.[0]?.via ?? null, found: bathing.data?.length ?? 0 },
          { endpoint: "Open-Meteo Marine", ok: marine.ok, code: marine.code, message: marine.error },
          { endpoint: "Open-Meteo air quality (pollen)", ok: pollen.ok, code: pollen.code, message: pollen.error },
          { endpoint: "Met Office DataHub (site specific)", ok: metoffice.ok, code: metoffice.code, message: metoffice.error },
        ];
      })()
    : [];

  /*
   * Raster map layers, probed one at a time. The tokens are all valid names —
   * what this checks is subscription: the maps service is a separate host that
   * the data-endpoint checks above never touch, and a plan can serve some
   * layers while refusing others. Anything listed as broken here should be
   * taken out of the UI.
   */
  const MAP_LAYERS = [
    ...BASE_LAYERS,
    ...MASK_LAYERS,
    ...DECORATION_LAYERS,
    ...WEATHER_VIEWS.map((option) => option.id),
    ...WEATHER_OVERLAYS.map((option) => option.id),
  ];

  /*
   * Six at a time, not all thirty-seven.
   *
   * A different layer has timed out on each of the last two runs — maritime-sst
   * once, wind-dir the next — while every other layer passed and the stack
   * probes that use those same layers all succeeded. That pattern is the probe
   * saturating the maps host, not a layer being unavailable, and a report that
   * invents its own failures is worse than no report.
   *
   * This does not touch the Environment Agency timeouts: the phases here are
   * already sequential, so the raster probes run after the water calls have
   * finished and cannot have starved them.
   */
  const maps: Awaited<ReturnType<typeof probeMapLayer>>[] = [];
  if (point) {
    for (let i = 0; i < MAP_LAYERS.length; i += 6) {
      maps.push(
        ...(await Promise.all(
          MAP_LAYERS.slice(i, i + 6).map((layer) =>
            probeMapLayer(layer, point.lat, point.lon)
          )
        ))
      );
    }
  }

  /*
   * The stacks the map panel actually requests, fingerprinted. The per-layer
   * probe above pairs each code with a base — two layers — but the UI sends
   * five, and "every view looks the same" is a claim about whole stacks, not
   * about individual codes. If these hashes are all equal the service is
   * serving one picture regardless of what is asked for; if they differ, the
   * pictures are fine and the fault is in displaying them.
   */
  const stackViews = ["radar-global", "satellite-geocolor", "temperatures", "maritime-sst"];
  const mapStacks = point
    ? await Promise.all([
        ...stackViews.map((view) =>
          probeMapStack(
            `flat,water-depth,${view},countries-outlines,admin-cities`,
            point.lat,
            point.lon,
            7
          )
        ),
        // Same stack at a different zoom: proves zoom reaches the service.
        probeMapStack(
          "flat,water-depth,radar-global,countries-outlines,admin-cities",
          point.lat,
          point.lon,
          9
        ),
      ])
    : [];

  const hashes = mapStacks.filter((s) => s.hash).map((s) => s.hash);
  const distinctImages = new Set(hashes).size;

  /*
   * The same stacks again, but through this app's own /api/map instead of
   * straight to Xweather. That route is the one link never yet measured in
   * production: the probe above proves the service sends distinct pictures,
   * so if these come back identical the proxy or the CDN in front of it is
   * collapsing them, and the browser was never at fault.
   */
  const origin = new URL(request.url).origin;
  const routeStacks = point
    ? await Promise.all(
        [...stackViews.map((view) => ({ view, zoom: 7 })), { view: "radar-global", zoom: 9 }].map(
          async ({ view, zoom }) => {
            const layers = `flat,water-depth,${view},countries-outlines,admin-cities`;
            const url =
              `${origin}/api/map/${encodeURIComponent(layers)}/${zoom}` +
              `/${point.lat.toFixed(4)},${point.lon.toFixed(4)}/current/300x200.png`;
            try {
              const res = await fetch(url, {
                cache: "no-store",
                signal: AbortSignal.timeout(12_000),
              });
              if (!res.ok) {
                return {
                  layers, zoom, ok: false, status: res.status, bytes: null, hash: null,
                  detail: (await res.text().catch(() => "")).slice(0, 160),
                };
              }
              const buffer = Buffer.from(await res.arrayBuffer());
              const { createHash } = await import("node:crypto");
              return {
                layers, zoom, ok: true, status: res.status, bytes: buffer.length,
                hash: createHash("sha1").update(buffer).digest("hex").slice(0, 12),
                detail: res.headers.get("X-Map-Layers"),
              };
            } catch (err) {
              return {
                layers, zoom, ok: false, status: null, bytes: null, hash: null,
                detail: err instanceof Error ? err.name : "fetch failed",
              };
            }
          }
        )
      )
    : [];

  const routeDistinct = new Set(routeStacks.filter((s) => s.hash).map((s) => s.hash)).size;

  /*
   * Met Office DataHub products: discovery, not a health check. None of these
   * request paths is documented anywhere reachable from the build environment,
   * so this asks each service where it lives rather than guessing a URL — the
   * answers are what the real clients get written against.
   */
  const metofficeProducts = await discoverDataHub({
    /*
     * `?product=` and `?version=` let a slug read off the DataHub product page
     * be tried from the browser, without a code change and a redeploy per
     * guess. Land observations is the one still unresolved.
     */
    productSlug: request.nextUrl.searchParams.get("product"),
    productVersion: request.nextUrl.searchParams.get("version"),
    // Land observations addresses a location by six-character geohash, so the
    // probe needs the resolved point rather than a fixed resource name.
    point,
  });

  const all = [...results, ...water];

  return NextResponse.json(
    {
      credentials: true,
      location: place,
      available: all.filter((r) => r.ok).map((r) => r.endpoint),
      unavailable: all.filter((r) => !r.ok),
      results: all,
      maps: {
        working: maps.filter((m) => m.ok).map((m) => m.layer),
        broken: maps.filter((m) => !m.ok),
      },
      mapStacks: {
        /*
         * Equal to the number of stacks probed when the service is behaving.
         * Anything less means separate requests came back byte-identical.
         */
        distinctImages,
        probed: mapStacks.length,
        verdict:
          mapStacks.length === 0
            ? "not probed"
            : distinctImages === mapStacks.length
              ? "service returns a different image per stack — any sameness on screen is a display fault"
              : "service returned identical bytes for different stacks — the fault is upstream, not in the browser",
        results: mapStacks,
      },
      metofficeProducts,
      routeStacks: {
        distinctImages: routeDistinct,
        probed: routeStacks.length,
        verdict:
          routeStacks.length === 0
            ? "not probed"
            : routeDistinct === routeStacks.length
              ? "the proxy route also returns a different image per stack — the whole server path is sound"
              : "the proxy route collapsed different stacks to identical bytes — the fault is the route or its cache, not the browser",
        results: routeStacks,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
