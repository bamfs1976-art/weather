import { NextRequest, NextResponse } from "next/server";
import {
  getArchiveHourly,
  getArchiveObservations,
  getSunMoonForDate,
  hasCredentials,
  httpStatusForCode,
  resolvePlace,
} from "@/lib/xweather";
import type { ArchiveDayPayload } from "@/lib/weather-types";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/archive?p=<location>&date=YYYY-MM-DD
 *
 * Hour-by-hour reconstruction of a single past day: interpolated hourly
 * conditions, the raw station observations behind them, and that day's
 * sun/moon times.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const place = params.get("p")?.trim();
  const date = params.get("date")?.trim();

  if (!place || !date) {
    return NextResponse.json(
      { error: "Missing required query parameters: p, date." },
      { status: 400 }
    );
  }

  if (!DATE.test(date)) {
    return NextResponse.json(
      { error: "Date must be in YYYY-MM-DD format." },
      { status: 400 }
    );
  }

  if (!hasCredentials()) {
    return NextResponse.json(
      { error: "Xweather credentials are not configured." },
      { status: 503 }
    );
  }

  const resolved = await resolvePlace(place);
  if (!resolved.ok || !resolved.data) {
    return NextResponse.json(
      { error: resolved.error ?? "Could not resolve that location." },
      { status: httpStatusForCode(resolved.code) }
    );
  }

  const point = `${resolved.data.lat},${resolved.data.lon}`;

  const [hourly, observations, sunMoon] = await Promise.all([
    getArchiveHourly(point, date),
    getArchiveObservations(point, date),
    getSunMoonForDate(point, date),
  ]);

  const payload: ArchiveDayPayload = {
    place: resolved.data,
    date,
    sections: { hourly, observations, sunMoon },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
