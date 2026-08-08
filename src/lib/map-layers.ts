/**
 * Xweather raster layer vocabulary.
 *
 * Every token here was read back from Xweather's own map-URL builder rather
 * than guessed from the documentation. That distinction matters: several
 * plausible-looking names are wrong ("satellite", "countries", "fires",
 * "air-quality-index"), and because a rejected token fails the *whole* image
 * rather than just its own layer, one wrong guess takes the entire map down
 * regardless of what else is selected. Treat this file as the single source of
 * truth — the proxy route and the UI both read from it so they cannot drift.
 */

/** Full-coverage backgrounds. Exactly one belongs in a stack. */
export const BASE_LAYERS = [
  "flat",
  "flat-dk",
  "blue-marble",
  "terrain",
  "terrain-dk",
] as const;

/**
 * Land/water masks. They only reshape the base map, so they are safe to drop
 * if the upstream rejects a stack.
 */
export const MASK_LAYERS = [
  "water-depth",
  "water-flat",
  "land-flat",
  "land-blue-marble",
  "land-terrain",
] as const;

/** Borders, labels and roads — decoration, also safe to drop. */
export const DECORATION_LAYERS = [
  "admin",
  "admin-dk",
  "admin-cities",
  "admin-cities-dk",
  "states",
  "countries-outlines",
  "counties",
  "interstates",
  "roads",
] as const;

export type LayerOption = { id: string; label: string; hint: string };

/**
 * Opaque, full-coverage weather fields. Stacking two of these just hides the
 * lower one, so the UI lets only one be active at a time.
 */
export const WEATHER_VIEWS: LayerOption[] = [
  { id: "radar-global", label: "Radar", hint: "Global precipitation radar mosaic" },
  { id: "satellite-geocolor", label: "Satellite", hint: "GeoColor satellite imagery" },
  { id: "temperatures", label: "Temperature", hint: "Surface temperature field" },
  { id: "dew-points", label: "Dew point", hint: "Surface dew point field" },
  { id: "humidity", label: "Humidity", hint: "Relative humidity field" },
  { id: "wind-speeds", label: "Wind speed", hint: "Surface wind speed field" },
  { id: "heat-index", label: "Heat index", hint: "Apparent temperature in warm weather" },
  { id: "wind-chill", label: "Wind chill", hint: "Apparent temperature in cold weather" },
  {
    id: "air-quality-index-categories",
    label: "Air quality",
    hint: "Air quality index, banded by category",
  },
  { id: "maritime-sst", label: "Sea temp", hint: "Sea surface temperature" },
  { id: "maritime-wave-heights", label: "Wave height", hint: "Significant wave height" },
];

/**
 * Sparse layers that draw only where the phenomenon exists, so several can
 * sensibly sit on top of a view at once.
 */
export const WEATHER_OVERLAYS: LayerOption[] = [
  { id: "alerts", label: "Alerts", hint: "Government watches, warnings and advisories" },
  { id: "stormcells", label: "Storm cells", hint: "Tracked convective cells" },
  { id: "lightning-all", label: "Lightning", hint: "Recent lightning strikes" },
  { id: "wind-dir", label: "Wind arrows", hint: "Surface wind direction barbs" },
  { id: "maritime-currents", label: "Currents", hint: "Modelled ocean surface currents" },
  { id: "fires-obs-points", label: "Wildfires", hint: "Active fire detections" },
  { id: "tropical-cyclones", label: "Tropical", hint: "Active tropical systems and tracks" },
];

/**
 * Everything the proxy will accept. The credentials are interpolated into the
 * upstream URL path, so this doubles as the injection guard and must stay an
 * exact-match allow-list rather than a pattern.
 */
export const ALLOWED_LAYERS: ReadonlySet<string> = new Set<string>([
  ...BASE_LAYERS,
  ...MASK_LAYERS,
  ...DECORATION_LAYERS,
  ...WEATHER_VIEWS.map((option) => option.id),
  ...WEATHER_OVERLAYS.map((option) => option.id),
  // Named tropical tracks are only ever requested alongside tropical-cyclones,
  // so it has no button of its own.
  "tropical-cyclones-names",
]);

/** Droppable when the upstream refuses a stack: nothing here carries data. */
export const DROPPABLE_LAYERS: ReadonlySet<string> = new Set<string>([
  ...MASK_LAYERS,
  ...DECORATION_LAYERS,
]);

export const BASE_LAYER_SET: ReadonlySet<string> = new Set<string>(BASE_LAYERS);
