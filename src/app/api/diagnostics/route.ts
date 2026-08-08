import { NextRequest, NextResponse } from "next/server";
import { hasCredentials, xwFetch } from "@/lib/xweather";

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

  return NextResponse.json(
    {
      credentials: true,
      location: place,
      available: results.filter((r) => r.ok).map((r) => r.endpoint),
      unavailable: results.filter((r) => !r.ok),
      results,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
