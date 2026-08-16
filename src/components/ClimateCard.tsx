"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Chip, Metric, Notice, SectionBody, Skeleton } from "./ui";
import { formatNumber, isNum } from "@/lib/weather-format";
import type { Section } from "@/lib/weather-types";
import type { ClimateContext } from "@/lib/climate-types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Is this month unusual?
 *
 * Fetches on its own rather than riding the overview payload: the upstream
 * response is eighty-five years of daily values, and only this tab wants it.
 */
export function ClimateCard({ placeQuery }: { placeQuery: string }) {
  const [section, setSection] = useState<Section<ClimateContext> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/climate?p=${encodeURIComponent(placeQuery)}`);
      const payload = await res.json();
      setSection(
        res.ok
          ? (payload.climate as Section<ClimateContext>)
          : { ok: false, data: null, error: payload.error ?? "Could not load.", code: null }
      );
    } catch {
      setSection({
        ok: false,
        data: null,
        error: "Could not reach the climate archive.",
        code: "network",
      });
    } finally {
      setLoading(false);
    }
  }, [placeQuery]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !section) {
    return (
      <Card title="Against the record">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  if (!section) return null;

  return (
    <Card
      title="Against the record"
      subtitle="This month compared with every year back to 1940"
      source="ERA5 reanalysis via Open-Meteo"
    >
      <SectionBody section={section} empty="No climate record for this location." onRetry={load}>
        {(climate) => {
          const month = MONTHS[climate.month - 1] ?? "This month";
          const anomaly =
            isNum(climate.monthMeanMaxC) && isNum(climate.longTermMeanMaxC)
              ? climate.monthMeanMaxC - climate.longTermMeanMaxC
              : null;

          return (
            <div className="space-y-4">
              {climate.rank !== null && (
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={anomaly !== null && anomaly > 0 ? "warn" : "accent"}>
                    {ordinal(climate.rank)} warmest {month} of {climate.yearsCompared}
                  </Chip>
                  {anomaly !== null && (
                    <span className="wx-dim text-xs">
                      {anomaly >= 0 ? "+" : ""}
                      {anomaly.toFixed(1)}°C against the {climate.firstYear}–present average
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label={`${month} so far`}
                  value={formatNumber(climate.monthMeanMaxC, "°C", 1)}
                  hint="mean daily maximum"
                />
                <Metric
                  label="Long-term average"
                  value={formatNumber(climate.longTermMeanMaxC, "°C", 1)}
                  hint={`${climate.firstYear}–present`}
                />
                <Metric
                  label="Warmest on record"
                  value={
                    climate.warmest ? `${climate.warmest.meanC.toFixed(1)}°C` : "—"
                  }
                  hint={climate.warmest ? String(climate.warmest.year) : undefined}
                />
                <Metric
                  label="Coldest on record"
                  value={
                    climate.coldest ? `${climate.coldest.meanC.toFixed(1)}°C` : "—"
                  }
                  hint={climate.coldest ? String(climate.coldest.year) : undefined}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label="Today's record high"
                  value={
                    climate.recordHigh ? `${climate.recordHigh.c.toFixed(1)}°C` : "—"
                  }
                  hint={climate.recordHigh ? `set ${climate.recordHigh.year}` : undefined}
                />
                <Metric
                  label="Today's record low"
                  value={climate.recordLow ? `${climate.recordLow.c.toFixed(1)}°C` : "—"}
                  hint={climate.recordLow ? `set ${climate.recordLow.year}` : undefined}
                />
                <Metric
                  label={`Rain this ${month.toLowerCase()}`}
                  value={formatNumber(climate.monthRainMM, " mm", 0)}
                />
                <Metric
                  label="Usual for the month"
                  value={formatNumber(climate.longTermRainMM, " mm", 0)}
                />
              </div>

              <Notice>
                These are <strong>reanalysis</strong> values, not station
                measurements — a model run backwards over the historical record
                for this grid square. Excellent for comparison, but a
                &ldquo;record&rdquo; here is not the same as one the Met Office
                would publish. Archive covers to {climate.lastDayISO}; ERA5 lags
                real time by about a week.
              </Notice>
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
