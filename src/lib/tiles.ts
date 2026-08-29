/**
 * Web Mercator tile arithmetic.
 *
 * The Xweather map this sits beside is a *composite*: one URL returns a whole
 * rendered picture for a centre and a zoom. RainViewer is a **tile service** —
 * a slippy-map grid of 256px squares addressed by z/x/y — which is a different
 * model and needs the projection doing here rather than by the server.
 *
 * Pure, so it can be checked against known values rather than eyeballed on a
 * map, which is the only practical way to catch an off-by-one in a projection:
 * a tile grid that is one row out still looks like a plausible map.
 *
 * No dependency. This is about forty lines of trigonometry and the alternative
 * was a mapping library, which CLAUDE.md's "no new dependencies without a
 * reason" rule exists precisely to keep out.
 */

/** Standard slippy-map tile edge, in pixels. */
export const TILE_SIZE = 256;

/**
 * Fractional tile coordinates for a point — the whole part is the tile, the
 * fraction is where inside it the point falls.
 *
 * Web Mercator is undefined at the poles, so latitude is clamped to the
 * ±85.0511° the projection actually covers. Without that, a point in the high
 * Arctic produces an infinite y and the whole grid disappears.
 */
export function pointToTile(
  lat: number,
  lon: number,
  zoom: number
): { x: number; y: number } {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export interface TilePlacement {
  /** Tile address. */
  z: number;
  x: number;
  y: number;
  /** Where the tile's top-left corner sits inside the viewport, in pixels. */
  left: number;
  top: number;
}

/**
 * The tiles needed to fill a viewport centred on a point, and where to put
 * each one.
 *
 * The centre tile is positioned so the point itself lands at the middle of the
 * viewport; every other tile is offset by whole tile widths from it. Columns
 * wrap around the antimeridian because x is cyclic — a viewport centred on Fiji
 * needs tiles from both ends of the range — while rows do not, because there is
 * nothing above the north pole, so out-of-range rows are dropped rather than
 * wrapped.
 */
export function tileGrid(
  lat: number,
  lon: number,
  zoom: number,
  width: number,
  height: number
): TilePlacement[] {
  const n = 2 ** zoom;
  const centre = pointToTile(lat, lon, zoom);
  const centreX = Math.floor(centre.x);
  const centreY = Math.floor(centre.y);

  /* Where the centre tile's corner goes so the point lands mid-viewport. */
  const originLeft = width / 2 - (centre.x - centreX) * TILE_SIZE;
  const originTop = height / 2 - (centre.y - centreY) * TILE_SIZE;

  /* Enough tiles either side to cover the viewport, plus one for the edges. */
  const cols = Math.ceil(width / TILE_SIZE / 2) + 1;
  const rows = Math.ceil(height / TILE_SIZE / 2) + 1;

  const out: TilePlacement[] = [];
  for (let dy = -rows; dy <= rows; dy += 1) {
    const y = centreY + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -cols; dx <= cols; dx += 1) {
      out.push({
        z: zoom,
        /* Longitude wraps; ((a % n) + n) % n keeps it positive. */
        x: (((centreX + dx) % n) + n) % n,
        y,
        left: originLeft + dx * TILE_SIZE,
        top: originTop + dy * TILE_SIZE,
      });
    }
  }
  return out;
}
