"use client";

import { Card, Chip, EmptyState, Notice } from "./ui";
import { SeriesChart } from "./Chart";
import { ConditionIcon } from "./icons";
import {
  agreementLabel,
  compareForecasts,
  dash,
  formatHourLabel,
  formatTemp,
  formatTime,
  formatWeekday,
  isNum,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";

/**
 * Xweather and the Met Office, side by side.
 *
 * The point of the card is the gap, not the numbers: two independent models
 * agreeing is a reason to trust a forecast, and two disagreeing by three
 * degrees at 4pm is worth knowing before deciding anything about 4pm. So the
 * headline is the level of agreement, the chart draws both lines, and the
 * callout names the single hour where they differ most.
 *
 * `compact` renders the one-line version used on the Now tab.
 */
export function ForecastComparison({
  overview,
  units,
  hour12,
  compact = false,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
  compact?: boolean;
}) {
  const section = overview.sections.metoffice;
  const xwHours = overview.sections.hourly.data?.periods ?? [];

  // Not configured is a setup step, not a failure — say how to switch it on.
  if (!section?.ok && section?.code === "no_credentials") {
    if (compact) return null;
    return (
      <Card title="Second opinion" subtitle="Met Office Weather DataHub">
        <Notice>{section.error}</Notice>
        <p className="wx-muted mt-2 text-xs leading-relaxed">
          Create a free account at datahub.metoffice.gov.uk, subscribe to the
          Site Specific product, then set <code>METOFFICE_API_KEY</code> in the
          environment. Forecasts are cached for 30 minutes, so one location costs
          about 48 of the 360 daily calls the free plan allows.
        </p>
      </Card>
    );
  }

  if (!section?.ok || !section.data) {
    if (compact) return null;
    return (
      <Card title="Second opinion" subtitle="Met Office Weather DataHub">
        <Notice tone="warn">{section?.error ?? "Met Office forecast unavailable."}</Notice>
      </Card>
    );
  }

  const forecast = section.data;
  const comparison = compareForecasts(xwHours, forecast.hours);
  const agreement = agreementLabel(comparison.meanAbsTempDeltaC);

  if (comparison.overlap === 0) {
    if (compact) return null;
    return (
      <Card title="Second opinion" subtitle="Met Office Weather DataHub">
        <EmptyState
          title="Nothing to compare yet"
          note="The two forecasts do not currently cover the same hours."
        />
      </Card>
    );
  }

  const first = comparison.hours[0];
  const nextMo = forecast.hours[0];

  /*
   * MET Norway, matched to the same instant rather than to index 0 of its own
   * array. All three providers publish on their own schedule, so "the first
   * hour each of them happens to return" is three different times — the trap
   * compareForecasts already avoids between the other two.
   */
  const metnoHours = overview.sections.metno?.data?.hours ?? [];
  const firstAt = Date.parse(first.timeISO);
  const metnoAt = metnoHours.reduce<{ tempC: number | null; gapMs: number } | null>(
    (best, hour) => {
      const gap = Math.abs(Date.parse(hour.timeISO) - firstAt);
      return Number.isFinite(gap) && (best === null || gap < best.gapMs)
        ? { tempC: hour.tempC, gapMs: gap }
        : best;
    },
    null
  );
  // Half an hour is the same tolerance compareForecasts uses; beyond that the
  // two numbers describe different weather and should not sit side by side.
  const metnoTempC = metnoAt && metnoAt.gapMs <= 30 * 60_000 ? metnoAt.tempC : null;

  /* ------------------------------ compact ------------------------------ */
  if (compact) {
    return (
      <div className="wx-second-opinion">
        <span className="wx-so-label">Met Office</span>
        <span className="wx-so-icon" aria-hidden>
          <ConditionIcon kind={nextMo.kind} night={nextMo.night} size={20} />
        </span>
        <span className="wx-num wx-so-temp">
          {formatTemp(first.metofficeTempC, null, units)}
        </span>
        <span className="wx-so-vs">
          vs {formatTemp(first.xweatherTempC, null, units)} Xweather
        </span>
        <Chip tone={agreement.tone}>{agreement.label}</Chip>
      </div>
    );
  }

  /* ------------------------------- full -------------------------------- */
  const labels = comparison.hours.map((hour) => formatHourLabel(hour.timeISO, hour12));

  return (
    <Card
      title="Second opinion"
      subtitle={`Met Office against Xweather, next ${comparison.overlap} hours`}
      source="Xweather · Met Office DataHub · MET Norway"
      action={<Chip tone={agreement.tone}>{agreement.label}</Chip>}
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ProviderBox
            name="Xweather"
            temp={formatTemp(first.xweatherTempC, null, units)}
            note="Now"
          />
          <ProviderBox
            name="Met Office"
            temp={formatTemp(first.metofficeTempC, null, units)}
            note={forecast.siteName ?? "Nearest site"}
            icon={<ConditionIcon kind={nextMo.kind} night={nextMo.night} size={20} />}
          />
          {metnoTempC !== null && (
            <ProviderBox
              name="MET Norway"
              temp={formatTemp(metnoTempC, null, units)}
              note="Third opinion"
            />
          )}
          <ProviderBox
            name="Average gap"
            temp={
              isNum(comparison.meanAbsTempDeltaC)
                ? `${comparison.meanAbsTempDeltaC.toFixed(1)}°`
                : dash
            }
            note="mean difference"
          />
          <ProviderBox
            name="Bias"
            temp={
              isNum(comparison.biasC)
                ? `${comparison.biasC > 0 ? "+" : ""}${comparison.biasC.toFixed(1)}°`
                : dash
            }
            note={
              isNum(comparison.biasC)
                ? comparison.biasC > 0.2
                  ? "Met Office warmer"
                  : comparison.biasC < -0.2
                    ? "Xweather warmer"
                    : "no lean"
                : undefined
            }
          />
        </div>

        <SeriesChart
          labels={labels}
          height={200}
          series={[
            {
              label: "Xweather",
              color: "var(--wx-accent)",
              values: comparison.hours.map((hour) => hour.xweatherTempC),
              format: (v) => `${v.toFixed(1)}°`,
            },
            {
              label: "Met Office",
              color: "var(--wx-solar)",
              dashed: true,
              values: comparison.hours.map((hour) => hour.metofficeTempC),
              format: (v) => `${v.toFixed(1)}°`,
            },
          ]}
          yFormat={(v) => `${v.toFixed(0)}°`}
          ariaLabel="Xweather and Met Office temperature forecasts compared"
        />

        {/*
          The single most useful sentence on the card: where and by how much the
          two models part company, in words rather than as a gap on a chart the
          reader has to spot for themselves.
        */}
        <div className="grid gap-2 sm:grid-cols-2">
          {comparison.widestTemp && isNum(comparison.widestTemp.tempDeltaC) && (
            <div className="wx-inset p-3">
              <div className="wx-tile-label">Widest temperature gap</div>
              <p className="mt-1 text-sm">
                <strong className="wx-num">
                  {Math.abs(comparison.widestTemp.tempDeltaC).toFixed(1)}°
                </strong>{" "}
                apart at{" "}
                <strong>
                  {formatWeekday(comparison.widestTemp.timeISO)}{" "}
                  {formatTime(comparison.widestTemp.timeISO, hour12)}
                </strong>
                {" — "}
                {comparison.widestTemp.tempDeltaC > 0 ? "Met Office" : "Xweather"} the
                warmer at{" "}
                <span className="wx-num">
                  {formatTemp(
                    Math.max(
                      comparison.widestTemp.metofficeTempC ?? -Infinity,
                      comparison.widestTemp.xweatherTempC ?? -Infinity
                    ),
                    null,
                    units
                  )}
                </span>
                .
              </p>
            </div>
          )}

          {comparison.widestPop && isNum(comparison.widestPop.popDelta) && (
            <div className="wx-inset p-3">
              <div className="wx-tile-label">Widest rain-chance gap</div>
              <p className="mt-1 text-sm">
                <strong className="wx-num">
                  {Math.abs(comparison.widestPop.popDelta).toFixed(0)} points
                </strong>{" "}
                apart at{" "}
                <strong>
                  {formatWeekday(comparison.widestPop.timeISO)}{" "}
                  {formatTime(comparison.widestPop.timeISO, hour12)}
                </strong>
                {" — "}Xweather{" "}
                <span className="wx-num">{comparison.widestPop.xweatherPop}%</span>,
                Met Office{" "}
                <span className="wx-num">{comparison.widestPop.metofficePop}%</span>.
              </p>
            </div>
          )}
        </div>

        <p className="wx-dim text-xs leading-relaxed">
          Met Office data from the Weather DataHub site-specific forecast
          {forecast.siteName ? ` for ${forecast.siteName}` : ""}
          {isNum(forecast.distanceKM)
            ? `, ${forecast.distanceKM.toFixed(1)} km from the requested point`
            : ""}
          {forecast.modelRunISO
            ? ` · model run ${formatTime(forecast.modelRunISO, hour12)}`
            : ""}
          . Cached for 30 minutes to stay inside the free plan&rsquo;s 360 calls a
          day. Two models differing by a degree is ordinary; a persistent gap of
          several usually means they disagree about cloud or wind direction.
        </p>
      </div>
    </Card>
  );
}

function ProviderBox({
  name,
  temp,
  note,
  icon,
}: {
  name: string;
  temp: string;
  note?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="wx-inset p-3">
      <div className="wx-tile-label">{name}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        {icon ? <span aria-hidden style={{ color: "var(--wx-solar)" }}>{icon}</span> : null}
        <span className="wx-num text-xl font-medium">{temp}</span>
      </div>
      {note ? <div className="wx-tile-hint">{note}</div> : null}
    </div>
  );
}
