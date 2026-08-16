import { NextRequest, NextResponse } from "next/server";
import { resolvePlace } from "@/lib/xweather";
import { getClimateContext } from "@/lib/climate";

export const dynamic = "force-dynamic";

/**
 * GET /api/climate?p=<location>
 *
 * Where this month sits against the ERA5 record back to 1940.
 *
 * Its own route rather than part of `/api/overview` because the upstream
 * response is eighty-five years of daily values — about a third of a megabyte —
 * and it is reduced to a summary here. Putting it in the overview would make
 * every page load wait on a request that only the History tab needs.
 */
export async function GET(request: NextRequest) {
  const place = request.nextUrl.searchParams.get("p")?.trim();
  if (!place) {
    return NextResponse.json({ error: "Missing 'p'." }, { status: 400 });
  }

  const resolved = await resolvePlace(place);
  if (!resolved.ok || !resolved.data) {
    return NextResponse.json(
      { error: resolved.error ?? "Could not resolve that place." },
      { status: 404 }
    );
  }

  const climate = await getClimateContext(resolved.data.lat, resolved.data.lon);

  return NextResponse.json(
    {
      place: {
        lat: resolved.data.lat,
        lon: resolved.data.lon,
        name: resolved.data.displayName,
      },
      fetchedAt: new Date().toISOString(),
      climate,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
