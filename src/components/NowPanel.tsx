"use client";

import { useState } from "react";
import { Card, Chip, EmptyState, Meter, Metric, SectionBody, WindArrow } from "./ui";
import { WeatherHero } from "./WeatherHero";
import { MetricTile, RadialRing, Sparkline, UVScale, WindCompass } from "./MetricTile";
import { SunArc } from "./SunArc";
import { ForecastComparison } from "./ForecastComparison";
import { CloudLightningIcon, ConditionIcon, SunIcon } from "./icons";
import { SeriesChart } from "./Chart";
import { MapPanel } from "./MapPanel";
import {
  dash,
  formatDayMonth,
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
  formatWeekday,
  isNum,
  nextPrecipitation,
  pressureTrend,
  relativeFromNow,
  uviCategory,
  windDescription,
} from "@/lib/weather-format";
import type { ConditionKind } from "@/lib/weather-format";
import type { ThemeName, UnitSystem, WeatherOverview } from "@/lib/weather-types";

export function NowPanel({
  overview,
  units,
  hour12,
  theme = "light",
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
  theme?: ThemeName;
}) {
  const { sections, place } = overview;
  const current = sections.current.data?.periods?.[0] ?? null;
  const sun = sections.sunMoon.data?.sun ?? null;
  const recentPeriods = sections.recent.data?.periods ?? [];
  const trend = pressureTrend(recentPeriods);

  const uv = uviCategory(current?.uvi);

  return (
    <div className="space-y-4">
      <AlertsBlock overview={overview} hour12={hour12} />

      <WeatherHero overview={overview} units={units} hour12={hour12} />

      {/* One line saying whether the two providers agree; the full comparison
          lives on the Hourly tab. */}
      <ForecastComparison overview={overview} units={units} hour12={hour12} compact />

      {/*
        Four primary tiles. These are the readings people look for by name;
        everything else is one tap away in Details below. Each pairs the number
        with a second encoding — a bearing, a place on the UV scale, a
        proportion — so the tile is readable at a glance and not just legible.
      */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile
          label="Wind"
          value={formatSpeed(current?.windSpeedKPH, current?.windSpeedMPH, units)}
          hint={
            current?.windDir
              ? `${current.windDir}${isNum(current.windGustKPH) ? ` · gusts ${formatSpeed(current.windGustKPH, current.windGustMPH, units)}` : ""}`
              : windDescription(current?.windSpeedKPH ?? null)
          }
          visual={<WindCompass deg={current?.windDirDEG} />}
        />
        <MetricTile
          label="Humidity"
          value={formatPercent(current?.humidity)}
          hint={humidityComfort(current?.dewpointC)}
          visual={<RadialRing value={current?.humidity ?? null} label="Relative humidity" />}
        />
        <MetricTile
          label="UV index"
          value={isNum(current?.uvi) ? current.uvi.toFixed(0) : dash}
          hint={uv.label}
          visual={<UVScale value={current?.uvi} />}
        />
        <MetricTile
          label="Visibility"
          value={formatDistance(current?.visibilityKM, current?.visibilityMI, units)}
          hint={
            isNum(current?.visibilityKM)
              ? current.visibilityKM >= 10
                ? "Clear"
                : current.visibilityKM >= 4
                  ? "Moderate"
                  : "Poor"
              : undefined
          }
          visual={
            <RadialRing
              value={isNum(current?.visibilityKM) ? Math.min(100, (current.visibilityKM / 16) * 100) : null}
              color="var(--wx-good)"
              label="Visibility as a proportion of 16 km"
              showValue={false}
            />
          }
        />
      </div>

      {/*
        The secondary readings. A <details> rather than custom state: it is
        keyboard operable, announced correctly and remembers nothing, which is
        the right behaviour for a panel you open to check one number.
      */}
      <details className="wx-details">
        <summary className="wx-details-summary">
          <span>Details</span>
          <span className="wx-dim text-xs">
            dew point · pressure · cloud · ceiling · elevation
          </span>
        </summary>
        <div className="grid grid-cols-2 gap-2 p-3 pt-0 sm:grid-cols-3 lg:grid-cols-5">
          <MetricTile
            label="Dew point"
            value={formatTemp(current?.dewpointC, current?.dewpointF, units)}
            hint={humidityComfort(current?.dewpointC)}
          />
          <MetricTile
            label="Pressure"
            value={formatPressure(current?.pressureMB, current?.pressureIN, units)}
            hint={
              trend
                ? `${trend.direction} ${Math.abs(trend.changeMB).toFixed(1)} mb/24h`
                : undefined
            }
            visual={
              <Sparkline
                values={recentPeriods.map((p) => p.pressureMB ?? null)}
                direction={trend?.direction ?? null}
              />
            }
          />
          <MetricTile
            label="Cloud cover"
            value={formatPercent(current?.sky)}
            visual={<RadialRing value={current?.sky ?? null} size={44} label="Cloud cover" />}
          />
          <MetricTile
            label="Ceiling"
            value={
              isNum(current?.ceilingFT) || isNum(current?.ceilingM)
                ? formatHeight(current?.ceilingM, current?.ceilingFT, units)
                : "Unlimited"
            }
          />
          <MetricTile
            label="Elevation"
            value={formatHeight(place.elevM, place.elevFT, units)}
          />
        </div>
      </details>

      <Card title="Sun" subtitle="Today's arc, with the sun at its current position">
        <SectionBody section={sections.sunMoon}>
          {() => (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:items-center">
              <SunArc riseISO={sun?.riseISO} setISO={sun?.setISO} hour12={hour12} />
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  label="Sunrise"
                  value={formatTime(sun?.riseISO, hour12)}
                  hint={
                    sun?.twilight?.civilBeginISO
                      ? `Dawn ${formatTime(sun.twilight.civilBeginISO, hour12)}`
                      : undefined
                  }
                />
                <MetricTile
                  label="Sunset"
                  value={formatTime(sun?.setISO, hour12)}
                  hint={
                    sun?.twilight?.civilEndISO
                      ? `Dusk ${formatTime(sun.twilight.civilEndISO, hour12)}`
                      : undefined
                  }
                />
              </div>
            </div>
          )}
        </SectionBody>
      </Card>

      <NextRainCard overview={overview} units={units} hour12={hour12} />

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
                  <p className="text-sm wx-good-text">
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
                    <span className="mr-1.5 inline-flex align-[-3px]" style={{ color: "var(--wx-warn)" }} aria-hidden>
                      <CloudLightningIcon size={16} />
                    </span>
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

      {/* The map lives on the main view — it is what people look at most. */}
      <MapPanel place={place} theme={theme} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * "When will it rain next?" — the question a weather app gets asked most.
 * Answered from the nowcast, hourly and daily forecasts already in the payload,
 * so it costs no extra request and degrades with whatever data is available.
 */
function NextRainCard({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const { sections } = overview;
  const minutely = sections.minutely.data?.periods ?? [];
  const hourly = sections.hourly.data?.periods ?? [];
  const daily = sections.daily.data?.periods ?? [];

  if (
    minutely.length === 0 &&
    hourly.length === 0 &&
    daily.length === 0
  ) {
    return null;
  }

  const next = nextPrecipitation(minutely, hourly, daily);
  const label = next.type.toLowerCase();

  let headline: string;
  let detail: string | null = null;
  let iconKind: ConditionKind = "clear";
  let tone: "good" | "accent" | "warn" = "good";

  if (next.state === "none") {
    headline = "No rain expected";
    detail = "Nothing in the next 10 days of forecast.";
    iconKind = "clear";
  } else if (next.state === "now") {
    headline = `${next.type} falling now`;
    detail = next.endISO
      ? `Easing around ${formatTime(next.endISO, hour12)}`
      : "Expected to continue for at least the next hour";
    iconKind = "rain";
    tone = "warn";
  } else if (next.precision === "minute") {
    // The nowcast can put the start in the current minute; "in 0 min" reads oddly.
    headline =
      next.minutesAway && next.minutesAway > 0
        ? `${next.type} in ${next.minutesAway} min`
        : `${next.type} starting any minute`;
    detail = `Starting around ${formatTime(next.startISO, hour12)}${
      next.endISO ? `, easing by ${formatTime(next.endISO, hour12)}` : ""
    }`;
    iconKind = "showers";
    tone = "warn";
  } else if (next.precision === "hour") {
    const hours = next.minutesAway === null ? null : Math.round(next.minutesAway / 60);
    headline =
      hours !== null && hours <= 24
        ? `${next.type} likely in about ${hours} hour${hours === 1 ? "" : "s"}`
        : `${next.type} likely ${formatWeekday(next.startISO)}`;
    detail = `From ${formatWeekday(next.startISO)} ${formatTime(next.startISO, hour12)}${
      next.endISO ? ` until about ${formatTime(next.endISO, hour12)}` : ""
    }`;
    iconKind = "showers";
    tone = "accent";
  } else {
    headline = `${next.type} likely ${formatWeekday(next.startISO)}`;
    detail = `Next wet day is ${formatWeekday(next.startISO)} ${formatDayMonth(
      next.startISO
    )} — nothing before then`;
    iconKind = "fair";
    tone = "accent";
  }

  const precisionNote =
    next.state === "none"
      ? null
      : next.precision === "minute"
        ? "From the minute-by-minute nowcast"
        : next.precision === "hour"
          ? "From the hourly forecast"
          : "From the 10-day outlook";

  /*
   * With nothing wet in ten days there is no series to draw — the old card
   * rendered a chart whose axis ran from -1.2 to 1.2 around a flat line of
   * zeroes, which looked like a broken chart rather than a dry fortnight.
   */
  if (next.state === "none") {
    return (
      <Card title="Next rain">
        <EmptyState
          art={<SunIcon size={44} />}
          title="Dry for the next 10 days"
          note="Nothing in the forecast — neither the nowcast nor the 10-day outlook has any precipitation."
        />
      </Card>
    );
  }

  return (
    <Card title="Next rain" subtitle={precisionNote ?? undefined}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
        <span className="shrink-0" style={{ color: "var(--wx-accent)" }} aria-hidden>
          <ConditionIcon kind={iconKind} size={44} />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-semibold leading-tight sm:text-2xl">
            {headline}
          </p>
          {detail && <p className="wx-muted mt-1 text-sm">{detail}</p>}
        </div>
        <Chip tone={tone}>
          {next.precision === "minute" ? "Nowcast" : `${label} expected`}
        </Chip>
      </div>

      {(
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Chance"
            value={next.probability === null ? "—" : formatPercent(next.probability)}
          />
          <Metric
            label="Expected amount"
            value={formatPrecip(next.amountMM, next.amountIN, units)}
          />
          <Metric
            label="Lasting"
            value={
              next.durationMinutes === null
                ? "—"
                : next.durationMinutes >= 120
                  ? `${Math.round(next.durationMinutes / 60)} hr`
                  : `${next.durationMinutes} min`
            }
          />
          <Metric
            label="Starts"
            value={
              next.state === "now" ? "Now" : formatTime(next.startISO, hour12)
            }
            hint={
              next.state === "now" ? undefined : formatWeekday(next.startISO)
            }
          />
        </div>
      )}
    </Card>
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
              <pre className="wx-muted max-h-96 overflow-auto whitespace-pre-wrap border-t border-[var(--wx-border)] px-4 py-3 text-xs leading-relaxed">
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
