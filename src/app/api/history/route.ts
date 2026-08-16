import { NextRequest, NextResponse } from "next/server";
import {
  getDailySummaries,
  getNormals,
  getStationSummaries,
  hasCredentials,
  httpStatusForCode,
  resolvePlace,
} from "@/lib/xweather";
import type { HistoryPayload, HistorySections } from "@/lib/weather-types";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * GET /api/history?p=<location>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Daily summaries for a date range, plus the station's own summaries and the
 * 30-year climate normals for the same window so the UI can show anomalies.
 * Xweather caps a single summary query at roughly one month.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const place = params.get("p")?.trim();
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();

  if (!place || !from || !to) {
    return NextResponse.json(
      { error: "Missing required query parameters: p, from, to." },
      { status: 400 }
    );
  }

  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json(
      { error: "Dates must be in YYYY-MM-DD format." },
      { status: 400 }
    );
  }

  const span = daysBetween(from, to);
  if (span < 0) {
    return NextResponse.json(
      { error: "'from' must be on or before 'to'." },
      { status: 400 }
    );
  }
  if (span > MAX_DAYS) {
    return NextResponse.json(
      {
        error: `Xweather returns at most about one month of daily summaries per request — that range is ${span + 1} days.`,
      },
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

  const [dailySummaries, stationSummaries, normals] = await Promise.all([
    getDailySummaries(point, from, to),
    getStationSummaries(point, from, to),
    getNormals(point, from, to),
  ]);

  const payload: HistoryPayload = {
    place: resolved.data,
    from,
    to,
    sections: { dailySummaries, stationSummaries, normals } satisfies HistorySections,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
