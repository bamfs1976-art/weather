"use client";

import { useState } from "react";
import { Card, Metric, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { CloudRainIcon, ConditionGlyph, ThermometerHighIcon, ThermometerLowIcon, WindIcon } from "@/components/icons";
import {
  dash,
  formatDistance,
  formatHourLabel,
  formatPercent,
  formatPrecip,
  formatPressure,
  formatSpeed,
  formatTemp,
  isNum,
  pickUnit,
  pressureTrend,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview, WeatherPeriod } from "@/lib/weather-types";

type View = "temp" | "wind" | "precip" | "pressure";

const VIEWS: { key: View; label: string }[] = [
  { key: "temp", label: "Temperature" },
  { key: "wind", label: "Wind" },
  { key: "precip", label: "Precipitation" },
  { key: "pressure", label: "Pressure & humidity" },
];

/** What actually happened over the trailing 24 hours. */
export function RecentPanel({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const [view, setView] = useState<View>("temp");

  return (
    <div className="space-y-4">
      <Card
        title="Last 24 hours"
        subtitle="Observed conditions, hour by hour, ending now"
        action={
          <div className="wx-scroll flex gap-1 pb-1">
            {VIEWS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                className={`wx-btn shrink-0 px-2.5 py-1 text-xs ${
                  view === option.key ? "wx-btn-active" : ""
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <SectionBody section={overview.sections.recent}>
          {(data) => {
            const periods = data.periods ?? [];
            const labels = periods.map((p) =>
              formatHourLabel(p.dateTimeISO, hour12)
            );
            return <RecentChart view={view} labels={labels} periods={periods} units={units} />;
          }}
        </SectionBody>
      </Card>

      <Card title="24-hour summary" subtitle="Extremes and totals from the period above">
        <SectionBody section={overview.sections.recent}>
          {(data) => {
            const periods = data.periods ?? [];
            const stats = summarise(periods, units);
            const trend = pressureTrend(periods);
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <Metric
                  label="Warmest"
                  icon={<ThermometerHighIcon />}
                  value={stats.maxTemp === null ? dash : `${stats.maxTemp.toFixed(1)}°`}
                  hint={stats.maxTempAt ?? undefined}
                />
                <Metric
                  label="Coldest"
                  icon={<ThermometerLowIcon />}
                  value={stats.minTemp === null ? dash : `${stats.minTemp.toFixed(1)}°`}
                  hint={stats.minTempAt ?? undefined}
                />
                <Metric
                  label="Average"
                  value={stats.avgTemp === null ? dash : `${stats.avgTemp.toFixed(1)}°`}
                />
                <Metric
                  label="Total precip"
                  icon={<CloudRainIcon />}
                  value={
                    stats.precipTotal === null
                      ? dash
                      : units === "metric"
                        ? `${stats.precipTotal.toFixed(1)} mm`
                        : `${stats.precipTotal.toFixed(2)} in`
                  }
                  hint={`${stats.wetHours} wet hour${stats.wetHours === 1 ? "" : "s"}`}
                />
                <Metric
                  label="Peak wind"
                  icon={<WindIcon />}
                  value={
                    stats.maxWind === null
                      ? dash
                      : `${stats.maxWind.toFixed(0)} ${units === "metric" ? "km/h" : "mph"}`
                  }
                  hint={stats.maxWindAt ?? undefined}
                />
                <Metric
                  label="Peak gust"
                  value={
                    stats.maxGust === null
                      ? dash
                      : `${stats.maxGust.toFixed(0)} ${units === "metric" ? "km/h" : "mph"}`
                  }
                />
                <Metric
                  label="Humidity range"
                  value={
                    stats.minHumidity === null || stats.maxHumidity === null
                      ? dash
                      : `${stats.minHumidity}–${stats.maxHumidity}%`
                  }
                />
                <Metric
                  label="Pressure trend"
                  value={trend ? trend.direction : dash}
                  hint={
                    trend ? `${trend.changeMB >= 0 ? "+" : ""}${trend.changeMB.toFixed(1)} mb` : undefined
                  }
                />
              </div>
            );
          }}
        </SectionBody>
      </Card>

      <Card title="Hourly readings" subtitle="Every observation from the last 24 hours">
        <SectionBody section={overview.sections.recent}>
          {(data) => (
            <div className="wx-scroll -mx-1 px-1">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="wx-muted border-b border-[var(--wx-border)] text-left text-xs uppercase tracking-wide">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Conditions</th>
                    <th className="py-2 pr-3 text-right font-medium">Temp</th>
                    <th className="py-2 pr-3 text-right font-medium">Feels</th>
                    <th className="py-2 pr-3 text-right font-medium">Dew pt</th>
                    <th className="py-2 pr-3 text-right font-medium">RH</th>
                    <th className="py-2 pr-3 text-right font-medium">Wind</th>
                    <th className="py-2 pr-3 text-right font-medium">Precip</th>
                    <th className="py-2 pr-3 text-right font-medium">Pressure</th>
                    <th className="py-2 text-right font-medium">Vis</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(data.periods ?? [])].reverse().map((period, index) => (
                    <tr
                      key={period.dateTimeISO ?? index}
                      className="border-b border-[var(--wx-border)] last:border-0"
                    >
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {formatHourLabel(period.dateTimeISO, hour12)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3">
                        <span className="mr-1.5" aria-hidden>
                          <ConditionGlyph icon={period.icon} coded={period.weatherPrimaryCoded} />
                        </span>
                        {period.weather ?? period.weatherPrimary ?? dash}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-medium">
                        {formatTemp(period.tempC, period.tempF, units)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3 text-right">
                        {formatTemp(period.feelslikeC, period.feelslikeF, units)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3 text-right">
                        {formatTemp(period.dewpointC, period.dewpointF, units)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3 text-right">
                        {formatPercent(period.humidity)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3 text-right whitespace-nowrap">
                        {period.windDir ?? ""}{" "}
                        {formatSpeed(period.windSpeedKPH, period.windSpeedMPH, units)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3 text-right">
                        {formatPrecip(period.precipMM, period.precipIN, units)}
                      </td>
                      <td className="wx-muted py-1.5 pr-3 text-right">
                        {formatPressure(period.pressureMB, period.pressureIN, units)}
                      </td>
                      <td className="wx-muted py-1.5 text-right">
                        {formatDistance(period.visibilityKM, period.visibilityMI, units)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionBody>
      </Card>
    </div>
  );
}

function RecentChart({
  view,
  labels,
  periods,
  units,
}: {
  view: View;
  labels: string[];
  periods: WeatherPeriod[];
  units: UnitSystem;
}) {
  switch (view) {
    case "wind":
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: `Wind (${units === "metric" ? "km/h" : "mph"})`,
              color: "#38bdf8",
              fill: true,
              values: periods.map((p) => pickUnit(p.windSpeedKPH, p.windSpeedMPH, units)),
            },
            {
              label: "Gusts",
              color: "#f472b6",
              dashed: true,
              values: periods.map((p) => pickUnit(p.windGustKPH, p.windGustMPH, units)),
            },
          ]}
          ariaLabel="Observed wind over the last 24 hours"
        />
      );
    case "precip":
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: "Humidity (%)",
              color: "#34d399",
              values: periods.map((p) => (isNum(p.humidity) ? p.humidity : null)),
              format: (v) => `${v.toFixed(0)}%`,
            },
          ]}
          bars={{
            label: `Precip (${units === "metric" ? "mm" : "in"})`,
            color: "#38bdf8",
            values: periods.map((p) => pickUnit(p.precipMM, p.precipIN, units)),
            format: (v) => v.toFixed(2),
          }}
          yFormat={(v) => v.toFixed(0)}
          ariaLabel="Observed precipitation over the last 24 hours"
        />
      );
    case "pressure":
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: `Pressure (${units === "metric" ? "mb" : "inHg"})`,
              color: "#fbbf24",
              fill: true,
              values: periods.map((p) => pickUnit(p.pressureMB, p.pressureIN, units)),
              format: (v) => (units === "metric" ? v.toFixed(1) : v.toFixed(2)),
            },
          ]}
          yFormat={(v) => (units === "metric" ? v.toFixed(0) : v.toFixed(2))}
          ariaLabel="Observed pressure over the last 24 hours"
        />
      );
    case "temp":
    default:
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: `Temperature (${units === "metric" ? "°C" : "°F"})`,
              color: "#fb923c",
              fill: true,
              values: periods.map((p) => pickUnit(p.tempC, p.tempF, units)),
              format: (v) => `${v.toFixed(1)}°`,
            },
            {
              label: "Feels like",
              color: "#f87171",
              dashed: true,
              values: periods.map((p) => pickUnit(p.feelslikeC, p.feelslikeF, units)),
              format: (v) => `${v.toFixed(1)}°`,
            },
            {
              label: "Dew point",
              color: "#38bdf8",
              values: periods.map((p) => pickUnit(p.dewpointC, p.dewpointF, units)),
              format: (v) => `${v.toFixed(1)}°`,
            },
          ]}
          yFormat={(v) => `${v.toFixed(0)}°`}
          ariaLabel="Observed temperature over the last 24 hours"
        />
      );
  }
}

function summarise(periods: WeatherPeriod[], units: UnitSystem) {
  const temps = periods
    .map((p) => ({ value: pickUnit(p.tempC, p.tempF, units), iso: p.dateTimeISO }))
    .filter((p): p is { value: number; iso: string | undefined } => p.value !== null);
  const winds = periods
    .map((p) => ({
      value: pickUnit(p.windSpeedKPH, p.windSpeedMPH, units),
      iso: p.dateTimeISO,
    }))
    .filter((p): p is { value: number; iso: string | undefined } => p.value !== null);
  const gusts = periods
    .map((p) => pickUnit(p.windGustKPH, p.windGustMPH, units))
    .filter((v): v is number => v !== null);
  const precip = periods
    .map((p) => pickUnit(p.precipMM, p.precipIN, units))
    .filter((v): v is number => v !== null);
  const humidity = periods
    .map((p) => p.humidity)
    .filter((v): v is number => isNum(v));

  const hottest = temps.reduce<(typeof temps)[number] | null>(
    (best, item) => (best === null || item.value > best.value ? item : best),
    null
  );
  const coldest = temps.reduce<(typeof temps)[number] | null>(
    (best, item) => (best === null || item.value < best.value ? item : best),
    null
  );
  const windiest = winds.reduce<(typeof winds)[number] | null>(
    (best, item) => (best === null || item.value > best.value ? item : best),
    null
  );

  return {
    maxTemp: hottest?.value ?? null,
    maxTempAt: hottest?.iso ? `at ${formatHourLabel(hottest.iso)}` : null,
    minTemp: coldest?.value ?? null,
    minTempAt: coldest?.iso ? `at ${formatHourLabel(coldest.iso)}` : null,
    avgTemp: temps.length
      ? temps.reduce((sum, item) => sum + item.value, 0) / temps.length
      : null,
    precipTotal: precip.length ? precip.reduce((sum, v) => sum + v, 0) : null,
    wetHours: precip.filter((v) => v > 0).length,
    maxWind: windiest?.value ?? null,
    maxWindAt: windiest?.iso ? `at ${formatHourLabel(windiest.iso)}` : null,
    maxGust: gusts.length ? Math.max(...gusts) : null,
    minHumidity: humidity.length ? Math.min(...humidity) : null,
    maxHumidity: humidity.length ? Math.max(...humidity) : null,
  };
}
