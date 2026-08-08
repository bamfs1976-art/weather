"use client";

import { Card, Chip, Meter, Metric, Notice, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import {
  aqiCategory,
  dash,
  formatHourLabel,
  formatNumber,
  formatTime,
  isNum,
  moonPhaseEmoji,
  pollutantLabel,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";

export function AirSunPanel({
  overview,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const { sections } = overview;
  const aq = sections.airQuality.data?.periods?.[0] ?? null;
  const category = aqiCategory(aq?.aqi);
  const sun = sections.sunMoon.data?.sun ?? null;
  const moon = sections.sunMoon.data?.moon ?? null;
  const aqiValue = aq && isNum(aq.aqi) ? aq.aqi : null;
  const moonIllum = moon?.phase?.illum ?? null;
  const moonAge = moon?.phase?.age ?? null;

  return (
    <div className="space-y-4">
      <Card
        title="Air quality"
        subtitle={
          sections.airQuality.data?.profile?.sources?.length
            ? `Source: ${sections.airQuality.data.profile.sources
                .map((s) => s.name)
                .join(", ")}`
            : "Current air quality index and pollutant breakdown"
        }
      >
        <SectionBody section={sections.airQuality}>
          {() => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-5">
                <div
                  className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border-2"
                  style={{
                    borderColor: category.color,
                    background: `${category.color}1a`,
                  }}
                >
                  <span className="text-3xl font-semibold" style={{ color: category.color }}>
                    {aqiValue === null ? dash : Math.round(aqiValue)}
                  </span>
                  <span className="wx-muted text-[10px] uppercase tracking-wide">AQI</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold" style={{ color: category.color }}>
                    {aq?.category ?? category.label}
                  </div>
                  <p className="wx-muted mt-1 text-sm">{category.advice}</p>
                  {aq?.dominant && (
                    <div className="mt-2">
                      <Chip tone="accent">
                        Dominant pollutant: {pollutantLabel(aq.dominant)}
                      </Chip>
                    </div>
                  )}
                </div>
              </div>

              {aq?.pollutants && aq.pollutants.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {aq.pollutants.map((pollutant) => {
                    const tone = aqiCategory(pollutant.aqi);
                    const isParticulate = /pm/i.test(pollutant.type);
                    const value = isParticulate
                      ? pollutant.valueUGM3
                      : pollutant.valuePPB;
                    return (
                      <div key={pollutant.type} className="wx-inset px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {pollutantLabel(pollutant.type)}
                          </span>
                          <span className="text-sm" style={{ color: tone.color }}>
                            {isNum(pollutant.aqi) ? `AQI ${Math.round(pollutant.aqi)}` : dash}
                          </span>
                        </div>
                        <div className="wx-muted mt-0.5 text-xs">
                          {isNum(value)
                            ? `${value.toFixed(1)} ${isParticulate ? "µg/m³" : "ppb"}`
                            : dash}
                          {pollutant.category ? ` · ${pollutant.category}` : ""}
                        </div>
                        <div className="mt-2">
                          <Meter
                            value={pollutant.aqi ?? null}
                            max={300}
                            color={tone.color}
                            label={`${pollutant.type} air quality index`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </SectionBody>
      </Card>

      <Card title="Air quality forecast" subtitle="Next 24 hours">
        <SectionBody section={sections.airQualityForecast}>
          {(data) => {
            const periods = data.periods ?? [];
            if (periods.length === 0) {
              return <Notice>No air quality forecast for this location.</Notice>;
            }
            return (
              <>
                <SeriesChart
                  labels={periods.map((p) => formatHourLabel(p.dateTimeISO, hour12))}
                  height={190}
                  series={[
                    {
                      label: "AQI",
                      color: "#34d399",
                      fill: true,
                      values: periods.map((p) => (isNum(p.aqi) ? p.aqi : null)),
                      format: (v) => `${v.toFixed(0)} (${aqiCategory(v).label})`,
                    },
                  ]}
                  yFormat={(v) => v.toFixed(0)}
                  ariaLabel="Forecast air quality index"
                />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric
                    label="Peak AQI"
                    value={formatNumber(
                      Math.max(
                        ...periods
                          .map((p) => p.aqi)
                          .filter((v): v is number => isNum(v))
                      )
                    )}
                  />
                  <Metric
                    label="Best AQI"
                    value={formatNumber(
                      Math.min(
                        ...periods
                          .map((p) => p.aqi)
                          .filter((v): v is number => isNum(v))
                      )
                    )}
                  />
                  <Metric
                    label="Dominant"
                    value={
                      periods[0]?.dominant ? pollutantLabel(periods[0].dominant) : dash
                    }
                  />
                  <Metric label="Periods" value={String(periods.length)} />
                </div>
              </>
            );
          }}
        </SectionBody>
      </Card>

      <Card title="Sun & moon" subtitle="Daylight, twilight and lunar detail for today">
        <SectionBody section={sections.sunMoon}>
          {() => (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Sunrise" icon="🌅" value={formatTime(sun?.riseISO, hour12)} />
                <Metric label="Solar noon" icon="☀️" value={formatTime(sun?.transitISO, hour12)} />
                <Metric label="Sunset" icon="🌇" value={formatTime(sun?.setISO, hour12)} />
                <Metric
                  label="Day length"
                  icon="⏱️"
                  value={dayLength(sun?.riseISO, sun?.setISO)}
                />
              </div>

              <div>
                <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  Twilight
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric
                    label="Civil"
                    value={`${formatTime(sun?.twilight?.civilBeginISO, hour12)} – ${formatTime(
                      sun?.twilight?.civilEndISO,
                      hour12
                    )}`}
                    hint="Enough light to read outdoors"
                  />
                  <Metric
                    label="Nautical"
                    value={`${formatTime(
                      sun?.twilight?.nauticalBeginISO,
                      hour12
                    )} – ${formatTime(sun?.twilight?.nauticalEndISO, hour12)}`}
                    hint="Horizon still visible at sea"
                  />
                  <Metric
                    label="Astronomical"
                    value={`${formatTime(
                      sun?.twilight?.astronomicalBeginISO,
                      hour12
                    )} – ${formatTime(sun?.twilight?.astronomicalEndISO, hour12)}`}
                    hint="Sky fully dark outside this window"
                  />
                </div>
              </div>

              <div>
                <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  Moon
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric
                    label="Phase"
                    icon={moonPhaseEmoji(moon?.phase?.phase)}
                    value={moon?.phase?.name ?? dash}
                  />
                  <Metric
                    label="Illumination"
                    value={moonIllum === null ? dash : `${moonIllum.toFixed(0)}%`}
                  />
                  <Metric label="Moonrise" value={formatTime(moon?.riseISO, hour12)} />
                  <Metric label="Moonset" value={formatTime(moon?.setISO, hour12)} />
                </div>
                {moonAge !== null && (
                  <p className="wx-dim mt-2 text-xs">
                    {moonAge.toFixed(1)} days into the current lunar cycle.
                  </p>
                )}
              </div>
            </div>
          )}
        </SectionBody>
      </Card>
    </div>
  );
}

function dayLength(
  riseISO: string | null | undefined,
  setISO: string | null | undefined
): string {
  if (!riseISO || !setISO) return dash;
  const rise = Date.parse(riseISO);
  const set = Date.parse(setISO);
  if (Number.isNaN(rise) || Number.isNaN(set) || set <= rise) return dash;
  const minutes = Math.round((set - rise) / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
