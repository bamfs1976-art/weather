import { NextRequest, NextResponse } from "next/server";
import { getCarbonForPoint, getCrimeSummary, getTeamForm } from "@/lib/local";
import { resolvePlace } from "@/lib/xweather";
import type { LocalPayload } from "@/lib/local-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/local?p=<location>  (or ?lat=&lon=)
 *
 * The non-weather local sources: grid carbon intensity for the postcode's
 * region, street-level crime for the surrounding mile, and the local club's
 * fixtures. Each is a Section, so one missing token or dead upstream only
 * blanks its own card.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const place = params.get("p")?.trim();
  const latParam = params.get("lat");
  const lonParam = params.get("lon");

  let lat: number;
  let lon: number;
  let name = "";

  if (latParam !== null && lonParam !== null) {
    lat = Number(latParam);
    lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "Invalid 'lat'/'lon'." }, { status: 400 });
    }
    name = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } else if (place) {
    const resolved = await resolvePlace(place);
    if (!resolved.ok || !resolved.data) {
      return NextResponse.json(
        { error: resolved.error ?? "Could not resolve that location." },
        { status: 404 }
      );
    }
    lat = resolved.data.lat;
    lon = resolved.data.lon;
    name = resolved.data.displayName;
  } else {
    return NextResponse.json(
      { error: "Provide either 'p' or both 'lat' and 'lon'." },
      { status: 400 }
    );
  }

  const [carbon, crime, football] = await Promise.all([
    getCarbonForPoint(lat, lon),
    getCrimeSummary(lat, lon),
    getTeamForm(process.env.FOOTBALL_TEAM ?? "Swansea"),
  ]);

  const payload: LocalPayload = {
    place: { lat, lon, name },
    fetchedAt: new Date().toISOString(),
    sections: { carbon, crime, football },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
