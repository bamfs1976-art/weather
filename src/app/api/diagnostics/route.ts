import { NextRequest, NextResponse } from "next/server";
import {
  hasCredentials,
  probeMapLayer,
  probeMapStack,
  resolvePlace,
  xwFetch,
  breakerState,
  resetBreaker,
} from "@/lib/xweather";
import {
  getBathingWaters,
  getFloodWarnings,
  getMarineConditions,
  getRiverStations,
  getTideGauge,
} from "@/lib/water";
import { getPollen } from "@/lib/pollen";
import {
  getMetOfficeDaily,
  getMetOfficeHourly,
  getMetOfficeThreeHourly,
} from "@/lib/metoffice";
import { getMetNoForecast } from "@/lib/metno";
import { getAirQuality as getOpenMeteoAirQuality } from "@/lib/airquality";
import { getNowcast, getRecent as getOpenMeteoRecent } from "@/lib/openmeteo";
import { getSunMoon as computeSunMoon } from "@/lib/sunmoon";
import { getWeatherWarnings, regionFor } from "@/lib/warnings";
import { getAuroraStatus } from "@/lib/aurora";
import { getModelSpread, MODELS } from "@/lib/models";
import { getEnsemble, ENSEMBLES } from "@/lib/ensemble";
import { getClimateContext } from "@/lib/climate";
import { discoverDataHub } from "@/lib/metoffice-discovery";
import {
  BASE_LAYERS,
  DECORATION_LAYERS,
  MASK_LAYERS,
  WEATHER_OVERLAYS,
  WEATHER_VIEWS,
} from "@/lib/map-layers";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics?p=<location>[&maps=1]
 *
 * Calls every Xweather endpoint the app uses and reports which ones answered.
 * Xweather gates data sets by subscription tier, so this is the quickest way to
 * see what your key actually unlocks before wondering why a card is empty.
 *
 * **The raster probes are off by default, because this route was the single
 * most expensive thing on the site.** A full run costs about sixty-six
 * accesses — eighteen endpoint checks deliberately made with `revalidate: 0`,
 * plus thirty-seven per-layer probes and ten stack probes, each of which is a
 * map image and therefore its own access. Forty-seven of those sixty-six are
 * raster, and they answer a question ("do the layer tokens still resolve?")
 * that is asked once after changing a token and never again. Reaching for this
 * route is the correct instinct whenever a card looks wrong; paying for the
 * map probes every time that instinct fires is not. `?maps=1` runs them.
 */
export async function GET(request: NextRequest) {
  const place = request.nextUrl.searchParams.get("p")?.trim() || "51.6656,-3.9333";
  const probeMaps = request.nextUrl.searchParams.get("maps") === "1";

  /*
   * Always measure, never report a cached verdict. If a previous request tripped
   * the key-level breaker, this route's whole purpose is to find out whether
   * that is still true.
   */
  resetBreaker();

  if (!hasCredentials()) {
    return NextResponse.json(
      {
        credentials: false,
        error:
          "XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET are not set. Copy .env.example to .env and fill them in.",
      },
      { status: 503 }
    );
  }

  const loc = encodeURIComponent(place);
  /*
   * Every endpoint the app *could* reach, not every endpoint it now uses.
   *
   * The overview route makes exactly two Xweather calls — a place resolve and
   * the hourly forecast the comparison card needs — plus the raster maps. The
   * rest of this sweep is kept deliberately: knowing which data sets a key
   * unlocks is the question this route exists to answer, and it is worth
   * asking again on the day a plan changes or a card is brought back. It only
   * costs an access when someone runs it, which is the whole point of having
   * moved these off the per-load path.
   */
  const checks: { name: string; path: string; params?: Record<string, string> }[] = [
    { name: "places", path: `places/${loc}` },
    { name: "places/search", path: "places/search", params: { query: "name:^lond", limit: "3" } },
    { name: "conditions", path: `conditions/${loc}` },
    { name: "conditions (minutely)", path: `conditions/${loc}`, params: { filter: "1min", plimit: "5" } },
    { name: "conditions (past 24h)", path: `conditions/${loc}`, params: { from: "-24hours", to: "now", filter: "1hr", plimit: "5" } },
    { name: "conditions/summary", path: `conditions/summary/${loc}`, params: { from: "-7days", to: "-1day", filter: "day", plimit: "7" } },
    { name: "observations", path: `observations/${loc}` },
    { name: "observations/summary", path: `observations/summary/${loc}`, params: { from: "-7days", to: "-1day", plimit: "7" } },
    { name: "observations/archive", path: `observations/archive/${loc}`, params: { from: "-2days", to: "-2days", plimit: "5" } },
    { name: "forecasts (hourly)", path: `forecasts/${loc}`, params: { filter: "1hr", limit: "3" } },
    { name: "forecasts (daily)", path: `forecasts/${loc}`, params: { filter: "mdnt2mdnt", limit: "3" } },
    { name: "forecasts (day/night)", path: `forecasts/${loc}`, params: { filter: "daynight", limit: "3" } },
    { name: "alerts", path: `alerts/${loc}` },
    { name: "airquality", path: `airquality/${loc}` },
    { name: "airquality/forecasts", path: `airquality/forecasts/${loc}`, params: { filter: "1hr", limit: "3" } },
    { name: "sunmoon", path: `sunmoon/${loc}` },
    { name: "threats", path: `threats/${loc}` },
    { name: "lightning/summary", path: `lightning/summary/${loc}`, params: { radius: "50km", from: "-1hour", to: "now" } },
    { name: "phrases/summary", path: `phrases/summary/${loc}` },
    { name: "normals", path: `normals/${loc}`, params: { from: "-7days", to: "-1day", plimit: "7" } },
  ];

  const results = await Promise.all(
    checks.map(async (check) => {
      const section = await xwFetch(check.path, check.params ?? {}, 0);
      return {
        endpoint: check.name,
        ok: section.ok,
        code: section.code,
        message: section.error,
      };
    })
  );

  /*
   * The non-Xweather sources too, so one call tells you the state of every
   * upstream the app depends on.
   */
  const resolved = await resolvePlace(place);
  const point = resolved.ok && resolved.data
    ? { lat: resolved.data.lat, lon: resolved.data.lon }
    : null;

  const water = point
    ? await (async () => {
        /*
         * The Environment Agency calls go one at a time; only the other hosts
         * are run together.
         *
         * A different EA endpoint has timed out on each of the last three runs
         * — tide gauge, then floods, then stations+measures — never the same
         * one twice, and never all of them. That is the signature of a burst
         * being throttled, not of an endpoint being down, and it is the same
         * failure that took river levels out when the tide fetch briefly had
         * three fallback URLs. Firing four EA requests at once here recreates
         * it, so diagnostics has been reporting a fault of its own making.
         */
        const [marine, pollen, metoffice, metofficeDaily, metofficeThreeHourly, metno, warnings, aurora, spread, ensemble, climate] =
          await Promise.all([
            getMarineConditions(point.lat, point.lon),
            getPollen(point.lat, point.lon),
            getMetOfficeHourly(point.lat, point.lon),
            getMetOfficeDaily(point.lat, point.lon),
            getMetOfficeThreeHourly(point.lat, point.lon),
            getMetNoForecast(point.lat, point.lon, 6),
            getWeatherWarnings(point.lat, point.lon),
            getAuroraStatus(),
            getModelSpread(point.lat, point.lon, 6),
            getEnsemble(point.lat, point.lon, 6),
            getClimateContext(point.lat, point.lon),
          ]);
        const [air, nowcast, trailing] = await Promise.all([
          getOpenMeteoAirQuality(point.lat, point.lon, null, 24),
          getNowcast(point.lat, point.lon, null),
          getOpenMeteoRecent(point.lat, point.lon, null, 24),
        ]);
        const sun = computeSunMoon(point.lat, point.lon);

        const floods = await getFloodWarnings(point.lat, point.lon, 30);
        const rivers = await getRiverStations(point.lat, point.lon, 20, 2);
        const tides = await getTideGauge(point.lat, point.lon);
        const bathing = await getBathingWaters(point.lat, point.lon);
        return [
          {
            endpoint: "EA flood-monitoring: floods",
            ok: floods.ok, code: floods.code, message: floods.error,
            coverage: floods.data?.coverage ?? null,
            // False for the EA feed: England only, so an empty list is not an all-clear.
            authoritativeHere: floods.data?.authoritative ?? null,
            inForce: floods.data?.warnings.length ?? 0,
          },
          { endpoint: "EA flood-monitoring: stations + measures", ok: rivers.ok, code: rivers.code, message: rivers.error },
          { endpoint: "EA flood-monitoring: tide gauge", ok: tides.ok, code: tides.code, message: tides.error, via: tides.data?.via ?? null, readings: tides.data?.readings.length ?? 0 },
          { endpoint: "Defra/NRW bathing water quality", ok: bathing.ok, code: bathing.code, message: bathing.error, via: bathing.data?.[0]?.via ?? null, found: bathing.data?.length ?? 0 },
          { endpoint: "Open-Meteo Marine", ok: marine.ok, code: marine.code, message: marine.error },
          {
            endpoint: "Open-Meteo air quality (European AQI)",
            ok: air.ok, code: air.code, message: air.error,
            hours: air.data?.periods.length ?? 0,
            aqiNow: air.data?.periods[0]?.aqi ?? null,
          },
          {
            endpoint: "Open-Meteo nowcast (15-minute)",
            ok: nowcast.ok, code: nowcast.code, message: nowcast.error,
            steps: nowcast.data?.periods.length ?? 0,
          },
          {
            endpoint: "Open-Meteo trailing 24h",
            ok: trailing.ok, code: trailing.code, message: trailing.error,
            hours: trailing.data?.periods.length ?? 0,
          },
          {
            /* No upstream: pure arithmetic on the coordinates. Reported so a
             * wrong-looking sunrise can be told from a missing one. */
            endpoint: "Sun & moon (computed locally)",
            ok: sun.ok, code: sun.code, message: sun.error,
            sunrise: sun.data?.sun?.riseISO ?? null,
            sunset: sun.data?.sun?.setISO ?? null,
            moonPhase: sun.data?.moon?.phase?.name ?? null,
          },
          { endpoint: "Open-Meteo air quality (pollen)", ok: pollen.ok, code: pollen.code, message: pollen.error },
          {
            endpoint: "Met Office DataHub (site specific, hourly)",
            ok: metoffice.ok, code: metoffice.code, message: metoffice.error,
            /*
             * This is the app's primary forecast now, so the count matters as
             * much as the status: a successful request that parsed no hours
             * would leave the whole front of the dashboard quietly falling
             * back to Xweather, which is the failure this line exists to name.
             */
            hours: metoffice.data?.hours.length ?? 0,
            site: metoffice.data?.siteName ?? null,
            /*
             * The six fields that were being fetched and discarded. Dew point
             * is the one to watch: NowPanel reads it for a tile and two hints,
             * so a zero here is a visibly empty card rather than a subtlety.
             */
            hoursWithDewPoint:
              metoffice.data?.hours.filter((h) => h.dewPointC !== null).length ?? 0,
            hoursWithPrecipRate:
              metoffice.data?.hours.filter((h) => h.precipRateMMH !== null).length ?? 0,
          },
          {
            endpoint: "Met Office DataHub (site specific, daily)",
            ok: metofficeDaily.ok, code: metofficeDaily.code, message: metofficeDaily.error,
            days: metofficeDaily.data?.days.length ?? 0,
            /*
             * The daily field names could not be verified from the build
             * environment, so a request that succeeded while every value came
             * back null is the specific thing to watch for — that is a wrong
             * field name, not a wrong path. Counting the days that carry a
             * temperature separates the two without needing the raw body.
             */
            daysWithTemp:
              metofficeDaily.data?.days.filter((d) => d.maxTempC !== null).length ?? 0,
            /*
             * The confidence card and the per-type chances card each fall back
             * to something else when their fields are absent, so these two
             * counts are the only way to tell "the Met Office had nothing to
             * say" from "the field name is wrong".
             */
            daysWithBounds:
              metofficeDaily.data?.days.filter(
                (d) => d.maxTempBounds.lowerC !== null && d.maxTempBounds.upperC !== null
              ).length ?? 0,
            daysWithTypedProbabilities:
              metofficeDaily.data?.days.filter(
                (d) => d.day.rain !== null || d.day.sferics !== null
              ).length ?? 0,
          },
          {
            endpoint: "Met Office DataHub (site specific, three-hourly)",
            ok: metofficeThreeHourly.ok,
            code: metofficeThreeHourly.code,
            message: metofficeThreeHourly.error,
            steps: metofficeThreeHourly.data?.steps.length ?? 0,
            /*
             * A three-hourly step names its temperature differently from an
             * hourly one, so this count is what separates a working endpoint
             * from a working request full of nulls.
             */
            stepsWithTemp:
              metofficeThreeHourly.data?.steps.filter((s) => s.maxTempC !== null).length ?? 0,
          },
          {
            endpoint: "MET Norway locationforecast",
            ok: metno.ok, code: metno.code, message: metno.error,
            /*
             * This probe asks for 6 hours to stay cheap; the overview asks for
             * 48. Labelled because a bare "hours: 6" in the report reads as a
             * short forecast rather than a short *request*, and cost a round.
             */
            hoursRequested: 6,
            hoursReturned: metno.data?.hours.length ?? 0,
          },
          {
            endpoint: `Met Office warnings (region ${regionFor(point.lat, point.lon).id})`,
            ok: warnings.ok, code: warnings.code, message: warnings.error,
            via: warnings.data?.via ?? null,
            /*
             * Distinguishes "MeteoAlarm had nothing for this region today",
             * which is fine, from "MeteoAlarm is unreachable", which is a
             * fault the RSS fallback would otherwise hide indefinitely.
             */
            capReason: warnings.data?.capReason ?? null,
            /* Which candidate URL answered, so a working one can be kept and
               the dead ones deleted from METEOALARM_FEEDS. */
            capFeed: warnings.data?.capFeed ?? null,
            inForce: warnings.data?.warnings.length ?? 0,
          },
          { endpoint: "AuroraWatch UK", ok: aurora.ok, code: aurora.code, message: aurora.error, level: aurora.data?.level ?? null },
          {
            /*
             * Which model identifiers are real. They could not be verified from
             * the build environment, so anything listed as missing here every
             * time is a wrong name and should be deleted from MODELS rather
             * than left to fail quietly on every request.
             */
            endpoint: `Open-Meteo models (${MODELS.map((m) => m.id).join(", ")})`,
            ok: spread.ok, code: spread.code, message: spread.error,
            answered: spread.data?.models.map((m) => m.id) ?? [],
            missing: spread.data?.missing ?? null,
          },
          {
            endpoint: `Open-Meteo ensemble (${ENSEMBLES.map((e) => e.id).join(", ")})`,
            ok: ensemble.ok, code: ensemble.code, message: ensemble.error,
            answered: ensemble.data?.model ?? null,
            members: ensemble.data?.members ?? 0,
          },
          {
            endpoint: "Open-Meteo archive (ERA5, 1940-)",
            ok: climate.ok, code: climate.code, message: climate.error,
            years: climate.data?.yearsCompared ?? 0,
            through: climate.data?.lastDayISO ?? null,
          },
        ];
      })()
    : [];

  /*
   * Raster map layers, probed one at a time. The tokens are all valid names —
   * what this checks is subscription: the maps service is a separate host that
   * the data-endpoint checks above never touch, and a plan can serve some
   * layers while refusing others. Anything listed as broken here should be
   * taken out of the UI.
   */
  const MAP_LAYERS = [
    ...BASE_LAYERS,
    ...MASK_LAYERS,
    ...DECORATION_LAYERS,
    ...WEATHER_VIEWS.map((option) => option.id),
    ...WEATHER_OVERLAYS.map((option) => option.id),
  ];

  /*
   * Six at a time, not all thirty-seven.
   *
   * A different layer has timed out on each of the last two runs — maritime-sst
   * once, wind-dir the next — while every other layer passed and the stack
   * probes that use those same layers all succeeded. That pattern is the probe
   * saturating the maps host, not a layer being unavailable, and a report that
   * invents its own failures is worse than no report.
   *
   * This does not touch the Environment Agency timeouts: the phases here are
   * already sequential, so the raster probes run after the water calls have
   * finished and cannot have starved them.
   */
  const maps: Awaited<ReturnType<typeof probeMapLayer>>[] = [];
  if (point && probeMaps) {
    for (let i = 0; i < MAP_LAYERS.length; i += 6) {
      maps.push(
        ...(await Promise.all(
          MAP_LAYERS.slice(i, i + 6).map((layer) =>
            probeMapLayer(layer, point.lat, point.lon)
          )
        ))
      );
    }
  }

  /*
   * The stacks the map panel actually requests, fingerprinted. The per-layer
   * probe above pairs each code with a base — two layers — but the UI sends
   * five, and "every view looks the same" is a claim about whole stacks, not
   * about individual codes. If these hashes are all equal the service is
   * serving one picture regardless of what is asked for; if they differ, the
   * pictures are fine and the fault is in displaying them.
   */
  const stackViews = ["radar-global", "satellite-geocolor", "temperatures", "maritime-sst"];
  const mapStacks = point && probeMaps
    ? await Promise.all([
        ...stackViews.map((view) =>
          probeMapStack(
            `flat,water-depth,${view},countries-outlines,admin-cities`,
            point.lat,
            point.lon,
            7
          )
        ),
        // Same stack at a different zoom: proves zoom reaches the service.
        probeMapStack(
          "flat,water-depth,radar-global,countries-outlines,admin-cities",
          point.lat,
          point.lon,
          9
        ),
      ])
    : [];

  const hashes = mapStacks.filter((s) => s.hash).map((s) => s.hash);
  const distinctImages = new Set(hashes).size;
  /*
   * Sameness is judged against the stacks that actually returned an image, not
   * against the number attempted. Two of the five timed out on the last run and
   * the verdict compared 3 distinct hashes to 5 probes, announcing that the
   * service was serving one picture for every stack — the exact alarm that sent
   * five rounds after the map. Three distinct images from three answers is
   * perfect agreement.
   */
  const stacksAnswered = hashes.length;

  /*
   * The same stacks again, but through this app's own /api/map instead of
   * straight to Xweather. That route is the one link never yet measured in
   * production: the probe above proves the service sends distinct pictures,
   * so if these come back identical the proxy or the CDN in front of it is
   * collapsing them, and the browser was never at fault.
   */
  const origin = new URL(request.url).origin;
  const routeStacks = point && probeMaps
    ? await Promise.all(
        [...stackViews.map((view) => ({ view, zoom: 7 })), { view: "radar-global", zoom: 9 }].map(
          async ({ view, zoom }) => {
            const layers = `flat,water-depth,${view},countries-outlines,admin-cities`;
            const url =
              `${origin}/api/map/${encodeURIComponent(layers)}/${zoom}` +
              `/${point.lat.toFixed(4)},${point.lon.toFixed(4)}/current/300x200.png`;
            try {
              const res = await fetch(url, {
                cache: "no-store",
                signal: AbortSignal.timeout(12_000),
              });
              if (!res.ok) {
                return {
                  layers, zoom, ok: false, status: res.status, bytes: null, hash: null,
                  detail: (await res.text().catch(() => "")).slice(0, 160),
                };
              }
              const buffer = Buffer.from(await res.arrayBuffer());
              const { createHash } = await import("node:crypto");
              return {
                layers, zoom, ok: true, status: res.status, bytes: buffer.length,
                hash: createHash("sha1").update(buffer).digest("hex").slice(0, 12),
                detail: res.headers.get("X-Map-Layers"),
              };
            } catch (err) {
              return {
                layers, zoom, ok: false, status: null, bytes: null, hash: null,
                detail: err instanceof Error ? err.name : "fetch failed",
              };
            }
          }
        )
      )
    : [];

  const routeDistinct = new Set(routeStacks.filter((s) => s.hash).map((s) => s.hash)).size;

  /*
   * Met Office DataHub products: discovery, not a health check. None of these
   * request paths is documented anywhere reachable from the build environment,
   * so this asks each service where it lives rather than guessing a URL — the
   * answers are what the real clients get written against.
   */
  const metofficeProducts = await discoverDataHub();

  const all = [...results, ...water];

  return NextResponse.json(
    {
      credentials: true,
      location: place,
      available: all.filter((r) => r.ok).map((r) => r.endpoint),
      unavailable: all.filter((r) => !r.ok),
      results: all,
      /*
       * Named explicitly, because an empty `maps.working` list and a skipped
       * probe look identical otherwise — and "every layer is broken" is
       * exactly the alarm that sent five rounds after the map last time.
       */
      mapsProbed: probeMaps,
      maps: probeMaps
        ? {
            working: maps.filter((m) => m.ok).map((m) => m.layer),
            broken: maps.filter((m) => !m.ok),
          }
        : { skipped: "Add ?maps=1 to probe the raster layers (~47 extra accesses)." },
      /** Whether a key-level refusal was seen during this run. */
      keyBreaker: breakerState(),
      mapStacks: {
        /*
         * Equal to the number of stacks that answered when the service is
         * behaving. Anything less means separate requests came back
         * byte-identical, which is a real fault; a stack that timed out is not
         * one, and must not be counted as sameness.
         */
        distinctImages,
        answered: stacksAnswered,
        probed: mapStacks.length,
        verdict:
          mapStacks.length === 0
            ? "not probed"
            : stacksAnswered === 0
              ? "no stack answered — nothing can be concluded about sameness"
              : distinctImages === stacksAnswered
                ? `service returns a different image per stack (${distinctImages}/${stacksAnswered} answered) — any sameness on screen is a display fault`
                : "service returned identical bytes for different stacks — the fault is upstream, not in the browser",
        results: mapStacks,
      },
      metofficeProducts,
      routeStacks: {
        distinctImages: routeDistinct,
        probed: routeStacks.length,
        verdict:
          routeStacks.length === 0
            ? "not probed"
            : routeDistinct === routeStacks.length
              ? "the proxy route also returns a different image per stack — the whole server path is sound"
              : "the proxy route collapsed different stacks to identical bytes — the fault is the route or its cache, not the browser",
        results: routeStacks,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
