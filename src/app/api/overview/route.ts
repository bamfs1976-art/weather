import { NextRequest, NextResponse } from "next/server";
import {
  getAirQuality,
  getAirQualityForecast,
  getAlerts,
  getCurrentConditions,
  getDailyForecast,
  getDayNightForecast,
  getHourlyForecast,
  getLightningSummary,
  getMinutely,
  getObservation,
  getPhrase,
  getRecentConditions,
  getSunMoon,
  getThreats,
  hasCredentials,
  httpStatusForCode,
  resolvePlace,
} from "@/lib/xweather";
import { getPollen } from "@/lib/pollen";
import { getMetOfficeDaily, getMetOfficeHourly } from "@/lib/metoffice";
import {
  metOfficeCurrent,
  metOfficeToDailyPeriods,
  metOfficeToPeriods,
} from "@/lib/metoffice-periods";
import { getMetNoForecast } from "@/lib/metno";
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

  if (!hasCredentials()) {
    return NextResponse.json(
      {
        error:
          "Xweather credentials are not configured. Copy .env.example to .env and set XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET.",
      },
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

  // Use the resolved coordinates for every subsequent call so all sections
  // describe exactly the same point on the map.
  const point = `${resolved.data.lat},${resolved.data.lon}`;

  const [
    current,
    observation,
    minutely,
    hourly,
    daily,
    dayNight,
    alerts,
    airQuality,
    airQualityForecast,
    sunMoon,
    threats,
    lightning,
    phrase,
    recent,
    pollen,
    metoffice,
    metofficeDaily,
    metno,
    warnings,
    aurora,
    modelSpread,
    ensemble,
  ] = await Promise.all([
    getCurrentConditions(point),
    getObservation(point),
    getMinutely(point),
    getHourlyForecast(point, 48),
    getDailyForecast(point, 10),
    getDayNightForecast(point, 14),
    getAlerts(point),
    getAirQuality(point),
    getAirQualityForecast(point, 24),
    getSunMoon(point),
    getThreats(point),
    getLightningSummary(point, 50),
    getPhrase(point),
    getRecentConditions(point, 24),
    getPollen(
      resolved.data.lat,
      resolved.data.lon,
      typeof resolved.data.tzoffset === "number"
        ? Math.round(resolved.data.tzoffset / 60)
        : null
    ),
    getMetOfficeHourly(resolved.data.lat, resolved.data.lon),
    getMetOfficeDaily(resolved.data.lat, resolved.data.lon),
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

  const payload: WeatherOverview = {
    place: resolved.data,
    fetchedAt: new Date().toISOString(),
    sections: {
      current,
      observation,
      minutely,
      hourly,
      daily,
      dayNight,
      alerts,
      airQuality,
      airQualityForecast,
      sunMoon,
      threats,
      lightning,
      phrase,
      recent,
      pollen,
      metoffice,
      metofficeDaily,
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
