"use client";

import { useEffect, useState } from "react";
import { Card, Chip, Meter, Metric, Notice, SectionBody, WindArrow } from "./ui";
import { SeriesChart } from "./Chart";
import {
  clockAt,
  dash,
  formatDistance,
  formatHeight,
  formatNumber,
  formatPercent,
  formatPrecip,
  formatPressure,
  formatSnow,
  formatSpeed,
  formatTemp,
  formatTime,
  isNum,
  pressureTrend,
  relativeFromNow,
  tzOffsetMinutes,
  uviCategory,
  weatherEmoji,
  windDescription,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";

export function NowPanel({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const { sections, place } = overview;
  const current = sections.current.data?.periods?.[0] ?? null;
  const observation = sections.observation.data;
  const ob = observation?.ob ?? null;
  const sun = sections.sunMoon.data?.sun ?? null;
  const recentPeriods = sections.recent.data?.periods ?? [];
  const trend = pressureTrend(recentPeriods);
  const offset =
    tzOffsetMinutes(current?.dateTimeISO) ??
    (isNum(place.tzoffset) ? place.tzoffset / 60 : null);

  const uv = uviCategory(current?.uvi);
  const todayPop = sections.hourly.data?.periods?.[0]?.pop ?? null;

  return (
    <div className="space-y-4">
      <AlertsBlock overview={overview} hour12={hour12} />

      <section className="wx-card overflow-hidden">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Hero */}
          <div>
            <div className="wx-muted flex flex-wrap items-center gap-2 text-sm">
              <span>{place.displayName}</span>
              {offset !== null && (
                <>
                  <span className="wx-dim">·</span>
                  <LocalClock offsetMinutes={offset} hour12={hour12} />
                </>
              )}
            </div>

            {current ? (
              <>
                <div className="mt-3 flex items-start gap-4">
                  <span className="text-6xl leading-none sm:text-7xl" aria-hidden>
                    {weatherEmoji(current.icon, current.weatherPrimaryCoded)}
                  </span>
                  <div>
                    <div className="text-6xl font-light leading-none tracking-tight sm:text-7xl">
                      {formatTemp(current.tempC, current.tempF, units)}
                    </div>
                    <div className="wx-muted mt-1 text-sm">
                      Feels like{" "}
                      <span className="text-slate-200">
                        {formatTemp(current.feelslikeC, current.feelslikeF, units)}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-lg">
                  {current.weather ?? current.weatherPrimary ?? dash}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {isNum(current.windSpeedKPH) && (
                    <Chip tone="accent">
                      <WindArrow deg={current.windDirDEG} />
                      {current.windDir ?? ""}{" "}
                      {formatSpeed(current.windSpeedKPH, current.windSpeedMPH, units)}
                    </Chip>
                  )}
                  {isNum(todayPop) && todayPop > 0 && (
                    <Chip tone="accent">☔ {formatPercent(todayPop)} chance</Chip>
                  )}
                  {isNum(current.uvi) && (
                    <Chip tone={current.uvi >= 6 ? "warn" : "default"}>
                      UV {current.uvi.toFixed(0)} · {uv.label}
                    </Chip>
                  )}
                  {ob?.flightRule && (
                    <Chip
                      tone={
                        ob.flightRule === "VFR"
                          ? "good"
                          : ob.flightRule === "MVFR"
                            ? "accent"
                            : "warn"
                      }
                      title="Aviation flight rules at the reporting station"
                    >
                      {ob.flightRule}
                    </Chip>
                  )}
                </div>
              </>
            ) : (
              <Notice tone="warn">
                {sections.current.error ?? "Current conditions unavailable."}
              </Notice>
            )}

            {sections.phrase.data?.periods?.[0]?.text && (
              <p className="wx-muted mt-4 border-l-2 border-sky-400/40 pl-3 text-sm leading-relaxed">
                {sections.phrase.data.periods[0].text}
              </p>
            )}
          </div>

          {/* Sun + headline numbers */}
          <div className="grid grid-cols-2 gap-2 self-start sm:grid-cols-3">
            <Metric
              label="Dew point"
              icon="💧"
              value={formatTemp(current?.dewpointC, current?.dewpointF, units)}
              hint={humidityComfort(current?.dewpointC)}
            />
            <Metric
              label="Humidity"
              icon="🌫️"
              value={formatPercent(current?.humidity)}
            />
            <Metric
              label="Pressure"
              icon="🎚️"
              value={formatPressure(current?.pressureMB, current?.pressureIN, units)}
              hint={
                trend
                  ? `${trend.direction} ${Math.abs(trend.changeMB).toFixed(1)} mb/24h`
                  : undefined
              }
            />
            <Metric
              label="Visibility"
              icon="👁️"
              value={formatDistance(
                current?.visibilityKM,
                current?.visibilityMI,
                units
              )}
            />
            <Metric
              label="Cloud cover"
              icon="☁️"
              value={formatPercent(current?.sky)}
            />
            <Metric
              label="Ceiling"
              icon="🛫"
              value={
                isNum(current?.ceilingFT) || isNum(current?.ceilingM)
                  ? formatHeight(current?.ceilingM, current?.ceilingFT, units)
                  : "Unlimited"
              }
            />
            <Metric
              label="Sunrise"
              icon="🌅"
              value={formatTime(sun?.riseISO, hour12)}
              hint={
                sun?.twilight?.civilBeginISO
                  ? `Dawn ${formatTime(sun.twilight.civilBeginISO, hour12)}`
                  : undefined
              }
            />
            <Metric
              label="Sunset"
              icon="🌇"
              value={formatTime(sun?.setISO, hour12)}
              hint={
                sun?.twilight?.civilEndISO
                  ? `Dusk ${formatTime(sun.twilight.civilEndISO, hour12)}`
                  : undefined
              }
            />
            <Metric
              label="Elevation"
              icon="⛰️"
              value={formatHeight(place.elevM, place.elevFT, units)}
            />
          </div>
        </div>
      </section>

      <MinutelyBlock overview={overview} units={units} hour12={hour12} />

      <Card
        title="Full conditions"
        subtitle="Interpolated for the exact coordinates, blending station, radar and model data"
      >
        <SectionBody section={sections.current}>
          {() => (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Metric
                label="Wind"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <WindArrow deg={current?.windDirDEG} />
                    {formatSpeed(
                      current?.windSpeedKPH,
                      current?.windSpeedMPH,
                      units
                    )}
                  </span>
                }
                hint={`${current?.windDir ?? dash} ${
                  isNum(current?.windDirDEG) ? `(${current?.windDirDEG}°)` : ""
                } · ${windDescription(current?.windSpeedKPH)}`}
              />
              <Metric
                label="Gusts"
                value={formatSpeed(current?.windGustKPH, current?.windGustMPH, units)}
              />
              <Metric
                label="Heat index"
                value={formatTemp(current?.heatindexC, current?.heatindexF, units)}
              />
              <Metric
                label="Wind chill"
                value={formatTemp(current?.windchillC, current?.windchillF, units)}
              />
              <Metric
                label="Wet bulb"
                value={formatTemp(current?.wetBulbC, current?.wetBulbF, units)}
              />
              <Metric
                label="UV index"
                value={
                  <span>
                    {formatNumber(current?.uvi)}{" "}
                    <span className="text-sm font-normal" style={{ color: uv.color }}>
                      {uv.label}
                    </span>
                  </span>
                }
              />
              <Metric
                label="Solar radiation"
                value={formatNumber(current?.solradWM2, " W/m²")}
              />
              <Metric
                label="Precip (last hr)"
                value={formatPrecip(current?.precipMM, current?.precipIN, units)}
              />
              <Metric
                label="Precip rate"
                value={
                  isNum(current?.precipRateMM)
                    ? `${formatPrecip(current?.precipRateMM, current?.precipRateIN, units)}/hr`
                    : dash
                }
              />
              <Metric
                label="Snow depth"
                value={formatSnow(current?.snowDepthCM, current?.snowDepthIN, units)}
              />
              <Metric
                label="Ice accretion"
                value={formatPrecip(current?.iceaccumMM, current?.iceaccumIN, units)}
              />
              <Metric
                label="Sea-level pressure"
                value={formatPressure(
                  current?.altimeterMB ?? current?.pressureMB,
                  current?.altimeterIN ?? current?.pressureIN,
                  units
                )}
              />
            </div>
          )}
        </SectionBody>

        <div className="mt-3">
          <div className="wx-muted mb-1 flex justify-between text-xs">
            <span>Humidity</span>
            <span>{formatPercent(current?.humidity)}</span>
          </div>
          <Meter value={current?.humidity ?? null} label="Relative humidity" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Nearest reporting station"
          subtitle="Raw observation behind the interpolated numbers above"
        >
          <SectionBody section={sections.observation}>
            {(data) => (
              <div className="space-y-3">
                <div>
                  <div className="text-base font-medium">
                    {data.place?.name
                      ? data.place.name.replace(/\b\w/g, (c) => c.toUpperCase())
                      : data.id}
                  </div>
                  <div className="wx-muted text-xs">
                    Station {data.id}
                    {data.relativeTo &&
                      ` · ${formatDistance(
                        data.relativeTo.distanceKM,
                        data.relativeTo.distanceMI,
                        units
                      )} ${data.relativeTo.bearingENG} of you`}
                    {data.ob?.dateTimeISO &&
                      ` · reported ${relativeFromNow(data.ob.dateTimeISO)}`}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric
                    label="Temp"
                    value={formatTemp(data.ob?.tempC, data.ob?.tempF, units)}
                  />
                  <Metric
                    label="Dew point"
                    value={formatTemp(data.ob?.dewpointC, data.ob?.dewpointF, units)}
                  />
                  <Metric
                    label="Wind"
                    value={formatSpeed(
                      data.ob?.windSpeedKPH,
                      data.ob?.windSpeedMPH,
                      units
                    )}
                  />
                  <Metric
                    label="Pressure"
                    value={formatPressure(
                      data.ob?.pressureMB,
                      data.ob?.pressureIN,
                      units
                    )}
                  />
                  <Metric
                    label="Visibility"
                    value={formatDistance(
                      data.ob?.visibilityKM,
                      data.ob?.visibilityMI,
                      units
                    )}
                  />
                  <Metric
                    label="Quality"
                    value={data.ob?.QC ?? dash}
                    hint={
                      isNum(data.ob?.trustFactor)
                        ? `trust ${data.ob?.trustFactor}`
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
          </SectionBody>
        </Card>

        <Card title="Nearby hazards" subtitle="Active threats and lightning in the last hour">
          <div className="space-y-3">
            <SectionBody section={sections.threats} empty="No threat data.">
              {(threats) =>
                threats.length === 0 ? (
                  <p className="text-sm text-emerald-300/90">
                    No active weather threats near this location.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {threats.map((threat, index) => (
                      <li key={threat.id ?? index} className="wx-inset px-3 py-2 text-sm">
                        <span className="font-medium">
                          {threat.name ?? threat.type ?? "Threat"}
                        </span>
                        {isNum(threat.distanceKM) && (
                          <span className="wx-muted">
                            {" "}
                            ·{" "}
                            {formatDistance(
                              threat.distanceKM,
                              threat.distanceMI,
                              units
                            )}{" "}
                            {threat.bearingENG ?? ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              }
            </SectionBody>

            <SectionBody section={sections.lightning} empty="Lightning data unavailable.">
              {(lightning) => {
                const count =
                  lightning.summary?.count ??
                  lightning.count ??
                  lightning.periods?.[0]?.summary?.count ??
                  0;
                const cg =
                  lightning.summary?.cg ?? lightning.periods?.[0]?.summary?.cg ?? null;
                const nearest =
                  lightning.summary?.distance?.minKM ??
                  lightning.periods?.[0]?.summary?.distance?.minKM ??
                  null;
                return (
                  <div className="wx-inset px-3 py-2 text-sm">
                    <span aria-hidden>⚡ </span>
                    {count > 0 ? (
                      <>
                        <span className="font-medium">{count.toLocaleString()}</span>{" "}
                        strikes within 50 km in the last hour
                        {isNum(cg) && ` (${cg.toLocaleString()} cloud-to-ground)`}
                        {isNum(nearest) &&
                          ` · nearest ${formatDistance(nearest, nearest * 0.621371, units)}`}
                      </>
                    ) : (
                      <span className="wx-muted">
                        No lightning within 50 km in the last hour.
                      </span>
                    )}
                  </div>
                );
              }}
            </SectionBody>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

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
  return (
    <span title="Local time at this location">
      {clockAt(now, offsetMinutes, hour12)} local
    </span>
  );
}

function humidityComfort(dewpointC: number | null | undefined): string | undefined {
  if (!isNum(dewpointC)) return undefined;
  if (dewpointC < 5) return "Very dry";
  if (dewpointC < 10) return "Dry";
  if (dewpointC < 16) return "Comfortable";
  if (dewpointC < 18) return "Slightly humid";
  if (dewpointC < 21) return "Humid";
  if (dewpointC < 24) return "Very humid";
  return "Oppressive";
}

function AlertsBlock({
  overview,
  hour12,
}: {
  overview: WeatherOverview;
  hour12: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const section = overview.sections.alerts;

  if (!section.ok || !section.data || section.data.length === 0) return null;

  return (
    <div className="space-y-2">
      {section.data.map((alert) => {
        const details = alert.details ?? {};
        const color = details.color ? `#${details.color.replace("#", "")}` : "#f59e0b";
        const isOpen = expanded === alert.id;
        return (
          <article
            key={alert.id}
            className="wx-card overflow-hidden border-l-4"
            style={{ borderLeftColor: color }}
          >
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 p-4 text-left"
              onClick={() => setExpanded(isOpen ? null : alert.id)}
              aria-expanded={isOpen}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold" style={{ color }}>
                    {details.name ?? details.type ?? "Weather alert"}
                  </span>
                  {details.emergency && <Chip tone="danger">Emergency</Chip>}
                </div>
                <div className="wx-muted mt-1 text-xs">
                  {details.loc && <span>{details.loc} · </span>}
                  {alert.timestamps?.beginsISO && (
                    <span>
                      from {formatTime(alert.timestamps.beginsISO, hour12)}
                    </span>
                  )}
                  {alert.timestamps?.expiresISO && (
                    <span>
                      {" "}
                      until {formatTime(alert.timestamps.expiresISO, hour12)}
                    </span>
                  )}
                </div>
              </div>
              <span className="wx-muted shrink-0 text-sm">{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (details.bodyFull || details.body) && (
              <pre className="wx-muted max-h-96 overflow-auto whitespace-pre-wrap border-t border-slate-400/15 px-4 py-3 text-xs leading-relaxed">
                {details.bodyFull ?? details.body}
              </pre>
            )}
          </article>
        );
      })}
    </div>
  );
}

function MinutelyBlock({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const section = overview.sections.minutely;
  const periods = section.data?.periods ?? [];

  if (!section.ok || periods.length === 0) return null;

  const rates = periods.map((p) =>
    units === "metric"
      ? (p.precipRateMM ?? p.precipMM ?? 0)
      : (p.precipRateIN ?? p.precipIN ?? 0)
  );
  const total = rates.reduce((sum, value) => sum + (value ?? 0), 0);

  const firstWet = periods.findIndex(
    (p, i) => (rates[i] ?? 0) > 0 && (p.precipRateMM ?? p.precipMM ?? 0) > 0
  );

  return (
    <Card
      title="Next hour, minute by minute"
      subtitle={
        total <= 0
          ? "No precipitation expected in the next 60 minutes"
          : firstWet >= 0
            ? `Precipitation starting around ${formatTime(periods[firstWet].dateTimeISO, hour12)}`
            : "Precipitation expected"
      }
    >
      <SeriesChart
        labels={periods.map((p, i) =>
          i % 10 === 0 ? formatTime(p.dateTimeISO, hour12) : ""
        )}
        series={[
          {
            label: `Precip rate (${units === "metric" ? "mm/hr" : "in/hr"})`,
            color: "#38bdf8",
            fill: true,
            values: rates.map((value) => (isNum(value) ? value : 0)),
            format: (v) => v.toFixed(2),
          },
        ]}
        height={140}
        showEvery={10}
        yFormat={(v) => v.toFixed(1)}
        ariaLabel="Minute-by-minute precipitation rate for the next hour"
      />
    </Card>
  );
}
