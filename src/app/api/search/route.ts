import { NextRequest, NextResponse } from "next/server";
import { searchPlacesKeyless } from "@/lib/geocode";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=<partial place name>
 *
 * Autocomplete, backed by Open-Meteo's keyless geocoding API.
 *
 * This was Xweather's `places/search`, at two to four accesses per name typed
 * — a 250 ms debounce means a word costs several. That was a real share of an
 * allowance, spent on a lookup that has nothing to do with the two jobs
 * Xweather still has here. It is now free, and a typed coordinate pair is
 * answered without any request at all.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const section = await searchPlacesKeyless(query, 8);

  if (!section.ok) {
    return NextResponse.json({ error: section.error, results: [] }, { status: 502 });
  }

  return NextResponse.json({ results: section.data ?? [] });
}
