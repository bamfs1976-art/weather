"use client";

import { Card, Chip, Metric, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { formatTime, isNum } from "@/lib/weather-format";
import type { Section } from "@/lib/weather-types";
import type { ModelSpread } from "@/lib/model-types";

/**
 * How much the forecast models actually agree.
 *
 * Every other card here answers "what is the forecast". This one answers "how
 * much should you trust it", which is the question that matters when the answer
 * does. When UKMO, ECMWF and GFS sit within half a degree of each other the
 * forecast is as settled as it gets; when they are three degrees apart, the
 * single number on the hero is a coin toss dressed up as a fact.
 *
 * Shown as the envelope — warmest and coldest model per hour — rather than one
 * line per model. Four overlapping lines is a spaghetti chart nobody reads; the
 * width of the band is the whole message, and the per-model lines are still
 * available underneath for anyone who wants them.
 */

/** Bands chosen so the wording matches what the number means, not the reverse. */
function describeSpread(mean: number | null): { label: string; tone: "good" | "warn" | "danger" | "default" } {
  if (mean === null) return { label: "Not enough agreement data", tone: "default" };
  if (mean < 1) return { label: "Models closely agreed", tone: "good" };
  if (mean < 2) return { label: "Broad agreement", tone: "good" };
  if (mean < 3.5) return { label: "Some disagreement", tone: "warn" };
  return { label: "Models disagree — low confidence", tone: "danger" };
}

export function ModelSpreadCard({
  section,
  hour12,
}: {
  section: Section<ModelSpread> | undefined;
  hour12: boolean;
}) {
  return (
    <Card
      title="Model agreement"
      subtitle="The same 48 hours from four national forecast models"
      source="Open-Meteo, serving each model's raw output"
    >
      <SectionBody section={section} empty="Model comparison unavailable.">
        {(spread) => {
          const values = spread.spreadC.filter((v): v is number => v !== null);
          const meanSpread = values.length
            ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
            : null;
          const peak = values.length ? Math.max(...values) : null;
          const verdict = describeSpread(meanSpread);

          /* The envelope: coldest and warmest model at each hour. */
          const low: (number | null)[] = [];
          const high: (number | null)[] = [];
          for (let h = 0; h < spread.hours.length; h++) {
            const at = spread.models
              .map((m) => m.tempC[h])
              .filter((v): v is number => v !== null);
            low.push(at.length ? Math.min(...at) : null);
            high.push(at.length ? Math.max(...at) : null);
          }

          const labels = spread.hours.map((iso) => formatTime(iso, hour12));

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={verdict.tone}>{verdict.label}</Chip>
                {spread.missing.length > 0 && (
                  <Chip title="These models did not answer, so the spread is narrower than the full picture">
                    {spread.missing.join(", ")} unavailable
                  </Chip>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric
                  label="Average spread"
                  value={isNum(meanSpread) ? `${meanSpread.toFixed(1)}°C` : "—"}
                  hint="across the next 48 hours"
                />
                <Metric
                  label="Widest"
                  value={isNum(peak) ? `${peak.toFixed(1)}°C` : "—"}
                  hint="furthest the models get apart"
                />
                <Metric
                  label="Models"
                  value={String(spread.models.length)}
                  hint={spread.models.map((m) => m.label).join(", ")}
                />
              </div>

              <SeriesChart
                height={190}
                labels={labels}
                series={[
                  { label: "Warmest model", values: high, color: "var(--wx-hot)", fill: true },
                  { label: "Coldest model", values: low, color: "var(--wx-cold)", fill: true },
                  { label: "Mean", values: spread.meanC, color: "var(--wx-accent)", dashed: true },
                ]}
                yFormat={(v) => `${v.toFixed(0)}°`}
                ariaLabel="Temperature range across the forecast models over the next 48 hours"
              />

              <div className="space-y-2">
                {spread.models.map((model) => {
                  const own = model.tempC.filter((v): v is number => v !== null);
                  const now = model.tempC.find((v) => v !== null) ?? null;
                  return (
                    <div
                      key={model.id}
                      className="wx-inset flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
                    >
                      <span className="text-sm font-medium">
                        {model.label}
                        <span className="wx-muted font-normal"> · {model.centre}</span>
                      </span>
                      <span className="wx-dim text-xs">
                        {isNum(now) ? `${now.toFixed(1)}°C now` : "—"}
                        {own.length
                          ? ` · ${Math.min(...own).toFixed(0)}° to ${Math.max(...own).toFixed(0)}° over 48h`
                          : ""}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="wx-dim text-xs leading-relaxed">
                Spread is the gap between the warmest and coldest model at each
                hour. It measures agreement, not accuracy — models can agree and
                still be wrong together, which is most likely in a settled
                easterly or a slow-moving front.
              </p>
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}
