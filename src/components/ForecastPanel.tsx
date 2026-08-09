"use client";

import { useState } from "react";
import { Card, Chip, Meter, Metric, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { CloudRainIcon, ConditionGlyph, WindIcon } from "@/components/icons";
import {
  dash,
  formatDayMonth,
  formatNumber,
  formatPercent,
  formatPrecip,
  formatSnow,
  formatSpeed,
  formatTemp,
  formatTime,
  formatWeekday,
  isNum,
  pickUnit,
  tempValue,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview, WeatherPeriod } from "@/lib/weather-types";

export function ForecastPanel({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const [openDay, setOpenDay] = useState<number | null>(0);

  return (
    <div className="space-y-4">
      <Card title="10-day outlook" subtitle="Daily highs, lows and precipitation">
        <SectionBody section={overview.sections.daily}>
          {(data) => {
            const periods = data.periods ?? [];
            return (
              <SeriesChart
                labels={periods.map((p) => formatWeekday(p.dateTimeISO ?? p.validTime))}
                height={210}
                series={[
                  {
                    label: `High (${units === "metric" ? "°C" : "°F"})`,
                    color: "#fb923c",
                    fill: true,
                    values: periods.map((p) =>
                      tempValue(p.maxTempC, p.maxTempF, units)
                    ),
                    format: (v) => `${v.toFixed(0)}°`,
                  },
                  {
                    label: "Low",
                    color: "#60a5fa",
                    fill: true,
                    values: periods.map((p) =>
                      tempValue(p.minTempC, p.minTempF, units)
                    ),
                    format: (v) => `${v.toFixed(0)}°`,
                  },
                ]}
                bars={{
                  label: `Precip (${units === "metric" ? "mm" : "in"})`,
                  color: "#38bdf8",
                  values: periods.map((p) =>
                    pickUnit(p.precipMM, p.precipIN, units)
                  ),
                  format: (v) => v.toFixed(2),
                }}
                yFormat={(v) => `${v.toFixed(0)}°`}
                showEvery={1}
                ariaLabel="Ten-day high and low temperature forecast"
              />
            );
          }}
        </SectionBody>
      </Card>

      <Card title="Daily detail" subtitle="Select a day for the full breakdown">
        <SectionBody section={overview.sections.daily}>
          {(data) => {
            const periods = data.periods ?? [];
            const highs = periods
              .map((p) => tempValue(p.maxTempC, p.maxTempF, units))
              .filter((v): v is number => v !== null);
            const lows = periods
              .map((p) => tempValue(p.minTempC, p.minTempF, units))
              .filter((v): v is number => v !== null);
            const spanMax = highs.length ? Math.max(...highs) : 1;
            const spanMin = lows.length ? Math.min(...lows) : 0;

            return (
              <ul className="divide-y divide-[var(--wx-border)]">
                {periods.map((period, index) => {
                  const iso = period.dateTimeISO ?? period.validTime ?? "";
                  const high = tempValue(period.maxTempC, period.maxTempF, units);
                  const low = tempValue(period.minTempC, period.minTempF, units);
                  const isOpen = openDay === index;
                  return (
                    <li key={iso || index}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 py-2.5 text-left wx-hover"
                        onClick={() => setOpenDay(isOpen ? null : index)}
                        aria-expanded={isOpen}
                      >
                        <span className="w-16 shrink-0">
                          <span className="block text-sm font-medium">
                            {index === 0 ? "Today" : formatWeekday(iso)}
                          </span>
                          <span className="wx-dim block text-[11px]">
                            {formatDayMonth(iso)}
                          </span>
                        </span>
                        <span className="w-8 shrink-0 text-center text-xl" aria-hidden>
                          <ConditionGlyph icon={period.icon} coded={period.weatherPrimaryCoded} />
                        </span>
                        <span className="wx-muted hidden min-w-0 flex-1 truncate text-sm sm:block">
                          {period.weather ?? period.weatherPrimary ?? dash}
                        </span>
                        <span className="w-14 shrink-0 text-right text-xs wx-cold">
                          {isNum(period.pop) && period.pop > 0 ? (
                            <span className="inline-flex items-center justify-end gap-1">
                              <CloudRainIcon className="h-3 w-3" />
                              {period.pop}%
                            </span>
                          ) : (
                            ""
                          )}
                        </span>
                        <span className="flex w-36 shrink-0 items-center gap-2">
                          <span className="wx-muted w-8 text-right text-sm">
                            {low === null ? dash : `${low.toFixed(0)}°`}
                          </span>
                          <TempBar
                            low={low}
                            high={high}
                            scaleMin={spanMin}
                            scaleMax={spanMax}
                          />
                          <span className="w-8 text-sm font-semibold">
                            {high === null ? dash : `${high.toFixed(0)}°`}
                          </span>
                        </span>
                      </button>

                      {isOpen && (
                        <DayDetail
                          period={period}
                          dayNight={findDayNight(overview, iso)}
                          units={units}
                          hour12={hour12}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          }}
        </SectionBody>
      </Card>

      <Card
        title="Day & night periods"
        subtitle="Separate daytime and overnight forecasts, the way a broadcast reads them"
      >
        <SectionBody section={overview.sections.dayNight}>
          {(data) => (
            <div className="wx-scroll -mx-1 flex gap-2 px-1 pb-2">
              {(data.periods ?? []).map((period, index) => {
                const iso = period.dateTimeISO ?? period.validTime ?? "";
                const isDay = period.isDay !== false;
                return (
                  <div
                    key={iso || index}
                    className="wx-inset w-[150px] shrink-0 px-3 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {formatWeekday(iso)}
                      </span>
                      <Chip tone={isDay ? "warn" : "default"}>
                        {isDay ? "Day" : "Night"}
                      </Chip>
                    </div>
                    <div className="my-1.5 text-3xl" aria-hidden>
                      <ConditionGlyph icon={period.icon} coded={period.weatherPrimaryCoded} />
                    </div>
                    <div className="text-xl font-semibold">
                      {formatTemp(
                        isDay ? period.maxTempC : period.minTempC,
                        isDay ? period.maxTempF : period.minTempF,
                        units
                      )}
                    </div>
                    <p className="wx-muted mt-1 text-xs leading-snug">
                      {period.weather ?? period.weatherPrimary ?? dash}
                    </p>
                    <div className="wx-dim mt-2 space-y-0.5 text-[11px]">
                      <div className="flex items-center gap-1">
                        <CloudRainIcon className="h-3 w-3 shrink-0" />
                        {formatPercent(period.pop)}
                      </div>
                      <div className="flex items-center gap-1">
                        <WindIcon className="h-3 w-3 shrink-0" />
                        {formatSpeed(
                          period.windSpeedKPH ?? period.windSpeedMaxKPH,
                          period.windSpeedMPH ?? period.windSpeedMaxMPH,
                          units
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionBody>
      </Card>
    </div>
  );
}

function findDayNight(
  overview: WeatherOverview,
  iso: string
): WeatherPeriod[] {
  const day = iso.slice(0, 10);
  return (overview.sections.dayNight.data?.periods ?? []).filter((period) =>
    (period.dateTimeISO ?? period.validTime ?? "").startsWith(day)
  );
}

function TempBar({
  low,
  high,
  scaleMin,
  scaleMax,
}: {
  low: number | null;
  high: number | null;
  scaleMin: number;
  scaleMax: number;
}) {
  if (low === null || high === null || scaleMax === scaleMin) {
    return <span className="h-1.5 flex-1 rounded-full wx-track" />;
  }
  const range = scaleMax - scaleMin;
  const left = ((low - scaleMin) / range) * 100;
  const width = Math.max(4, ((high - low) / range) * 100);
  return (
    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full wx-track">
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${left}%`,
          width: `${width}%`,
          background: "linear-gradient(90deg,#60a5fa,#fb923c)",
        }}
      />
    </span>
  );
}

function DayDetail({
  period,
  dayNight,
  units,
  hour12,
}: {
  period: WeatherPeriod;
  dayNight: WeatherPeriod[];
  units: UnitSystem;
  hour12: boolean;
}) {
  return (
    <div className="wx-fade pb-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Metric
          label="High / Low"
          value={`${formatTemp(period.maxTempC, period.maxTempF, units)} / ${formatTemp(
            period.minTempC,
            period.minTempF,
            units
          )}`}
        />
        <Metric
          label="Feels like"
          value={`${formatTemp(
            period.maxFeelslikeC,
            period.maxFeelslikeF,
            units
          )} / ${formatTemp(period.minFeelslikeC, period.minFeelslikeF, units)}`}
        />
        <Metric
          label="Chance of precip"
          value={formatPercent(period.pop)}
        />
        <Metric
          label="Precip amount"
          value={formatPrecip(period.precipMM, period.precipIN, units)}
        />
        <Metric
          label="Snow"
          value={formatSnow(period.snowCM, period.snowIN, units)}
        />
        <Metric
          label="Max wind"
          value={formatSpeed(
            period.windSpeedMaxKPH ?? period.windSpeedKPH,
            period.windSpeedMaxMPH ?? period.windSpeedMPH,
            units
          )}
          hint={period.windDirMax ?? period.windDir ?? undefined}
        />
        <Metric
          label="Gusts"
          value={formatSpeed(period.windGustKPH, period.windGustMPH, units)}
        />
        <Metric
          label="Humidity"
          value={
            isNum(period.minHumidity) && isNum(period.maxHumidity)
              ? `${period.minHumidity}–${period.maxHumidity}%`
              : formatPercent(period.humidity)
          }
        />
        <Metric label="Max UV" value={formatNumber(period.maxUvi ?? period.uvi, "", 0)} />
        <Metric label="Cloud cover" value={formatPercent(period.sky)} />
        <Metric
          label="Sunrise"
          value={formatTime(period.sunriseISO, hour12)}
        />
        <Metric label="Sunset" value={formatTime(period.sunsetISO, hour12)} />
      </div>

      {isNum(period.pop) && (
        <div className="mt-3">
          <Meter value={period.pop} color="#818cf8" label="Chance of precipitation" />
        </div>
      )}

      {dayNight.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {dayNight.map((slice, index) => (
            <div key={index} className="wx-inset px-3 py-2">
              <div className="wx-muted text-[11px] uppercase tracking-wide">
                {slice.isDay === false ? "Overnight" : "Daytime"}
              </div>
              <p className="mt-0.5 text-sm">
                {slice.weather ?? slice.weatherPrimary ?? dash}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
