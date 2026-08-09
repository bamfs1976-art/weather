"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Metric, Notice, SectionBody, Skeleton } from "./ui";
import { SeriesChart } from "./Chart";
import { CloudRainIcon, ConditionGlyph, MoonPhaseIcon, SunriseIcon, SunsetIcon, ThermometerHighIcon, ThermometerLowIcon, WindIcon } from "@/components/icons";
import {
  dash,
  formatDayMonth,
  formatHourLabel,
  formatPercent,
  formatPrecip,
  formatPressure,
  formatSpeed,
  formatTemp,
  formatTime,
  isNum,
  isoDateOnly,
  pickUnit,
} from "@/lib/weather-format";
import type {
  ArchiveDayPayload,
  HistoryPayload,
  UnitSystem,
  WeatherPeriod,
} from "@/lib/weather-types";

function shiftDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: "Last 7 days", from: () => shiftDays(-7), to: () => shiftDays(-1) },
  { label: "Last 14 days", from: () => shiftDays(-14), to: () => shiftDays(-1) },
  { label: "Last 30 days", from: () => shiftDays(-30), to: () => shiftDays(-1) },
  {
    label: "This month",
    from: () => `${new Date().toISOString().slice(0, 7)}-01`,
    to: () => shiftDays(0),
  },
];

export function WeatherHistoryPanel({
  placeQuery,
  units,
  hour12,
}: {
  placeQuery: string;
  units: UnitSystem;
  hour12: boolean;
}) {
  const [from, setFrom] = useState(() => shiftDays(-14));
  const [to, setTo] = useState(() => shiftDays(-1));
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [day, setDay] = useState<ArchiveDayPayload | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);

  const load = useCallback(
    async (rangeFrom: string, rangeTo: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/history?p=${encodeURIComponent(placeQuery)}&from=${rangeFrom}&to=${rangeTo}`
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Could not load history.");
        setData(payload as HistoryPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load history.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [placeQuery]
  );

  // Reload whenever the place changes; the range persists across places.
  useEffect(() => {
    load(from, to);
    setSelectedDate(null);
    setDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeQuery]);

  const openDay = useCallback(
    async (date: string) => {
      if (selectedDate === date) {
        setSelectedDate(null);
        setDay(null);
        return;
      }
      setSelectedDate(date);
      setDay(null);
      setDayError(null);
      setDayLoading(true);
      try {
        const res = await fetch(
          `/api/archive?p=${encodeURIComponent(placeQuery)}&date=${date}`
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Could not load that day.");
        setDay(payload as ArchiveDayPayload);
      } catch (err) {
        setDayError(err instanceof Error ? err.message : "Could not load that day.");
      } finally {
        setDayLoading(false);
      }
    },
    [placeQuery, selectedDate]
  );

  const summaries = data?.sections.dailySummaries.data?.periods ?? [];
  const normals = data?.sections.normals.data?.periods ?? [];

  return (
    <div className="space-y-4">
      <Card
        title="Historical weather"
        subtitle="Daily summaries from the Xweather archive — data goes back to 2001"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="wx-muted mb-1 block uppercase tracking-wide">From</span>
            <input
              type="date"
              className="wx-field"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="text-xs">
            <span className="wx-muted mb-1 block uppercase tracking-wide">To</span>
            <input
              type="date"
              className="wx-field"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="wx-btn wx-btn-active text-sm"
            onClick={() => load(from, to)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load range"}
          </button>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="wx-btn px-2.5 py-1 text-xs"
                onClick={() => {
                  const nextFrom = preset.from();
                  const nextTo = preset.to();
                  setFrom(nextFrom);
                  setTo(nextTo);
                  load(nextFrom, nextTo);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <p className="wx-dim mt-2 text-xs">
          Xweather returns up to about one month of daily summaries per request.
        </p>

        {error && (
          <div className="mt-3">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}
      </Card>

      {loading && !data && (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-48 w-full" />
          </div>
        </Card>
      )}

      {data && (
        <>
          <Card
            title="Temperature history"
            subtitle={
              normals.length > 0
                ? "Daily highs and lows against the 30-year climate normals"
                : "Daily highs and lows"
            }
          >
            <SectionBody section={data.sections.dailySummaries}>
              {(payload) => {
                const periods = payload.periods ?? [];
                const normalByDate = new Map(
                  normals.map((n) => [isoDateOnly(n.dateTimeISO), n])
                );
                return (
                  <SeriesChart
                    labels={periods.map((p) => formatDayMonth(p.dateTimeISO))}
                    height={230}
                    series={[
                      {
                        label: `High (${units === "metric" ? "°C" : "°F"})`,
                        color: "#fb923c",
                        fill: true,
                        values: periods.map((p) =>
                          pickUnit(p.maxTempC, p.maxTempF, units)
                        ),
                        format: (v) => `${v.toFixed(1)}°`,
                      },
                      {
                        label: "Low",
                        color: "#60a5fa",
                        fill: true,
                        values: periods.map((p) =>
                          pickUnit(p.minTempC, p.minTempF, units)
                        ),
                        format: (v) => `${v.toFixed(1)}°`,
                      },
                      ...(normals.length > 0
                        ? [
                            {
                              label: "Normal high",
                              color: "#fbbf24",
                              dashed: true,
                              values: periods.map((p) => {
                                const normal = normalByDate.get(
                                  isoDateOnly(p.dateTimeISO)
                                );
                                return normal
                                  ? pickUnit(normal.maxTempC, normal.maxTempF, units)
                                  : null;
                              }),
                              format: (v: number) => `${v.toFixed(1)}°`,
                            },
                            {
                              label: "Normal low",
                              color: "#818cf8",
                              dashed: true,
                              values: periods.map((p) => {
                                const normal = normalByDate.get(
                                  isoDateOnly(p.dateTimeISO)
                                );
                                return normal
                                  ? pickUnit(normal.minTempC, normal.minTempF, units)
                                  : null;
                              }),
                              format: (v: number) => `${v.toFixed(1)}°`,
                            },
                          ]
                        : []),
                    ]}
                    yFormat={(v) => `${v.toFixed(0)}°`}
                    ariaLabel="Historical daily high and low temperatures"
                  />
                );
              }}
            </SectionBody>
          </Card>

          <Card title="Precipitation & wind history">
            <SectionBody section={data.sections.dailySummaries}>
              {(payload) => {
                const periods = payload.periods ?? [];
                return (
                  <SeriesChart
                    labels={periods.map((p) => formatDayMonth(p.dateTimeISO))}
                    height={210}
                    series={[
                      {
                        label: `Max wind (${units === "metric" ? "km/h" : "mph"})`,
                        color: "#38bdf8",
                        values: periods.map((p) =>
                          pickUnit(
                            p.windSpeedMaxKPH ?? p.windSpeedKPH,
                            p.windSpeedMaxMPH ?? p.windSpeedMPH,
                            units
                          )
                        ),
                        format: (v) => v.toFixed(0),
                      },
                    ]}
                    bars={{
                      label: `Precip (${units === "metric" ? "mm" : "in"})`,
                      color: "#818cf8",
                      values: periods.map((p) =>
                        pickUnit(p.precipMM, p.precipIN, units)
                      ),
                      format: (v) => v.toFixed(2),
                    }}
                    yFormat={(v) => v.toFixed(0)}
                    ariaLabel="Historical precipitation and wind"
                  />
                );
              }}
            </SectionBody>
          </Card>

          <Card title="Period summary" subtitle={`${data.from} to ${data.to}`}>
            <RangeStats periods={summaries} units={units} />
          </Card>

          <Card
            title="Day by day"
            subtitle="Select a day to reconstruct it hour by hour"
          >
            <SectionBody section={data.sections.dailySummaries}>
              {(payload) => (
                <div className="wx-scroll -mx-1 px-1">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="wx-muted border-b border-[var(--wx-border)] text-left text-xs uppercase tracking-wide">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 font-medium">Conditions</th>
                        <th className="py-2 pr-3 text-right font-medium">High</th>
                        <th className="py-2 pr-3 text-right font-medium">Low</th>
                        <th className="py-2 pr-3 text-right font-medium">Avg</th>
                        <th className="py-2 pr-3 text-right font-medium">Precip</th>
                        <th className="py-2 pr-3 text-right font-medium">Max wind</th>
                        <th className="py-2 text-right font-medium">RH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payload.periods ?? []).map((period, index) => {
                        const date = isoDateOnly(period.dateTimeISO);
                        const isOpen = selectedDate === date;
                        return (
                          <tr
                            key={date || index}
                            onClick={() => date && openDay(date)}
                            className={`cursor-pointer border-b border-[var(--wx-border)] last:border-0 wx-hover ${
                              isOpen ? "bg-[var(--wx-hover)]" : ""
                            }`}
                          >
                            <td className="py-1.5 pr-3 whitespace-nowrap font-medium">
                              {formatDayMonth(period.dateTimeISO)}
                            </td>
                            <td className="wx-muted py-1.5 pr-3">
                              <span className="mr-1.5" aria-hidden>
                                <ConditionGlyph icon={period.icon} coded={period.weatherPrimaryCoded} />
                              </span>
                              {period.weatherPrimary ?? period.weather ?? dash}
                            </td>
                            <td className="py-1.5 pr-3 text-right font-medium wx-hot">
                              {formatTemp(period.maxTempC, period.maxTempF, units)}
                            </td>
                            <td className="py-1.5 pr-3 text-right wx-cold">
                              {formatTemp(period.minTempC, period.minTempF, units)}
                            </td>
                            <td className="wx-muted py-1.5 pr-3 text-right">
                              {formatTemp(period.avgTempC, period.avgTempF, units)}
                            </td>
                            <td className="wx-muted py-1.5 pr-3 text-right">
                              {formatPrecip(period.precipMM, period.precipIN, units)}
                            </td>
                            <td className="wx-muted py-1.5 pr-3 text-right">
                              {formatSpeed(
                                period.windSpeedMaxKPH ?? period.windSpeedKPH,
                                period.windSpeedMaxMPH ?? period.windSpeedMPH,
                                units
                              )}
                            </td>
                            <td className="wx-muted py-1.5 text-right">
                              {formatPercent(period.humidity)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionBody>
          </Card>

          {selectedDate && (
            <Card
              title={`Hour by hour — ${selectedDate}`}
              subtitle="Archived conditions reconstructed for that day"
              action={
                <button
                  type="button"
                  className="wx-btn px-2 py-1 text-xs"
                  onClick={() => {
                    setSelectedDate(null);
                    setDay(null);
                  }}
                >
                  Close
                </button>
              }
            >
              {dayLoading && <Skeleton className="h-40 w-full" />}
              {dayError && <Notice tone="warn">{dayError}</Notice>}
              {day && <ArchiveDay day={day} units={units} hour12={hour12} />}
            </Card>
          )}

          {data.sections.stationSummaries.ok &&
            (data.sections.stationSummaries.data?.periods?.length ?? 0) > 0 && (
              <Card
                title="Station-reported summaries"
                subtitle="Straight from the nearest reporting station, for comparison with the interpolated figures above"
              >
                <div className="wx-scroll -mx-1 px-1">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="wx-muted border-b border-[var(--wx-border)] text-left text-xs uppercase tracking-wide">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 text-right font-medium">High</th>
                        <th className="py-2 pr-3 text-right font-medium">Low</th>
                        <th className="py-2 pr-3 text-right font-medium">Precip</th>
                        <th className="py-2 text-right font-medium">Max wind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.sections.stationSummaries.data?.periods ?? []).map(
                        (period, index) => (
                          <tr
                            key={period.dateTimeISO ?? index}
                            className="border-b border-[var(--wx-border)] last:border-0"
                          >
                            <td className="py-1.5 pr-3">
                              {formatDayMonth(period.dateTimeISO)}
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              {formatTemp(period.maxTempC, period.maxTempF, units)}
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              {formatTemp(period.minTempC, period.minTempF, units)}
                            </td>
                            <td className="py-1.5 pr-3 text-right">
                              {formatPrecip(period.precipMM, period.precipIN, units)}
                            </td>
                            <td className="py-1.5 text-right">
                              {formatSpeed(
                                period.windSpeedMaxKPH ?? period.windSpeedKPH,
                                period.windSpeedMaxMPH ?? period.windSpeedMPH,
                                units
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
        </>
      )}
    </div>
  );
}

function RangeStats({
  periods,
  units,
}: {
  periods: WeatherPeriod[];
  units: UnitSystem;
}) {
  if (periods.length === 0) {
    return <Notice>No daily summaries returned for this range.</Notice>;
  }

  const highs = periods
    .map((p) => ({ v: pickUnit(p.maxTempC, p.maxTempF, units), iso: p.dateTimeISO }))
    .filter((p): p is { v: number; iso: string | undefined } => p.v !== null);
  const lows = periods
    .map((p) => ({ v: pickUnit(p.minTempC, p.minTempF, units), iso: p.dateTimeISO }))
    .filter((p): p is { v: number; iso: string | undefined } => p.v !== null);
  const rain = periods
    .map((p) => ({ v: pickUnit(p.precipMM, p.precipIN, units), iso: p.dateTimeISO }))
    .filter((p): p is { v: number; iso: string | undefined } => p.v !== null);
  const winds = periods
    .map((p) =>
      pickUnit(
        p.windSpeedMaxKPH ?? p.windSpeedKPH,
        p.windSpeedMaxMPH ?? p.windSpeedMPH,
        units
      )
    )
    .filter((v): v is number => v !== null);

  const hottest = highs.reduce((a, b) => (b.v > a.v ? b : a), highs[0]);
  const coldest = lows.reduce((a, b) => (b.v < a.v ? b : a), lows[0]);
  const wettest = rain.reduce((a, b) => (b.v > a.v ? b : a), rain[0]);
  const totalRain = rain.reduce((sum, item) => sum + item.v, 0);
  const wetDays = rain.filter((item) => item.v > 0.2).length;
  const avgHigh = highs.length
    ? highs.reduce((sum, item) => sum + item.v, 0) / highs.length
    : null;
  const avgLow = lows.length
    ? lows.reduce((sum, item) => sum + item.v, 0) / lows.length
    : null;

  const precipUnit = units === "metric" ? "mm" : "in";
  const speedUnit = units === "metric" ? "km/h" : "mph";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <Metric
        label="Warmest day"
        icon={<ThermometerHighIcon />}
        value={hottest ? `${hottest.v.toFixed(1)}°` : dash}
        hint={hottest ? formatDayMonth(hottest.iso) : undefined}
      />
      <Metric
        label="Coldest night"
        icon={<ThermometerLowIcon />}
        value={coldest ? `${coldest.v.toFixed(1)}°` : dash}
        hint={coldest ? formatDayMonth(coldest.iso) : undefined}
      />
      <Metric
        label="Average high"
        value={avgHigh === null ? dash : `${avgHigh.toFixed(1)}°`}
      />
      <Metric
        label="Average low"
        value={avgLow === null ? dash : `${avgLow.toFixed(1)}°`}
      />
      <Metric
        label="Total precipitation"
        icon={<CloudRainIcon />}
        value={`${totalRain.toFixed(units === "metric" ? 1 : 2)} ${precipUnit}`}
        hint={`${wetDays} day${wetDays === 1 ? "" : "s"} with rain`}
      />
      <Metric
        label="Wettest day"
        value={
          wettest ? `${wettest.v.toFixed(units === "metric" ? 1 : 2)} ${precipUnit}` : dash
        }
        hint={wettest ? formatDayMonth(wettest.iso) : undefined}
      />
      <Metric
        label="Peak wind"
        icon={<WindIcon />}
        value={winds.length ? `${Math.max(...winds).toFixed(0)} ${speedUnit}` : dash}
      />
      <Metric label="Days in range" value={String(periods.length)} />
    </div>
  );
}

function ArchiveDay({
  day,
  units,
  hour12,
}: {
  day: ArchiveDayPayload;
  units: UnitSystem;
  hour12: boolean;
}) {
  const hourly = day.sections.hourly.data?.periods ?? [];
  const sun = day.sections.sunMoon.data;

  return (
    <div className="space-y-4">
      {sun && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Sunrise" icon={<SunriseIcon />} value={formatTime(sun.sun?.riseISO, hour12)} />
          <Metric label="Sunset" icon={<SunsetIcon />} value={formatTime(sun.sun?.setISO, hour12)} />
          <Metric
            label="Moon phase"
            icon={<MoonPhaseIcon phase={sun.moon?.phase?.phase} />}
            value={sun.moon?.phase?.name ?? dash}
            hint={
              isNum(sun.moon?.phase?.illum)
                ? `${sun.moon?.phase?.illum?.toFixed(0)}% illuminated`
                : undefined
            }
          />
          <Metric label="Moonrise" value={formatTime(sun.moon?.riseISO, hour12)} />
        </div>
      )}

      <SectionBody section={day.sections.hourly}>
        {() => (
          <SeriesChart
            labels={hourly.map((p) => formatHourLabel(p.dateTimeISO, hour12))}
            height={200}
            series={[
              {
                label: `Temperature (${units === "metric" ? "°C" : "°F"})`,
                color: "#fb923c",
                fill: true,
                values: hourly.map((p) => pickUnit(p.tempC, p.tempF, units)),
                format: (v) => `${v.toFixed(1)}°`,
              },
              {
                label: "Dew point",
                color: "#38bdf8",
                values: hourly.map((p) => pickUnit(p.dewpointC, p.dewpointF, units)),
                format: (v) => `${v.toFixed(1)}°`,
              },
            ]}
            bars={{
              label: `Precip (${units === "metric" ? "mm" : "in"})`,
              color: "#818cf8",
              values: hourly.map((p) => pickUnit(p.precipMM, p.precipIN, units)),
              format: (v) => v.toFixed(2),
            }}
            yFormat={(v) => `${v.toFixed(0)}°`}
            ariaLabel="Archived hourly temperature"
          />
        )}
      </SectionBody>

      <div className="wx-scroll -mx-1 px-1">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="wx-muted border-b border-[var(--wx-border)] text-left text-xs uppercase tracking-wide">
              <th className="py-2 pr-3 font-medium">Time</th>
              <th className="py-2 pr-3 font-medium">Conditions</th>
              <th className="py-2 pr-3 text-right font-medium">Temp</th>
              <th className="py-2 pr-3 text-right font-medium">Dew pt</th>
              <th className="py-2 pr-3 text-right font-medium">RH</th>
              <th className="py-2 pr-3 text-right font-medium">Wind</th>
              <th className="py-2 pr-3 text-right font-medium">Precip</th>
              <th className="py-2 text-right font-medium">Pressure</th>
            </tr>
          </thead>
          <tbody>
            {hourly.map((period, index) => (
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
                <td className="wx-muted py-1.5 text-right">
                  {formatPressure(period.pressureMB, period.pressureIN, units)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {day.sections.observations.ok &&
        (day.sections.observations.data?.periods?.length ?? 0) > 0 && (
          <p className="wx-dim text-xs">
            {day.sections.observations.data?.periods?.length} raw station
            observations were also archived for this day.
          </p>
        )}
    </div>
  );
}
