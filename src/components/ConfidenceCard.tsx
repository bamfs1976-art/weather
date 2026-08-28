"use client";

import { Card, Chip, Metric, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { dash, formatTemp, formatWeekday, isNum, tempValue } from "@/lib/weather-format";
import type { Section, UnitSystem } from "@/lib/weather-types";
import type { MetOfficeDaily, MetOfficeDay } from "@/lib/metoffice-types";

/**
 * How sure the Met Office is, in the Met Office's own numbers.
 *
 * The Open-Meteo ensemble card this replaces for UK locations answers the same
 * question by a different route — one model run dozens of times, with the
 * spread of the members standing in for confidence. That is a good answer, but
 * it is a *different forecaster's* uncertainty about a Met Office-led page.
 *
 * The daily site-specific response already carries the Met Office's own 95%
 * interval on each day's headline temperature: a lower bound it expects to be
 * exceeded 97.5% of the time and an upper bound it expects to stay under 97.5%
 * of the time. It arrives in a response the app already fetches, so this costs
 * nothing — no extra call, no extra allowance.
 *
 * The gap between the bounds is the reading: a tight band is a day the models
 * agree on, a wide one is a day to check again tomorrow.
 */
export function ConfidenceCard({
  section,
  units,
}: {
  section: Section<MetOfficeDaily> | undefined;
  units: UnitSystem;
}) {
  return (
    <Card
      title="How certain is it?"
      subtitle="The Met Office's own 95% range on each day's high — a wide band is a day that could still change"
      source="Met Office DataHub"
    >
      <SectionBody section={section} empty="No daily forecast for this location.">
        {(data) => {
          const days = data.days.filter(
            (d) => isNum(d.maxTempBounds.lowerC) && isNum(d.maxTempBounds.upperC)
          );

          if (days.length === 0) {
            return (
              <p className="wx-muted text-sm">
                This forecast did not carry confidence bounds.
              </p>
            );
          }

          const widest = days.reduce<MetOfficeDay | null>((best, day) => {
            const gap = spread(day);
            const bestGap = best ? spread(best) : null;
            return gap !== null && (bestGap === null || gap > bestGap) ? day : best;
          }, null);
          const tightest = days.reduce<MetOfficeDay | null>((best, day) => {
            const gap = spread(day);
            const bestGap = best ? spread(best) : null;
            return gap !== null && (bestGap === null || gap < bestGap) ? day : best;
          }, null);

          const labels = days.map((d) => formatWeekday(d.timeISO));

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric
                  label="Most settled day"
                  value={tightest ? formatWeekday(tightest.timeISO) : dash}
                  hint={
                    tightest && spread(tightest) !== null
                      ? `${degrees(spread(tightest), units)} range`
                      : undefined
                  }
                />
                <Metric
                  label="Least settled day"
                  value={widest ? formatWeekday(widest.timeISO) : dash}
                  hint={
                    widest && spread(widest) !== null
                      ? `${degrees(spread(widest), units)} range`
                      : undefined
                  }
                />
                <Metric
                  label="Days with a range"
                  value={`${days.length}`}
                  hint="from the daily forecast"
                />
              </div>

              <SeriesChart
                labels={labels}
                height={210}
                series={[
                  {
                    label: `Could reach (${units === "metric" ? "°C" : "°F"})`,
                    color: "#f97316",
                    values: days.map((d) =>
                      tempValue(d.maxTempBounds.upperC, f(d.maxTempBounds.upperC), units)
                    ),
                  },
                  {
                    label: "Most likely high",
                    color: "#38bdf8",
                    values: days.map((d) => tempValue(d.maxTempC, f(d.maxTempC), units)),
                  },
                  {
                    label: "Could stay at",
                    color: "#818cf8",
                    values: days.map((d) =>
                      tempValue(d.maxTempBounds.lowerC, f(d.maxTempBounds.lowerC), units)
                    ),
                  },
                ]}
              />

              <div className="wx-scroll -mx-1 flex gap-2 px-1 pb-1">
                {days.map((day) => (
                  <div
                    key={day.timeISO}
                    className="wx-field relative shrink-0 text-center"
                    style={{ minWidth: "5.5rem" }}
                  >
                    <div className="wx-dim text-xs">{formatWeekday(day.timeISO)}</div>
                    <div className="wx-num mt-1 text-sm">
                      {formatTemp(day.maxTempBounds.lowerC, f(day.maxTempBounds.lowerC), units)}–
                      {formatTemp(day.maxTempBounds.upperC, f(day.maxTempBounds.upperC), units)}
                    </div>
                    <div className="mt-1">
                      <Chip tone={toneFor(spread(day))}>
                        {spread(day) === null ? dash : degrees(spread(day), units)}
                      </Chip>
                    </div>
                  </div>
                ))}
              </div>

              <p className="wx-muted text-xs leading-relaxed">
                The band is where the Met Office expects the day&rsquo;s high to land 95
                times in 100. It measures how settled the forecast is, not how warm the
                day will be.
              </p>
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

/*
 * The Met Office publishes Celsius only, so the Fahrenheit variant every
 * formatter expects has to be derived here. Passing null as the imperial value
 * would have left the whole card blank for anyone on °F.
 */
function f(c: number | null): number | null {
  return c === null ? null : c * 1.8 + 32;
}

/** Width of the day's 95% band, in °C, or null when a bound is missing. */
function spread(day: MetOfficeDay): number | null {
  const { lowerC, upperC } = day.maxTempBounds;
  if (!isNum(lowerC) || !isNum(upperC)) return null;
  return upperC - lowerC;
}

/**
 * A range is a difference, so it converts as a scale rather than a temperature:
 * a 4 °C spread is 7.2 °F, not 39.2 °F. Passing it through `formatTemp` would
 * add the 32° offset and quietly turn every band into nonsense.
 */
function degrees(gapC: number | null, units: UnitSystem): string {
  if (!isNum(gapC)) return dash;
  const value = units === "metric" ? gapC : gapC * 1.8;
  return `${value.toFixed(1)}°`;
}

/** Tight bands read as good news, wide ones as a caution. */
function toneFor(gapC: number | null): "good" | "default" | "warn" {
  if (!isNum(gapC)) return "default";
  if (gapC <= 2) return "good";
  if (gapC >= 5) return "warn";
  return "default";
}
