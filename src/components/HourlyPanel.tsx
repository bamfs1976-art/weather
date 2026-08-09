"use client";

import { useState } from "react";
import { Card, Chip, Meter, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import {
  dash,
  formatDistance,
  formatHourLabel,
  formatNumber,
  formatPercent,
  formatPrecip,
  formatPressure,
  formatSnow,
  formatSpeed,
  formatTemp,
  formatWeekday,
  isNum,
  weatherEmoji,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview, WeatherPeriod } from "@/lib/weather-types";
import { ForecastComparison } from "./ForecastComparison";

type Metric = "temp" | "wind" | "precip" | "humidity" | "pressure" | "solar";

const METRICS: { key: Metric; label: string }[] = [
  { key: "temp", label: "Temperature" },
  { key: "wind", label: "Wind" },
  { key: "precip", label: "Precipitation" },
  { key: "humidity", label: "Humidity & cloud" },
  { key: "pressure", label: "Pressure" },
  { key: "solar", label: "Sun & UV" },
];

export function HourlyPanel({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const [metric, setMetric] = useState<Metric>("temp");
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <ForecastComparison overview={overview} units={units} hour12={hour12} />

      <Card
        title="Next 48 hours"
        subtitle="Hourly forecast — tap a chart column for exact values"
        action={
          <div className="wx-scroll flex gap-1 pb-1">
            {METRICS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMetric(option.key)}
                className={`wx-btn shrink-0 px-2.5 py-1 text-xs ${
                  metric === option.key ? "wx-btn-active" : ""
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <SectionBody section={overview.sections.hourly}>
          {(data) => {
            const periods = data.periods ?? [];
            const labels = periods.map((p) =>
              formatHourLabel(p.dateTimeISO ?? p.validTime, hour12)
            );
            return (
              <HourlyChart
                metric={metric}
                labels={labels}
                periods={periods}
                units={units}
              />
            );
          }}
        </SectionBody>
      </Card>

      <Card title="Hour by hour" subtitle="Every field the forecast provides">
        <SectionBody section={overview.sections.hourly}>
          {(data) => {
            const periods = data.periods ?? [];
            return (
              <div className="wx-scroll -mx-1 flex gap-2 px-1 pb-2">
                {periods.map((period, index) => {
                  const iso = period.dateTimeISO ?? period.validTime ?? "";
                  const isOpen = expanded === index;
                  return (
                    <button
                      key={iso || index}
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : index)}
                      className={`wx-inset wx-card-hover w-[104px] shrink-0 px-2.5 py-3 text-center transition ${
                        isOpen ? "ring-1 ring-[var(--wx-accent-border)]" : ""
                      }`}
                    >
                      <div className="wx-muted text-[11px]">
                        {index === 0 ? "Now" : formatHourLabel(iso, hour12)}
                      </div>
                      <div className="wx-dim text-[10px]">{formatWeekday(iso)}</div>
                      <div className="my-1 text-2xl" aria-hidden>
                        {weatherEmoji(period.icon, period.weatherPrimaryCoded)}
                      </div>
                      <div className="text-lg font-semibold">
                        {formatTemp(period.tempC, period.tempF, units)}
                      </div>
                      <div className="wx-muted mt-0.5 text-[11px]">
                        {isNum(period.pop) ? `${period.pop}%` : "—"}
                      </div>
                      <div className="wx-dim text-[11px]">
                        {formatSpeed(period.windSpeedKPH, period.windSpeedMPH, units)}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          }}
        </SectionBody>

        {expanded !== null &&
          overview.sections.hourly.data?.periods?.[expanded] && (
            <HourDetail
              period={overview.sections.hourly.data.periods[expanded]}
              units={units}
              hour12={hour12}
              onClose={() => setExpanded(null)}
            />
          )}
      </Card>
    </div>
  );
}

function HourlyChart({
  metric,
  labels,
  periods,
  units,
}: {
  metric: Metric;
  labels: string[];
  periods: WeatherPeriod[];
  units: UnitSystem;
}) {
  const metricValue = (
    m: number | null | undefined,
    i: number | null | undefined
  ) => {
    const value = units === "metric" ? m : i;
    return isNum(value) ? value : null;
  };

  switch (metric) {
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
              values: periods.map((p) =>
                metricValue(p.windSpeedKPH, p.windSpeedMPH)
              ),
              format: (v) => v.toFixed(0),
            },
            {
              label: "Gusts",
              color: "#f472b6",
              dashed: true,
              values: periods.map((p) => metricValue(p.windGustKPH, p.windGustMPH)),
              format: (v) => v.toFixed(0),
            },
          ]}
          ariaLabel="Hourly wind speed and gusts"
        />
      );
    case "precip":
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: "Chance of precipitation (%)",
              color: "#818cf8",
              fill: true,
              values: periods.map((p) => (isNum(p.pop) ? p.pop : null)),
              format: (v) => `${v.toFixed(0)}%`,
            },
          ]}
          bars={{
            label: `Amount (${units === "metric" ? "mm" : "in"})`,
            color: "#38bdf8",
            values: periods.map((p) => metricValue(p.precipMM, p.precipIN)),
            format: (v) => v.toFixed(2),
          }}
          yFormat={(v) => `${v.toFixed(0)}`}
          ariaLabel="Hourly precipitation chance and amount"
        />
      );
    case "humidity":
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: "Humidity (%)",
              color: "#34d399",
              fill: true,
              values: periods.map((p) => (isNum(p.humidity) ? p.humidity : null)),
              format: (v) => `${v.toFixed(0)}%`,
            },
            {
              label: "Cloud cover (%)",
              color: "#94a3b8",
              dashed: true,
              values: periods.map((p) => (isNum(p.sky) ? p.sky : null)),
              format: (v) => `${v.toFixed(0)}%`,
            },
          ]}
          yFormat={(v) => `${v.toFixed(0)}`}
          ariaLabel="Hourly humidity and cloud cover"
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
              values: periods.map((p) => metricValue(p.pressureMB, p.pressureIN)),
              format: (v) => (units === "metric" ? v.toFixed(0) : v.toFixed(2)),
            },
          ]}
          yFormat={(v) => (units === "metric" ? v.toFixed(0) : v.toFixed(2))}
          ariaLabel="Hourly barometric pressure"
        />
      );
    case "solar":
      return (
        <SeriesChart
          labels={labels}
          height={220}
          series={[
            {
              label: "UV index",
              color: "#f97316",
              fill: true,
              values: periods.map((p) => (isNum(p.uvi) ? p.uvi : null)),
              format: (v) => v.toFixed(1),
            },
            {
              label: "Solar radiation (W/m²)",
              color: "#fde047",
              dashed: true,
              values: periods.map((p) =>
                isNum(p.solradWM2) ? p.solradWM2 / 100 : null
              ),
              format: (v) => `${(v * 100).toFixed(0)} W/m²`,
            },
          ]}
          yFormat={(v) => v.toFixed(1)}
          ariaLabel="Hourly UV index and solar radiation"
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
              values: periods.map((p) => metricValue(p.tempC, p.tempF)),
              format: (v) => `${v.toFixed(1)}°`,
            },
            {
              label: "Feels like",
              color: "#f87171",
              dashed: true,
              values: periods.map((p) =>
                metricValue(p.feelslikeC, p.feelslikeF)
              ),
              format: (v) => `${v.toFixed(1)}°`,
            },
            {
              label: "Dew point",
              color: "#38bdf8",
              values: periods.map((p) => metricValue(p.dewpointC, p.dewpointF)),
              format: (v) => `${v.toFixed(1)}°`,
            },
          ]}
          yFormat={(v) => `${v.toFixed(0)}°`}
          ariaLabel="Hourly temperature, feels-like and dew point"
        />
      );
  }
}

function HourDetail({
  period,
  units,
  hour12,
  onClose,
}: {
  period: WeatherPeriod;
  units: UnitSystem;
  hour12: boolean;
  onClose: () => void;
}) {
  const iso = period.dateTimeISO ?? period.validTime ?? "";
  const rows: [string, string][] = [
    ["Condition", period.weather ?? period.weatherPrimary ?? dash],
    ["Temperature", formatTemp(period.tempC, period.tempF, units)],
    ["Feels like", formatTemp(period.feelslikeC, period.feelslikeF, units)],
    ["Dew point", formatTemp(period.dewpointC, period.dewpointF, units)],
    ["Humidity", formatPercent(period.humidity)],
    [
      "Wind",
      `${period.windDir ?? ""} ${formatSpeed(period.windSpeedKPH, period.windSpeedMPH, units)}`.trim(),
    ],
    ["Gusts", formatSpeed(period.windGustKPH, period.windGustMPH, units)],
    ["Chance of precip", formatPercent(period.pop)],
    ["Precip amount", formatPrecip(period.precipMM, period.precipIN, units)],
    ["Snow", formatSnow(period.snowCM, period.snowIN, units)],
    ["Ice", formatPrecip(period.iceaccumMM, period.iceaccumIN, units)],
    ["Cloud cover", formatPercent(period.sky)],
    ["Visibility", formatDistance(period.visibilityKM, period.visibilityMI, units)],
    ["Pressure", formatPressure(period.pressureMB, period.pressureIN, units)],
    ["UV index", formatNumber(period.uvi, "", 1)],
    ["Solar radiation", formatNumber(period.solradWM2, " W/m²")],
    ["Daylight", period.isDay === undefined ? dash : period.isDay ? "Day" : "Night"],
  ];

  return (
    <div className="wx-inset wx-fade mt-3 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">
          <span className="mr-2" aria-hidden>
            {weatherEmoji(period.icon, period.weatherPrimaryCoded)}
          </span>
          {formatWeekday(iso)} {formatHourLabel(iso, hour12)}
        </h3>
        <button type="button" className="wx-btn px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-[var(--wx-border)] py-1">
            <dt className="wx-muted">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {isNum(period.pop) && (
        <div className="mt-3">
          <Meter value={period.pop} color="#818cf8" label="Chance of precipitation" />
        </div>
      )}
      {period.weatherPrimaryCoded && (
        <div className="mt-3">
          <Chip title="Xweather coded weather string">{period.weatherPrimaryCoded}</Chip>
        </div>
      )}
    </div>
  );
}
