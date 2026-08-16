"use client";

import { Card, Chip, EmptyState, Metric, Notice, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { ForecastComparison } from "./ForecastComparison";
import { WarningBanner } from "./WarningBanner";
import { ConditionIcon, DropletIcon, EyeIcon, GaugeIcon, SunIcon, WindIcon } from "./icons";
import {
  dash,
  formatDistance,
  formatHourLabel,
  formatPercent,
  formatPressure,
  formatSpeed,
  formatTemp,
  formatTime,
  formatWeekday,
  isNum,
  relativeFromNow,
  uviCategory,
  windDescription,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";
import type { MetOfficeHour } from "@/lib/metoffice-types";

/**
 * Everything the Met Office publishes for this location, in one place.
 *
 * The comparison card on Now and Hourly answers "do the two agree?" and shows
 * one number from each. That is the right question there and the wrong one
 * here: the site-specific product carries feels-like, gusts, visibility,
 * pressure and UV per hour, none of which a two-provider diff has any room for,
 * and the severe weather warnings are the Met Office's alone — Xweather's alert
 * network is NWS-derived and returns nothing for Wales.
 *
 * So this is the full picture from one provider, and the comparison stays where
 * it is. They answer different questions.
 */
export function MetOfficePanel({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const { sections } = overview;
  const section = sections.metoffice;
  const warnings = sections.warnings;

  return (
    <div className="space-y-4">
      <WarningBlock warnings={warnings} />

      {/* Not configured is a setup step rather than a failure. */}
      {!section?.ok && section?.code === "no_credentials" ? (
        <Card title="Met Office forecast" subtitle="Weather DataHub, site specific">
          <Notice>{section.error}</Notice>
          <p className="wx-muted mt-2 text-xs leading-relaxed">
            Create a free account at datahub.metoffice.gov.uk, subscribe to the
            Site Specific product, then set <code>METOFFICE_API_KEY</code> in the
            environment. Forecasts are cached for 30 minutes, so one location
            costs about 48 of the 360 daily calls the free plan allows.
          </p>
        </Card>
      ) : (
        <SectionBody section={section} empty="Met Office forecast unavailable.">
          {(forecast) => {
            const hours = forecast.hours;
            if (hours.length === 0) {
              return (
                <Card title="Met Office forecast">
                  <EmptyState
                    title="No hours returned"
                    note="The Met Office answered but the forecast was empty."
                  />
                </Card>
              );
            }

            const now = hours[0];
            const uv = uviCategory(now.uvi);
            const labels = hours.map((h) => formatHourLabel(h.timeISO, hour12));

            return (
              <>
                <Card
                  title="Met Office forecast"
                  subtitle={
                    forecast.siteName
                      ? `Nearest forecast point: ${forecast.siteName}${
                          isNum(forecast.distanceKM)
                            ? `, ${formatDistance(forecast.distanceKM, forecast.distanceKM * 0.621371, units)} away`
                            : ""
                        }`
                      : "Site-specific forecast"
                  }
                  action={
                    forecast.modelRunISO ? (
                      <Chip title="When the Met Office issued this model run">
                        Run {relativeFromNow(forecast.modelRunISO)}
                      </Chip>
                    ) : undefined
                  }
                  source="Met Office Weather DataHub — site specific"
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <span style={{ color: "var(--wx-accent)" }} aria-hidden>
                      <ConditionIcon kind={now.kind} night={now.night} size={52} />
                    </span>
                    <div>
                      <p className="wx-num text-4xl font-light leading-none">
                        {formatTemp(now.tempC, null, units)}
                      </p>
                      <p className="wx-muted mt-1 text-sm">
                        Feels like {formatTemp(now.feelsLikeC, null, units)} ·{" "}
                        {formatTime(now.timeISO, hour12)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <Metric
                      label="Chance of rain"
                      icon={<DropletIcon />}
                      value={formatPercent(now.pop)}
                    />
                    <Metric
                      label="Wind"
                      icon={<WindIcon />}
                      value={formatSpeed(now.windKPH, now.windKPH ? now.windKPH * 0.621371 : null, units)}
                      hint={windDescription(now.windKPH)}
                    />
                    <Metric
                      label="Gusts"
                      value={formatSpeed(
                        now.windGustKPH,
                        now.windGustKPH ? now.windGustKPH * 0.621371 : null,
                        units
                      )}
                    />
                    <Metric
                      label="Humidity"
                      value={isNum(now.humidity) ? `${Math.round(now.humidity)}%` : dash}
                    />
                    <Metric
                      label="Visibility"
                      icon={<EyeIcon />}
                      value={formatDistance(
                        now.visibilityKM,
                        now.visibilityKM ? now.visibilityKM * 0.621371 : null,
                        units
                      )}
                    />
                    <Metric
                      label="Pressure"
                      icon={<GaugeIcon />}
                      value={formatPressure(
                        now.pressureMB,
                        now.pressureMB ? now.pressureMB * 0.02953 : null,
                        units
                      )}
                    />
                  </div>

                  {isNum(now.uvi) && (
                    <div className="mt-2">
                      <Metric
                        label="UV index"
                        icon={<SunIcon />}
                        value={now.uvi.toFixed(0)}
                        hint={uv.label}
                        accent={uv.color}
                      />
                    </div>
                  )}
                </Card>

                <Card
                  title="Next 48 hours"
                  subtitle="Temperature and feels-like, with chance of rain"
                  source="Met Office Weather DataHub"
                >
                  <SeriesChart
                    height={200}
                    labels={labels}
                    series={[
                      {
                        label: "Temperature",
                        values: hours.map((h) => h.tempC),
                        color: "var(--wx-hot)",
                        fill: true,
                      },
                      {
                        label: "Feels like",
                        values: hours.map((h) => h.feelsLikeC),
                        color: "var(--wx-accent)",
                        dashed: true,
                      },
                    ]}
                    bars={{
                      label: "Chance of rain",
                      values: hours.map((h) => h.pop),
                      color: "var(--wx-cold)",
                      format: (v) => `${v.toFixed(0)}%`,
                    }}
                    yFormat={(v) => `${v.toFixed(0)}°`}
                    ariaLabel="Met Office temperature, feels-like and chance of rain over the next 48 hours"
                  />
                </Card>

                <Card
                  title="Hour by hour"
                  subtitle="Everything the site-specific product publishes"
                  source="Met Office Weather DataHub"
                >
                  <HourStrip hours={hours} units={units} hour12={hour12} />
                </Card>
              </>
            );
          }}
        </SectionBody>
      )}

      {/*
        * The comparison again, in full. It stays on Now and Hourly as the
        * compact "second opinion"; here it is the detailed version, because a
        * page about the Met Office should say where it parts company with the
        * forecast the rest of the app is built on.
        */}
      <ForecastComparison overview={overview} units={units} hour12={hour12} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function WarningBlock({
  warnings,
}: {
  warnings: WeatherOverview["sections"]["warnings"] | undefined;
}) {
  if (!warnings) return null;

  if (!warnings.ok || !warnings.data) {
    return (
      <Card title="Severe weather warnings" source="Met Office NSWWS">
        <Notice tone="warn">{warnings.error ?? "Warnings unavailable."}</Notice>
      </Card>
    );
  }

  const { region, warnings: list } = warnings.data;
  if (list.length === 0) {
    return (
      <Card
        title="Severe weather warnings"
        subtitle={`National Severe Weather Warning Service — ${region}`}
        source="Met Office NSWWS"
      >
        <p className="wx-good-text text-sm">
          No warnings in force for {region}.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Severe weather warnings"
      subtitle={`National Severe Weather Warning Service — ${region}`}
      source="Met Office NSWWS"
    >
      <WarningBanner region={region} warnings={list} />
    </Card>
  );
}

/**
 * The hourly detail as a horizontally scrolling strip rather than a table.
 *
 * Eleven fields per hour will not fit a phone as a grid, and a table that
 * scrolls in both directions is unreadable on one. A strip of columns scrolls
 * the way the data runs — along time — and each column stays whole.
 */
function HourStrip({
  hours,
  units,
  hour12,
}: {
  hours: MetOfficeHour[];
  units: UnitSystem;
  hour12: boolean;
}) {
  return (
    /*
     * `.wx-scroll` on the flex container itself, matching the day/night strip
     * on the 10-day tab. An inner wrapper with `min-width: min-content` inside
     * the scroller forces the scroller to that width instead of scrolling
     * within it — that put 4911px of horizontal overflow on the whole page at
     * 390px, which is the one thing the layout must never do.
     */
    <div className="wx-scroll -mx-1 flex gap-2 px-1 pb-2">
      {hours.map((hour, index) => {
          const newDay =
            index === 0 ||
            formatWeekday(hour.timeISO) !== formatWeekday(hours[index - 1].timeISO);
          return (
            <div
              key={hour.timeISO}
              /*
               * `relative` is load-bearing. The visually-hidden <dt> labels are
               * position:absolute, and with no positioned ancestor they resolve
               * against the initial containing block — their static position is
               * out at the far end of a 5000px strip, which dragged the whole
               * document's scroll width with it and put 4911px of horizontal
               * overflow on the page at 390px. The scroller clipped the visible
               * columns perfectly; absolutely positioned descendants escape it.
               */
              className="wx-inset relative w-[104px] shrink-0 px-2.5 py-2.5 text-center"
            >
              <p className="wx-dim text-[11px]">
                {newDay ? formatWeekday(hour.timeISO) : " "}
              </p>
              <p className="text-xs font-medium">{formatTime(hour.timeISO, hour12)}</p>
              <span
                className="mt-1.5 inline-flex justify-center"
                style={{ color: "var(--wx-accent)" }}
                aria-hidden
              >
                <ConditionIcon kind={hour.kind} night={hour.night} size={26} />
              </span>
              <p className="wx-num mt-1 text-lg font-semibold leading-none">
                {formatTemp(hour.tempC, null, units)}
              </p>
              <p className="wx-dim text-[11px]">
                feels {formatTemp(hour.feelsLikeC, null, units)}
              </p>

              <dl className="wx-dim mt-2 space-y-0.5 text-[11px] leading-snug">
                <div className="flex items-center justify-between gap-1">
                  <dt className="sr-only">Chance of rain</dt>
                  <DropletIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <dd>{formatPercent(hour.pop)}</dd>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <dt className="sr-only">Wind</dt>
                  <WindIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <dd>
                    {formatSpeed(
                      hour.windKPH,
                      hour.windKPH ? hour.windKPH * 0.621371 : null,
                      units
                    )}
                  </dd>
                </div>
                {isNum(hour.windGustKPH) && (
                  <div className="flex items-center justify-between gap-1">
                    <dt>gust</dt>
                    <dd>
                      {formatSpeed(
                        hour.windGustKPH,
                        hour.windGustKPH * 0.621371,
                        units
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-1">
                  <dt>hum</dt>
                  <dd>{isNum(hour.humidity) ? `${Math.round(hour.humidity)}%` : dash}</dd>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <dt className="sr-only">Visibility</dt>
                  <EyeIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <dd>
                    {formatDistance(
                      hour.visibilityKM,
                      hour.visibilityKM ? hour.visibilityKM * 0.621371 : null,
                      units
                    )}
                  </dd>
                </div>
              </dl>
            </div>
        );
      })}
    </div>
  );
}
