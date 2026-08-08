import { NextRequest, NextResponse } from "next/server";
import { hasCredentials, probeMapLayer, resolvePlace, xwFetch } from "@/lib/xweather";
import { getFloodWarnings, getMarineConditions, getRiverStations } from "@/lib/water";
import {
  BASE_LAYERS,
  DECORATION_LAYERS,
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
        const [floods, rivers, marine] = await Promise.all([
          getFloodWarnings(point.lat, point.lon, 30),
          getRiverStations(point.lat, point.lon, 20, 2),
          getMarineConditions(point.lat, point.lon),
        ]);
        return [
          { endpoint: "EA flood-monitoring: floods", ok: floods.ok, code: floods.code, message: floods.error },
          { endpoint: "EA flood-monitoring: stations + measures", ok: rivers.ok, code: rivers.code, message: rivers.error },
          { endpoint: "Open-Meteo Marine", ok: marine.ok, code: marine.code, message: marine.error },
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
    ...DECORATION_LAYERS,
    ...WEATHER_VIEWS.map((option) => option.id),
    ...WEATHER_OVERLAYS.map((option) => option.id),
  ];

  const maps = point
    ? await Promise.all(
        MAP_LAYERS.map((layer) => probeMapLayer(layer, point.lat, point.lon))
      )
    : [];

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
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
