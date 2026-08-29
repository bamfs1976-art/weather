import { NextRequest, NextResponse } from "next/server";
import {
  getHourlyForecast,
  hasCredentials,
  httpStatusForCode,
  resolvePlace,
} from "@/lib/xweather";
import { resolvePlaceKeyless } from "@/lib/geocode";
import { getPollen } from "@/lib/pollen";
import {
  getMetOfficeDaily,
  getMetOfficeHourly,
  getMetOfficeThreeHourly,
} from "@/lib/metoffice";
import {
  metOfficeCurrent,
  metOfficeDayNightPeriods,
  metOfficeToDailyPeriods,
  metOfficeToPeriods,
  metOfficeToStepPeriods,
} from "@/lib/metoffice-periods";
import { getMetNoForecast } from "@/lib/metno";
import { getAirQuality as getOpenMeteoAirQuality } from "@/lib/airquality";
import { getNowcast, getRecent as getOpenMeteoRecent } from "@/lib/openmeteo";
import { getSunMoon as computeSunMoon } from "@/lib/sunmoon";
import { getWeatherWarnings } from "@/lib/warnings";
import { getAuroraStatus } from "@/lib/aurora";
import { getModelSpread } from "@/lib/models";
import { getEnsemble } from "@/lib/ensemble";
import type { OverviewSections, WeatherOverview } from "@/lib/weather-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/overview?p=<location>
 *
 * Fans out to every Xweather data set the dashboard uses, plus the CAMS pollen
 * forecast, and returns them in a single payload. Each data set is wrapped in a Section, so an endpoint that is
 * missing from the caller's subscription degrades to an inline notice instead
 * of failing the whole request.
 */
export async function GET(request: NextRequest) {
  const place = request.nextUrl.searchParams.get("p")?.trim();

  if (!place) {
    return NextResponse.json(
      { error: "Missing required 'p' (place) query parameter." },
      { status: 400 }
    );
  }

  /*
   * No Xweather credentials is no longer fatal.
   *
   * This gate dates from when Xweather supplied every number on the page.
   * It now supplies the maps and the second opinion, so refusing to build the
   * dashboard without it fails eight working upstreams for the sake of one.
   * The comparison section degrades to its notice like any other, which is
   * what convention 3 is for.
   */

  /*
   * Resolve keylessly first, and only fall back to Xweather.
   *
   * Every section below is fetched for these coordinates, so a failure here
   * blanks the whole page — which is exactly what happened when the Xweather
   * key was paused: a dashboard whose numbers now come from the Met Office,
   * Open-Meteo and the Environment Agency went dark because it could not ask
   * Xweather where Swansea was. Geocoding is neither a map nor a second
   * opinion, so it does not belong on the one provider that is rationed.
   *
   * Xweather still gets a turn last, because it resolves identifiers
   * Open-Meteo will not — an airport code, say. It is skipped entirely when
   * its credentials are absent or its breaker is open, so a paused key costs
   * nothing here.
   */
  let resolved = await resolvePlaceKeyless(place);
  if ((!resolved.ok || !resolved.data) && hasCredentials()) {
    const viaXweather = await resolvePlace(place);
    if (viaXweather.ok && viaXweather.data) resolved = viaXweather;
  }
  if (!resolved.ok || !resolved.data) {
    return NextResponse.json(
      { error: resolved.error ?? "Could not resolve that location." },
      { status: httpStatusForCode(resolved.code) }
    );
  }

  // Use the resolved coordinates for every subsequent call so all sections
  // describe exactly the same point on the map.
  const point = `${resolved.data.lat},${resolved.data.lon}`;

  /* The location's own UTC offset, so every converted source reads local. */
  const offsetMinutes =
    typeof resolved.data.tzoffset === "number"
      ? Math.round(resolved.data.tzoffset / 60)
      : null;

  const [
    hourly,
    minutely,
    recent,
    airQuality,
    pollen,
    metoffice,
    metofficeDaily,
    metofficeThreeHourly,
    metno,
    warnings,
    aurora,
    modelSpread,
    ensemble,
  ] = await Promise.all([
    /*
     * The only Xweather call left on this route.
     *
     * Xweather does two jobs now: the raster maps, which nothing else here can
     * do, and this — the second opinion the comparison card is built on. Every
     * other data set it used to supply either moved to the Met Office (which
     * publishes it better for the UK) or to a keyless source that was already
     * being called. That took the route from fifteen Xweather accesses a load
     * to two, counting the place resolve.
     *
     * It is deliberately the *forecast* rather than current conditions: the
     * comparison matches by absolute instant across a 48-hour window, so a
     * single observation would give it one point to compare.
     */
    getHourlyForecast(point, 48),
    getNowcast(
      resolved.data.lat,
      resolved.data.lon,
      offsetMinutes
    ),
    getOpenMeteoRecent(resolved.data.lat, resolved.data.lon, offsetMinutes, 24),
    getOpenMeteoAirQuality(resolved.data.lat, resolved.data.lon, offsetMinutes, 48),
    getPollen(resolved.data.lat, resolved.data.lon, offsetMinutes),
    getMetOfficeHourly(resolved.data.lat, resolved.data.lon),
    getMetOfficeDaily(resolved.data.lat, resolved.data.lon),
    getMetOfficeThreeHourly(resolved.data.lat, resolved.data.lon),
    /*
     * Four more upstreams, all keyless and all on hosts nothing else here
     * touches, so they add no load to a service already being asked for
     * something. Each is its own Section: a dead one blanks its card.
     */
    getMetNoForecast(resolved.data.lat, resolved.data.lon, 48),
    getWeatherWarnings(resolved.data.lat, resolved.data.lon),
    getAuroraStatus(),
    getModelSpread(resolved.data.lat, resolved.data.lon, 48),
    getEnsemble(resolved.data.lat, resolved.data.lon, 48),
  ]);

  /*
   * The forecast the page leads with, converted once here.
   *
   * Deriving it on the server rather than in each panel means the payload
   * carries a single shape and the fallback is decided in one place: when the
   * Met Office section failed, this one carries its error and the panels drop
   * back to the Xweather sections exactly as they always rendered.
   */
  /*
   * Day and night now come out of the Met Office daily response, which already
   * splits every measurement into the two halves this strip wants. That is one
   * fewer Xweather call on every dashboard load for a card that reads better
   * for it — each half carries its own condition and probability rather than
   * repeating the day's.
   */
  const dayNight: WeatherOverview["sections"]["dayNight"] =
    metofficeDaily.ok && metofficeDaily.data
      ? {
          ok: true,
          data: { periods: metOfficeDayNightPeriods(metofficeDaily.data) },
          error: null,
          code: null,
        }
      : {
          ok: false,
          data: null,
          error: metofficeDaily.error,
          code: metofficeDaily.code,
        };

  const primary: WeatherOverview["sections"]["primary"] =
    metoffice.ok && metoffice.data
      ? {
          ok: true,
          data: {
            source: "metoffice" as const,
            siteName: metoffice.data.siteName,
            distanceKM: metoffice.data.distanceKM,
            modelRunISO: metoffice.data.modelRunISO,
            current: metOfficeCurrent(metoffice.data),
            hourly: metOfficeToPeriods(metoffice.data),
            daily:
              metofficeDaily.ok && metofficeDaily.data
                ? metOfficeToDailyPeriods(metofficeDaily.data)
                : [],
            /*
             * The week at three-hour resolution. The hourly action stops at 48
             * hours; this is the only site-specific action that goes further
             * without dropping to whole days, and it shares the same free
             * allowance.
             */
            threeHourly:
              metofficeThreeHourly.ok && metofficeThreeHourly.data
                ? metOfficeToStepPeriods(metofficeThreeHourly.data)
                : [],
          },
          error: null,
          code: null,
        }
      : {
          ok: false,
          data: null,
          error: metoffice.error,
          code: metoffice.code,
        };

  /*
   * Sun and moon are computed rather than fetched — see lib/sunmoon.ts. It
   * sits outside the fan-out above because there is nothing to await: it is
   * arithmetic on the resolved coordinates, which is why it costs nothing and
   * cannot fail upstream.
   */
  const sunMoon = computeSunMoon(resolved.data.lat, resolved.data.lon);

  const payload: WeatherOverview = {
    place: resolved.data,
    fetchedAt: new Date().toISOString(),
    sections: {
      /*
       * What is gone from here matters as much as what is left.
       *
       * `current`, `observation`, `daily`, `alerts`, `threats`, `lightning`,
       * `phrase` and `airQualityForecast` were all Xweather and are all
       * retired: the forecast ones because the Met Office publishes them
       * better for the UK, the alerts because NSWWS is the authoritative UK
       * publisher and Xweather's NWS-derived network returned nothing here
       * anyway, and the rest because a keyless source already in the app
       * covers them. The section map is Partial by design, so a consumer that
       * still reaches for one gets undefined and renders its notice rather
       * than breaking — which is the whole point of convention 4.
       */
      minutely,
      hourly,
      dayNight,
      airQuality,
      sunMoon,
      recent,
      pollen,
      metoffice,
      metofficeDaily,
      metofficeThreeHourly,
      primary,
      metno,
      warnings,
      aurora,
      modelSpread,
      ensemble,
    } satisfies OverviewSections,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
