import { NextResponse } from "next/server";
import { getRadarIndex } from "@/lib/rainviewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/radar
 *
 * The RainViewer frame index — which radar frames exist and where their tiles
 * live. A few kilobytes, no key, no location: the same answer serves every
 * viewer, which is why it is not folded into `/api/overview`. The Maps tab
 * fetches it when it opens, so a visit that never looks at the map costs
 * nothing.
 *
 * The tiles themselves are not proxied. They are keyless and load as ordinary
 * images straight from the browser; putting them through a route here would
 * add a serverless hop and re-create the shared-cache hazard `/api/map` was
 * bitten by, in exchange for nothing.
 */
export async function GET() {
  const section = await getRadarIndex();

  if (!section.ok) {
    return NextResponse.json(
      { error: section.error, code: section.code },
      { status: section.code?.startsWith("http_") ? 502 : 503 }
    );
  }

  return NextResponse.json(section.data, {
    /*
     * Safe to share, unlike the Xweather map images: this response is identical
     * for everyone and carries no credentials. Five minutes matches how often
     * radar composites publish.
     */
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
