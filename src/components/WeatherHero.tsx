"use client";

import { useEffect, useState } from "react";
import { ConditionIcon } from "./icons";
import {
  classifyCondition,
  clockAt,
  dash,
  formatPercent,
  formatSpeed,
  formatTemp,
  formatDistance,
  isNum,
  skyMotion,
  skyToken,
  tzOffsetMinutes,
  uviCategory,
  leadForecast,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";

/**
 * The band across the top of the Now tab.
 *
 * Everything here is driven by one classified condition: the gradient, which
 * icon is drawn, whether it is the day or night form, and which animated layer
 * sits over the gradient. The band always paints light type on a dark sky in
 * both themes — a hero that inverted with the theme would need two sets of
 * gradients and two contrast checks, and would stop looking like weather.
 */
export function WeatherHero({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const { sections, place } = overview;
  /*
   * The Met Office's numbers when it answered, Xweather's when it did not.
   * Both arrive as WeatherPeriod, so nothing below this line knows which.
   */
  const lead = leadForecast(sections);
  const current = lead.current;
  const today = lead.daily[0] ?? null;
  const condition = classifyCondition(current?.icon, current?.weatherPrimaryCoded);
  const motion = skyMotion(condition);
  const offset =
    tzOffsetMinutes(current?.dateTimeISO) ??
    (isNum(place.tzoffset) ? place.tzoffset / 60 : null);
  const pop = sections.hourly?.data?.periods?.[0]?.pop ?? null;
  const uv = uviCategory(current?.uvi);

  return (
    <section
      className="wx-hero"
      style={{ backgroundImage: `var(${skyToken(condition)})` }}
    >
      {motion !== "none" && <span className={`wx-sky-layer wx-sky-${motion}`} aria-hidden />}

      <div className="wx-hero-inner">
        <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            {/*
              The location is the page's h1: it is what the whole screen is
              about, and a screen-reader user landing here should hear it first.
            */}
            <h1 className="wx-hero-place">{place.displayName}</h1>
            <p className="wx-hero-time">
              {offset !== null ? <LocalClock offsetMinutes={offset} hour12={hour12} /> : null}
            </p>
          </div>

          <ConditionIcon
            kind={condition.kind}
            night={condition.night}
            size={64}
            className="wx-hero-icon shrink-0"
            title={current?.weather ?? current?.weatherPrimary ?? undefined}
          />
        </div>

        <div className="wx-hero-temp-row">
          <span className="wx-hero-temp wx-num">
            {formatTemp(current?.tempC, current?.tempF, units)}
          </span>
        </div>

        <p className="wx-hero-condition">
          {current?.weather ?? current?.weatherPrimary ?? dash}
        </p>

        {/*
          * Who these numbers belong to, and how near the point they describe
          * actually is. This moved here from the Met Office tab when that tab
          * was folded away: provenance belongs against the number it qualifies,
          * and the Met Office forecasts a grid point rather than the exact
          * coordinates, so "1.4 km away" is a real caveat on the temperature
          * above it rather than trivia.
          */}
        {lead.source && (
          <p className="wx-hero-source wx-dim text-xs">
            {lead.source}
            {lead.siteName ? ` · ${lead.siteName}` : ""}
            {isNum(lead.distanceKM)
              ? ` · ${formatDistance(lead.distanceKM, lead.distanceKM * 0.621371, units)} away`
              : ""}
          </p>
        )}

        <div className="wx-hero-facts">
          <span>
            Feels like{" "}
            <strong className="wx-num">
              {formatTemp(current?.feelslikeC, current?.feelslikeF, units)}
            </strong>
          </span>
          {(isNum(today?.maxTempC) || isNum(today?.minTempC)) && (
            <span>
              H <strong className="wx-num">{formatTemp(today?.maxTempC, today?.maxTempF, units)}</strong>
              {"  "}
              L <strong className="wx-num">{formatTemp(today?.minTempC, today?.minTempF, units)}</strong>
            </span>
          )}
          {isNum(current?.windSpeedKPH) && (
            <span>
              Wind{" "}
              <strong className="wx-num">
                {formatSpeed(current.windSpeedKPH, current.windSpeedMPH, units)}
              </strong>
              {current.windDir ? ` ${current.windDir}` : ""}
            </span>
          )}
          {isNum(pop) && pop > 0 && (
            <span>
              Rain <strong className="wx-num">{formatPercent(pop)}</strong>
            </span>
          )}
          {isNum(current?.uvi) && current.uvi > 0 && (
            <span>
              UV <strong className="wx-num">{current.uvi.toFixed(0)}</strong> {uv.label}
            </span>
          )}
        </div>

      </div>
    </section>
  );
}

/**
 * A clock in the location's own offset.
 *
 * It renders nothing on the server and on the first client paint, because the
 * time depends on when you look at it: rendering it during SSR guarantees a
 * hydration mismatch and a minute-stale first frame.
 */
function LocalClock({
  offsetMinutes,
  hour12,
}: {
  offsetMinutes: number;
  hour12: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;
  return <>{clockAt(now, offsetMinutes, hour12)}</>;
}
