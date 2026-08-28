"use client";

import { Card, Chip, SectionBody } from "./ui";
import { dash, formatWeekday, isNum } from "@/lib/weather-format";
import type { Section } from "@/lib/weather-types";
import type { MetOfficeDaily, MetOfficeHalf } from "@/lib/metoffice-types";

/**
 * What kind of wet, not just how likely.
 *
 * The 10-day card shows one blended probability of precipitation per day,
 * which is what `probOfPrecipitation` gives — but the daily response also
 * carries the chance of rain, heavy rain, snow, heavy snow, hail and sferics
 * separately, for the day half and the night half. A 40% chance that is
 * entirely hail is a different day from a 40% chance of drizzle, and the app
 * was throwing that distinction away on every request.
 *
 * "Sferics" is the Met Office's term for a lightning strike within 50 km. It
 * is the one row here that answers a question the app was paying an Xweather
 * access for.
 *
 * Costs nothing: the site-specific API returns every parameter on every
 * request, so these were already in the response being fetched.
 */

const ROWS: { key: keyof MetOfficeHalf; label: string; tone: "warn" | "danger" | "accent" }[] = [
  { key: "rain", label: "Rain", tone: "accent" },
  { key: "heavyRain", label: "Heavy rain", tone: "warn" },
  { key: "snow", label: "Snow", tone: "accent" },
  { key: "heavySnow", label: "Heavy snow", tone: "warn" },
  { key: "hail", label: "Hail", tone: "warn" },
  { key: "sferics", label: "Lightning within 50 km", tone: "danger" },
];

export function PrecipChancesCard({
  section,
}: {
  section: Section<MetOfficeDaily> | undefined;
}) {
  return (
    <Card
      title="What kind of weather"
      subtitle="Chance by type, day and night — the Met Office publishes these separately"
      source="Met Office DataHub"
    >
      <SectionBody section={section} empty="No daily forecast for this location.">
        {(data) => {
          /*
           * Only rows that some day actually carries. A forecast with no snow
           * in it should not show seven days of "Snow 0%" — and if a field
           * name turns out to be wrong, its row disappears rather than
           * printing a column of dashes.
           */
          const live = ROWS.filter((row) =>
            data.days.some(
              (d) => isNum(d.day[row.key]) || isNum(d.night[row.key])
            )
          );

          if (live.length === 0) {
            return (
              <p className="wx-muted text-sm">
                This forecast did not carry per-type probabilities.
              </p>
            );
          }

          return (
            <div className="space-y-3">
              <div className="wx-scroll -mx-1 px-1 pb-2">
                <table className="w-full min-w-[34rem] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="wx-dim py-1 pr-2 text-left text-xs font-normal">
                        Chance of
                      </th>
                      {data.days.map((day) => (
                        <th
                          key={day.timeISO}
                          className="wx-dim px-1 py-1 text-center text-xs font-normal"
                        >
                          {formatWeekday(day.timeISO)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((row) => (
                      <tr key={row.key} className="border-t border-[var(--wx-border)]">
                        <th className="py-1.5 pr-2 text-left text-xs font-medium">
                          {row.label}
                        </th>
                        {data.days.map((day) => (
                          <td key={day.timeISO} className="px-1 py-1.5 text-center">
                            <DayNight
                              day={day.day[row.key]}
                              night={day.night[row.key]}
                              tone={row.tone}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="wx-muted text-xs">
                Each cell is day / night. Blank means the Met Office gave no figure.
              </p>
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

function DayNight({
  day,
  night,
  tone,
}: {
  day: number | null;
  night: number | null;
  tone: "warn" | "danger" | "accent";
}) {
  if (!isNum(day) && !isNum(night)) return <span className="wx-dim">{dash}</span>;
  const peak = Math.max(isNum(day) ? day : 0, isNum(night) ? night : 0);
  /*
   * Only a chance worth acting on gets a colour. Everything below 20% stays
   * quiet, or a week of single-digit hail chances would light the table up.
   */
  const highlighted = peak >= 20;
  const text = `${isNum(day) ? `${Math.round(day)}%` : dash} / ${
    isNum(night) ? `${Math.round(night)}%` : dash
  }`;

  return highlighted ? (
    <Chip tone={peak >= 50 ? tone : "default"}>{text}</Chip>
  ) : (
    <span className="wx-num wx-dim text-xs">{text}</span>
  );
}
