import { NextRequest, NextResponse } from "next/server";
import { hasCredentials, searchPlaces } from "@/lib/xweather";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=<partial place name>
 * Autocomplete backed by the Xweather /places/search endpoint.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  if (!hasCredentials()) {
    return NextResponse.json(
      { error: "Xweather credentials are not configured.", results: [] },
      { status: 503 }
    );
  }

  const section = await searchPlaces(query, 8);

  if (!section.ok) {
    // An empty search result is reported as an error code upstream; treat that
    // as "no matches" rather than a failure the user has to read.
    if (section.code === "warn_no_data") {
      return NextResponse.json({ results: [] });
    }
    return NextResponse.json(
      { error: section.error, results: [] },
      { status: 502 }
    );
  }

  return NextResponse.json({ results: section.data ?? [] });
}
