"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Chip, Meter, Metric, Notice, SectionBody, Skeleton } from "./ui";
import { SeriesChart } from "./Chart";
import {
  dash,
  formatDayMonth,
  formatNumber,
  formatTime,
  formatWeekday,
  isNum,
  relativeFromNow,
} from "@/lib/weather-format";
import type {
  MarineConditions,
  RiverStation,
  WaterPayload,
} from "@/lib/water-types";


/**
 * Bound the request. Netlify functions can sit for tens of seconds when an
 * upstream is slow, and an unbounded fetch leaves the panel on its loading
 * skeleton indefinitely with no way for the user to tell it is stuck.
 */
async function fetchWithTimeout(url: string, ms = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Rivers, flood warnings and tides for the selected place. */
export function WaterPanel({
  placeQuery,
  hour12,
}: {
  placeQuery: string;
  hour12: boolean;
}) {
  const [data, setData] = useState<WaterPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(
        `/api/water?p=${encodeURIComponent(placeQuery)}`
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not load water data.");
      setData(payload as WaterPayload);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "AbortError"
          ? "The request timed out. The upstream services can be slow — try Refresh."
          : err instanceof Error
            ? err.message
            : "Could not load water data."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [placeQuery]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </Card>
    );
  }

  if (error) return <Notice tone="warn">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <FloodBlock data={data} />
      <MarineBlock data={data} hour12={hour12} />
      <RiverBlock data={data} hour12={hour12} />

      <p className="wx-dim text-xs">
        River levels and flood warnings © Environment Agency, Open Government
        Licence — Welsh gauges in this feed are owned by Natural Resources Wales.
        Sea state from Open-Meteo&rsquo;s 5 km European marine model.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FloodBlock({ data }: { data: WaterPayload }) {
  const section = data.sections.floods;

  return (
    <SectionBody section={section} empty="Flood warnings unavailable.">
      {(warnings) =>
        warnings.length === 0 ? (
          <Card title="Flood warnings">
            <p className="text-sm wx-good-text">
              No flood warnings or alerts in force within 30 km.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {warnings.map((warning) => {
              const tone =
                warning.severityLevel === 1
                  ? "danger"
                  : warning.severityLevel === 2
                    ? "warn"
                    : "accent";
              const colour =
                warning.severityLevel === 1
                  ? "#ef4444"
                  : warning.severityLevel === 2
                    ? "#f59e0b"
                    : "#38bdf8";
              return (
                <article
                  key={warning.id}
                  className="wx-card border-l-4 p-4"
                  style={{ borderLeftColor: colour }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold" style={{ color: colour }}>
                      {warning.severity}
                    </span>
                    <Chip tone={tone}>{warning.riverOrSea ?? "Flooding"}</Chip>
                  </div>
                  <p className="mt-1 text-sm">{warning.description}</p>
                  {warning.message && (
                    <p className="wx-muted mt-2 text-xs leading-relaxed">
                      {warning.message}
                    </p>
                  )}
                  {warning.timeRaisedISO && (
                    <p className="wx-dim mt-2 text-xs">
                      Raised {relativeFromNow(warning.timeRaisedISO)}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )
      }
    </SectionBody>
  );
}




/* ------------------------------------------------------------------ */

function RiverBlock({ data, hour12 }: { data: WaterPayload; hour12: boolean }) {
  return (
    <Card
      title="River & sea levels"
      subtitle="Nearest gauges, with each reading against its typical range"
    >
      <SectionBody section={data.sections.rivers}>
        {(stations) => (
          <div className="space-y-3">
            {stations.map((station) => (
              <StationCard key={station.id} station={station} hour12={hour12} />
            ))}
          </div>
        )}
      </SectionBody>
    </Card>
  );
}

function StationCard({
  station,
  hour12,
}: {
  station: RiverStation;
  hour12: boolean;
}) {
  return (
    <div className="wx-inset p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">{station.label}</span>
          {station.riverName && (
            <span className="wx-muted text-sm"> · {station.riverName}</span>
          )}
        </div>
        <span className="wx-dim text-xs">
          {isNum(station.distanceKM)
            ? `${station.distanceKM.toFixed(1)} km away`
            : ""}
          {station.catchment ? ` · ${station.catchment}` : ""}
        </span>
      </div>

      <div className="mt-2 space-y-3">
        {station.measures.map((measure) => {
          const tone =
            measure.state === "high"
              ? "#ef4444"
              : measure.state === "low"
                ? "#38bdf8"
                : "#34d399";
          const label =
            measure.state === "high"
              ? "Above typical range"
              : measure.state === "low"
                ? "Below typical range"
                : measure.state === "normal"
                  ? "Within typical range"
                  : "No typical range published";

          return (
            <div key={measure.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="wx-muted text-xs uppercase tracking-wide">
                  {measure.parameterName}
                  {measure.qualifier ? ` · ${measure.qualifier}` : ""}
                </span>
                <span className="text-lg font-semibold" style={{ color: tone }}>
                  {formatNumber(measure.value, ` ${measure.unit ?? ""}`, 2)}
                </span>
              </div>

              {measure.rangePosition !== null && (
                <div className="mt-1.5">
                  <Meter
                    value={Math.max(0, Math.min(1, measure.rangePosition)) * 100}
                    color={tone}
                    label={`${measure.parameterName} against typical range`}
                  />
                  <div className="wx-dim mt-1 flex justify-between text-[11px]">
                    <span>
                      low {formatNumber(measure.typicalLow, "", 2)}
                    </span>
                    <span style={{ color: tone }}>{label}</span>
                    <span>
                      high {formatNumber(measure.typicalHigh, "", 2)}
                    </span>
                  </div>
                </div>
              )}

              <div className="wx-dim mt-1 text-[11px]">
                {measure.dateTimeISO
                  ? `Read ${formatTime(measure.dateTimeISO, hour12)} · ${relativeFromNow(
                      measure.dateTimeISO
                    )}`
                  : "No timestamp"}
                {isNum(measure.maxOnRecord) &&
                  ` · record high ${measure.maxOnRecord.toFixed(2)}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Sea state — waves and sea temperature, for the coast rather than the river. */
function MarineBlock({ data, hour12 }: { data: WaterPayload; hour12: boolean }) {
  const section = data.sections.marine;
  // Inland points legitimately have no marine forecast; stay quiet rather than
  // showing an error for something that was never going to apply.
  if (!section.ok && section.code === "warn_no_data") return null;

  return (
    <Card title="Sea state" subtitle="Waves and sea temperature for the next 48 hours">
      <SectionBody section={section}>
        {(marine: MarineConditions) => {
          const current = marine.current;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label="Wave height"
                  icon="🌊"
                  value={
                    isNum(current?.waveHeightM)
                      ? `${current.waveHeightM.toFixed(1)} m`
                      : dash
                  }
                  hint={describeSea(current?.waveHeightM)}
                />
                <Metric
                  label="Wave period"
                  value={
                    isNum(current?.wavePeriodS)
                      ? `${current.wavePeriodS.toFixed(0)} s`
                      : dash
                  }
                />
                <Metric
                  label="Swell"
                  value={
                    isNum(current?.swellHeightM)
                      ? `${current.swellHeightM.toFixed(1)} m`
                      : dash
                  }
                />
                <Metric
                  label="Sea temperature"
                  icon="🌡️"
                  value={
                    isNum(current?.seaTempC)
                      ? `${current.seaTempC.toFixed(1)}°C`
                      : dash
                  }
                />
              </div>

              {isNum(marine.maxWaveM) && marine.maxWaveAtISO && (
                <p className="wx-muted text-sm">
                  Biggest waves in the period: {marine.maxWaveM.toFixed(1)} m
                  around {formatWeekday(marine.maxWaveAtISO)}{" "}
                  {formatTime(marine.maxWaveAtISO, hour12)}.
                </p>
              )}

              <SeriesChart
                labels={marine.hours.map((hour) => formatTime(hour.timeISO, hour12))}
                height={180}
                series={[
                  {
                    label: "Wave height (m)",
                    color: "#38bdf8",
                    fill: true,
                    values: marine.hours.map((hour) => hour.waveHeightM),
                    format: (v) => `${v.toFixed(1)} m`,
                  },
                  {
                    label: "Sea temp (°C)",
                    color: "#fb923c",
                    dashed: true,
                    values: marine.hours.map((hour) => hour.seaTempC),
                    format: (v) => `${v.toFixed(1)}°C`,
                  },
                ]}
                yFormat={(v) => v.toFixed(1)}
                ariaLabel="Forecast wave height and sea temperature"
              />
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

/** Douglas-style shorthand for what a wave height actually feels like. */
function describeSea(waveHeightM: number | null | undefined): string | undefined {
  if (!isNum(waveHeightM)) return undefined;
  if (waveHeightM < 0.1) return "Calm";
  if (waveHeightM < 0.5) return "Smooth";
  if (waveHeightM < 1.25) return "Slight";
  if (waveHeightM < 2.5) return "Moderate";
  if (waveHeightM < 4) return "Rough";
  if (waveHeightM < 6) return "Very rough";
  return "High";
}
