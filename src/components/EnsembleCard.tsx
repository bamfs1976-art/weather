"use client";

import { Card, Chip, Metric, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { formatHourLabel, isNum } from "@/lib/weather-format";
import type { Section } from "@/lib/weather-types";
import type { EnsembleForecast } from "@/lib/ensemble-types";

/**
 * Probability from an ensemble, which is the honest kind.
 *
 * The Model agreement card next to this one compares four models that each ran
 * once; their spread is a reasonable proxy for confidence but it is still an
 * inference. Here the same model has been run dozens of times from slightly
 * different starting states, so "40% chance of rain" is literally the share of
 * runs that produced rain, and the shaded band is where eight runs in ten land.
 */
export function EnsembleCard({
  section,
  hour12,
}: {
  section: Section<EnsembleForecast> | undefined;
  hour12: boolean;
}) {
  return (
    <Card
      title="How certain is it?"
      subtitle="One model run many times over, so the spread is a probability rather than a guess"
      source="Open-Meteo ensemble API"
    >
      <SectionBody section={section} empty="No ensemble available for this location.">
        {(data) => {
          const labels = data.hours.map((h) => formatHourLabel(h.timeISO, hour12));
          const chances = data.hours
            .map((h) => h.rainChance)
            .filter((v): v is number => v !== null);
          const peak = chances.length ? Math.max(...chances) : null;
          const peakAt = peak === null ? null : data.hours.find((h) => h.rainChance === peak);
          /* Widest p10–p90 gap: where the members disagree most about temperature. */
          const widest = data.hours.reduce<{ gap: number; at: string } | null>((best, h) => {
            if (!isNum(h.p10C) || !isNum(h.p90C)) return best;
            const gap = h.p90C - h.p10C;
            return best === null || gap > best.gap ? { gap, at: h.timeISO } : best;
          }, null);

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="accent">{data.model}</Chip>
                <span className="wx-dim text-xs">
                  {data.members} members · {data.note}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric
                  label="Peak rain chance"
                  value={peak === null ? "—" : `${peak}%`}
                  hint={
                    peakAt ? `around ${formatHourLabel(peakAt.timeISO, hour12)}` : undefined
                  }
                />
                <Metric
                  label="Widest disagreement"
                  value={widest ? `${widest.gap.toFixed(1)}°C` : "—"}
                  hint={widest ? `at ${formatHourLabel(widest.at, hour12)}` : undefined}
                />
                <Metric
                  label="Members"
                  value={String(data.members)}
                  hint="separate runs"
                />
              </div>

              <SeriesChart
                height={200}
                labels={labels}
                series={[
                  {
                    label: "Warmest 10%",
                    values: data.hours.map((h) => h.p90C),
                    color: "var(--wx-hot)",
                    fill: true,
                  },
                  {
                    label: "Coldest 10%",
                    values: data.hours.map((h) => h.p10C),
                    color: "var(--wx-cold)",
                    fill: true,
                  },
                  {
                    label: "Median",
                    values: data.hours.map((h) => h.medianC),
                    color: "var(--wx-accent)",
                  },
                ]}
                bars={{
                  label: "Chance of rain",
                  values: data.hours.map((h) => h.rainChance),
                  color: "var(--wx-cold)",
                  format: (v) => `${v.toFixed(0)}%`,
                }}
                yFormat={(v) => `${v.toFixed(0)}°`}
                ariaLabel="Ensemble temperature range and rain probability over the next 48 hours"
              />

              <p className="wx-dim text-xs leading-relaxed">
                The band covers the middle 80% of runs — eight members in ten
                land inside it. A narrow band means the ensemble has settled on
                one outcome; a wide one means it genuinely does not know yet.
                Chance of rain is the share of members producing at least
                0.1&nbsp;mm in that hour.
              </p>
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}
