/**
 * Geohash encoding.
 *
 * The Met Office land observations API addresses a location by geohash rather
 * than by latitude and longitude — `/observation-land/1/{geohash}`, and it
 * insists on exactly six characters. Six is about 1.2 km by 0.6 km at UK
 * latitudes, which is finer than the ~50 km spacing of the observing network,
 * so the cell only has to land the request in roughly the right place.
 *
 * Twenty lines, no dependency. The algorithm is a binary search that alternates
 * between longitude and latitude, one bit at a time, packing five bits per
 * base32 character.
 */

/* Geohash uses its own base32 alphabet: no "a", "i", "l" or "o". */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lon: number, precision = 6): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = "";
  let bits = 0;
  let value = 0;
  // Longitude is bisected first, then they alternate.
  let evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        value = value * 2 + 1;
        lonMin = mid;
      } else {
        value = value * 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value = value * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;

    if (++bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }

  return hash;
}
