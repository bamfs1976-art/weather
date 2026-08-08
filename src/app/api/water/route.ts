import { NextRequest, NextResponse } from "next/server";
import {
  getFloodWarnings,
  getMarineConditions,
  getRiverStations,
} from "@/lib/water";
import { resolvePlace } from "@/lib/xweather";
import type { WaterPayload } from "@/lib/water-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/water?p=<location>  (or ?lat=&lon=)
 *
 * River gauges and flood warnings from the Environment Agency's open
 * flood-monitoring feed, plus sea state from Open-Meteo. Each source is a
 * Section, so one dead upstream only blanks its own card.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const place = params.get("p")?.trim();
  const latParam = params.get("lat");
  const lonParam = params.get("lon");

  let lat: number;
  let lon: number;
  let name = "";
  // Minutes east of UTC at the place, so times render as local-for-the-place.
  let offsetMinutes: number | null = null;

  if (latParam !== null && lonParam !== null) {
    lat = Number(latParam);
    lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "Invalid 'lat'/'lon'." },
        { status: 400 }
      );
    }
    name = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } else if (place) {
    // Reuse the Xweather gazetteer so this route accepts the same place
    // strings as the rest of the app.
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
    offsetMinutes =
      typeof resolved.data.tzoffset === "number"
        ? Math.round(resolved.data.tzoffset / 60)
        : null;
  } else {
    return NextResponse.json(
      { error: "Provide either 'p' or both 'lat' and 'lon'." },
      { status: 400 }
    );
  }

  const [floods, rivers, marine] = await Promise.all([
    getFloodWarnings(lat, lon, 30, offsetMinutes),
    getRiverStations(lat, lon, 20, 3, offsetMinutes),
    getMarineConditions(lat, lon, offsetMinutes),
  ]);

  const payload: WaterPayload = {
    place: { lat, lon, name },
    fetchedAt: new Date().toISOString(),
    sections: { floods, rivers, marine },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
