"use client";

import { Card, Chip } from "./ui";
import { useNow } from "./useClock";
import {
  RAIN_INTENSITY_LABEL,
  formatTime,
  isNum,
  minutesUntilLabel,
  rainIntensity,
  rainOutlook,
} from "@/lib/weather-format";
import type { RainIntensity } from "@/lib/weather-format";
import type { MinutelyPeriod, Section, UnitSystem } from "@/lib/weather-types";

/**
 * "Is it about to rain?", answered in a sentence.
 *
 * The card this replaces drew a correct chart of the next hour and left the
 * reader to work out the answer from it. The question people actually ask a
 * weather app on the way out of the door is not "what is the precipitation
 * rate profile" but "do I need a coat, and have I got twenty minutes" — so the
 * headline is a sentence and the chart is the supporting detail rather than
 * the other way round.
 *
 * Two hours of quarter-hour steps, from a forecast the page already fetched.
 *
 * **This is a model, not radar.** The band it draws is the numerical forecast
 * downscaled to fifteen minutes, so it is good at "rain this hour" and less
 * sharp than a radar nowcast at "rain in eight minutes". The footnote says so;
 * do not let the confident phrasing of the headline outrun it.
 */

const BAR_COLOUR: Record<RainIntensity, string> = {
  none: "var(--wx-border-strong)",
  spots: "#7dd3fc",
  light: "#38bdf8",
  moderate: "#3b82f6",
  heavy: "#6366f1",
};

const TONE: Record<RainIntensity, "default" | "accent" | "warn"> = {
  none: "default",
  spots: "default",
  light: "accent",
  moderate: "accent",
  heavy: "warn",
};

export function RainTimeline({
  section,
  units,
  hour12,
}: {
  section: Section<{ periods: MinutelyPeriod[] }> | undefined;
  units: UnitSystem;
  hour12: boolean;
}) {
  /*
   * 0 until the browser takes over. Every relative phrase below is omitted at
   * that point rather than guessed, so the first paint is less specific than
   * the second but never disagrees with it.
   */
  const now = useNow();
  const periods = section?.data?.periods ?? [];

  if (!section?.ok || periods.length === 0) return null;

  const outlook = rainOutlook(periods);
  const rates = periods.map((p) =>
    isNum(p.precipRateMM) ? p.precipRateMM : isNum(p.precipMM) ? p.precipMM : 0
  );
  const scale = Math.max(1, ...rates);

  const startIn = minutesUntilLabel(outlook.startsISO, now);
  const endIn = minutesUntilLabel(outlook.endsISO, now);

  /* The headline. Each branch is a complete sentence on its own. */
  let headline: string;
  let detail: string | null = null;

  if (outlook.dry) {
    headline = `No rain expected for at least ${formatWindow(outlook.windowMinutes)}`;
  } else if (outlook.rainingNow) {
    headline = `${RAIN_INTENSITY_LABEL[outlook.peak]} right now`;
    detail = outlook.endsISO
      ? `Easing around ${formatTime(outlook.endsISO, hour12)}${endIn ? ` — ${endIn}` : ""}`
      : "No let-up in the next two hours";
  } else {
    headline = `${RAIN_INTENSITY_LABEL[outlook.peak]} ${
      startIn ?? `from ${formatTime(outlook.startsISO, hour12)}`
    }`;
    const until = outlook.endsISO
      ? `until about ${formatTime(outlook.endsISO, hour12)}`
      : "with no let-up in the window";
    detail = `Starting ${formatTime(outlook.startsISO, hour12)}, ${until}`;
  }

  return (
    <Card
      title="Rain in the next two hours"
      subtitle={headline}
      source="Open-Meteo (15-minute forecast)"
      action={
        outlook.dry ? (
          <Chip tone="good">Dry</Chip>
        ) : (
          <Chip tone={TONE[outlook.peak]}>{RAIN_INTENSITY_LABEL[outlook.peak]}</Chip>
        )
      }
    >
      <div className="space-y-3">
        {detail && <p className="wx-muted text-sm">{detail}</p>}

        {outlook.moreLater && (
          <p className="wx-muted text-sm">
            More rain later in the window
            {outlook.windowPeakISO
              ? `, heaviest around ${formatTime(outlook.windowPeakISO, hour12)}`
              : ""}
            .
          </p>
        )}

        {/*
          * The bars are the detail behind the sentence: one per quarter-hour,
          * height by rate and colour by band, so a glance separates "spitting"
          * from "soaked" without reading an axis.
          */}
        <div className="flex items-end gap-1" aria-hidden>
          {periods.map((period, index) => {
            const mmh = rates[index];
            const band = rainIntensity(mmh);
            const height = band === "none" ? 3 : Math.max(6, (mmh / scale) * 56);
            return (
              <div
                key={period.dateTimeISO ?? index}
                className="flex-1 rounded-sm"
                style={{ height: `${height}px`, background: BAR_COLOUR[band] }}
              />
            );
          })}
        </div>

        <div className="flex justify-between">
          {periods.map((period, index) =>
            index % 2 === 0 ? (
              <span key={period.dateTimeISO ?? index} className="wx-dim text-[10px]">
                {index === 0 ? "now" : formatTime(period.dateTimeISO, hour12)}
              </span>
            ) : null
          )}
        </div>

        {/* A screen reader gets the numbers the bars encode. */}
        <ul className="sr-only">
          {periods.map((period, index) => (
            <li key={period.dateTimeISO ?? index}>
              {formatTime(period.dateTimeISO, hour12)}:{" "}
              {RAIN_INTENSITY_LABEL[rainIntensity(rates[index])]}
              {rainIntensity(rates[index]) !== "none"
                ? `, ${rates[index].toFixed(1)} ${units === "metric" ? "mm" : "in"} per hour`
                : ""}
            </li>
          ))}
        </ul>

        <p className="wx-muted text-xs leading-relaxed">
          A 15-minute model forecast, not weather radar — reliable for whether rain
          is coming this hour, less exact about the minute it starts. The radar
          loop on the Maps tab shows where the rain actually is.
        </p>
      </div>
    </Card>
  );
}

/** "two hours", "45 minutes" — the window, in words. */
function formatWindow(minutes: number): string {
  if (minutes >= 105) return "the next two hours";
  if (minutes >= 50) return "the next hour";
  return `${minutes} minutes`;
}
