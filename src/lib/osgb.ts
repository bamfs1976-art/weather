/**
 * WGS84 latitude/longitude → Ordnance Survey National Grid eastings/northings.
 *
 * The bathing water API indexes everything by British National Grid reference
 * and offers no lat/long filter, so a conversion is unavoidable. It is done
 * here rather than by calling a geocoding service because this is pure
 * arithmetic: no network hop, no extra failure mode, and — the reason that
 * matters most here — it can be checked against published grid references
 * without reaching anything outside the process.
 *
 * Three steps, all standard:
 *   1. WGS84 geodetic → geocentric cartesian.
 *   2. Helmert transformation onto the OSGB36 datum.
 *   3. OSGB36 geodetic → Transverse Mercator on the National Grid projection.
 *
 * Accurate to a few metres, which is far finer than "which beach is nearest".
 */

const DEG = Math.PI / 180;

/** WGS84 ellipsoid. */
const WGS84 = { a: 6378137, b: 6356752.3142 };
/** Airy 1830, the ellipsoid the National Grid is drawn on. */
const AIRY = { a: 6377563.396, b: 6356256.909 };

/**
 * Helmert parameters for WGS84 → OSGB36. Rotations are in seconds of arc and
 * the scale factor in parts per million, both converted on use.
 */
const HELMERT = {
  tx: -446.448,
  ty: 125.157,
  tz: -542.06,
  rx: -0.1502,
  ry: -0.247,
  rz: -0.8421,
  s: 20.4894,
};

/** National Grid Transverse Mercator constants. */
const GRID = {
  /** Scale factor on the central meridian. */
  f0: 0.9996012717,
  /** True origin: 49°N, 2°W. */
  lat0: 49 * DEG,
  lon0: -2 * DEG,
  /** False origin offsets, in metres. */
  e0: 400000,
  n0: -100000,
};

export interface GridReference {
  easting: number;
  northing: number;
}

/**
 * Convert a WGS84 coordinate to National Grid eastings and northings.
 *
 * Returns null outside the projection's usable area rather than a plausible
 * looking number, so a caller cannot silently query the grid for somewhere the
 * grid does not describe.
 */
export function latLonToGrid(lat: number, lon: number): GridReference | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Generous bounds around the British Isles; outside them the National Grid
  // is meaningless and the bathing water index holds nothing anyway.
  if (lat < 49 || lat > 61 || lon < -9 || lon > 2.5) return null;

  const { x, y, z } = geodeticToCartesian(lat * DEG, lon * DEG, WGS84);
  const shifted = helmert({ x, y, z });
  const { phi, lambda } = cartesianToGeodetic(shifted, AIRY);
  return project(phi, lambda);
}

function geodeticToCartesian(
  phi: number,
  lambda: number,
  ellipsoid: { a: number; b: number }
): { x: number; y: number; z: number } {
  const { a, b } = ellipsoid;
  const eSq = (a * a - b * b) / (a * a);
  const nu = a / Math.sqrt(1 - eSq * Math.sin(phi) ** 2);
  return {
    x: nu * Math.cos(phi) * Math.cos(lambda),
    y: nu * Math.cos(phi) * Math.sin(lambda),
    z: (1 - eSq) * nu * Math.sin(phi),
  };
}

function helmert(p: { x: number; y: number; z: number }) {
  const secToRad = Math.PI / (180 * 3600);
  const rx = HELMERT.rx * secToRad;
  const ry = HELMERT.ry * secToRad;
  const rz = HELMERT.rz * secToRad;
  const s = HELMERT.s / 1e6;

  return {
    x: HELMERT.tx + p.x * (1 + s) - p.y * rz + p.z * ry,
    y: HELMERT.ty + p.x * rz + p.y * (1 + s) - p.z * rx,
    z: HELMERT.tz - p.x * ry + p.y * rx + p.z * (1 + s),
  };
}

function cartesianToGeodetic(
  p: { x: number; y: number; z: number },
  ellipsoid: { a: number; b: number }
): { phi: number; lambda: number } {
  const { a, b } = ellipsoid;
  const eSq = (a * a - b * b) / (a * a);
  const lambda = Math.atan2(p.y, p.x);
  const rho = Math.sqrt(p.x * p.x + p.y * p.y);

  // Iterate: latitude appears on both sides through the prime vertical radius.
  let phi = Math.atan2(p.z, rho * (1 - eSq));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - eSq * Math.sin(phi) ** 2);
    const next = Math.atan2(p.z + eSq * nu * Math.sin(phi), rho);
    if (Math.abs(next - phi) < 1e-12) {
      phi = next;
      break;
    }
    phi = next;
  }
  return { phi, lambda };
}

/** OSGB36 geodetic → National Grid, by the standard OS series expansion. */
function project(phi: number, lambda: number): GridReference {
  const { a, b } = AIRY;
  const { f0, lat0, lon0, e0, n0 } = GRID;
  const eSq = (a * a - b * b) / (a * a);
  const n = (a - b) / (a + b);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const nu = (a * f0) / Math.sqrt(1 - eSq * sinPhi ** 2);
  const rho = (a * f0 * (1 - eSq)) / (1 - eSq * sinPhi ** 2) ** 1.5;
  const etaSq = nu / rho - 1;

  const dPhi = phi - lat0;
  const sPhi = phi + lat0;
  const m =
    b *
    f0 *
    ((1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * dPhi -
      (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(dPhi) * Math.cos(sPhi) +
      ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) *
        Math.sin(2 * dPhi) *
        Math.cos(2 * sPhi) -
      (35 / 24) * n ** 3 * Math.sin(3 * dPhi) * Math.cos(3 * sPhi));

  const i = m + n0;
  const ii = (nu / 2) * sinPhi * cosPhi;
  const iii = (nu / 24) * sinPhi * cosPhi ** 3 * (5 - tanPhi ** 2 + 9 * etaSq);
  const iiiA = (nu / 720) * sinPhi * cosPhi ** 5 * (61 - 58 * tanPhi ** 2 + tanPhi ** 4);
  const iv = nu * cosPhi;
  const v = (nu / 6) * cosPhi ** 3 * (nu / rho - tanPhi ** 2);
  const vi =
    (nu / 120) *
    cosPhi ** 5 *
    (5 - 18 * tanPhi ** 2 + tanPhi ** 4 + 14 * etaSq - 58 * tanPhi ** 2 * etaSq);

  const dLon = lambda - lon0;

  return {
    northing:
      i + ii * dLon ** 2 + iii * dLon ** 4 + iiiA * dLon ** 6,
    easting: e0 + iv * dLon + v * dLon ** 3 + vi * dLon ** 5,
  };
}

/**
 * Format a grid reference the way the Ordnance Survey prints it, e.g. SS 619 873.
 * Used only for display, so a coordinate outside the lettered squares simply
 * returns null rather than throwing.
 */
export function gridToLetters(grid: GridReference, digits = 3): string | null {
  const { easting, northing } = grid;
  if (easting < 0 || easting >= 700000 || northing < 0 || northing >= 1300000) {
    return null;
  }

  const e100 = Math.floor(easting / 100000);
  const n100 = Math.floor(northing / 100000);

  /*
   * The Ordnance Survey lettering, indexed from a false origin two 500 km
   * squares west and one south of the grid origin. 'I' is not used, so any
   * index at or past it shifts up by one.
   */
  let first = 19 - n100 - ((19 - n100) % 5) + Math.floor((e100 + 10) / 5);
  let second = ((19 - n100) * 5) % 25 + (e100 % 5);
  if (first > 7) first++;
  if (second > 7) second++;
  if (first < 0 || first > 25 || second < 0 || second > 25) return null;

  const firstLetter = String.fromCharCode("A".charCodeAt(0) + first);
  const secondLetter = String.fromCharCode("A".charCodeAt(0) + second);

  const factor = 10 ** (5 - digits);
  const e = Math.floor((easting % 100000) / factor)
    .toString()
    .padStart(digits, "0");
  const n = Math.floor((northing % 100000) / factor)
    .toString()
    .padStart(digits, "0");
  return `${firstLetter}${secondLetter} ${e} ${n}`;
}
