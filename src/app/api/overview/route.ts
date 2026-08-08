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
import type { WeatherOverview } from "@/lib/weather-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/overview?p=<location>
 *
 * Fans out to every Xweather data set the dashboard uses and returns them in a
 * single payload. Each data set is wrapped in a Section, so an endpoint that is
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
  ]);

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
    },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
