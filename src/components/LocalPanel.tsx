"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Chip, Meter, Metric, Notice, SectionBody, Skeleton } from "./ui";
import { SeriesChart } from "./Chart";
import {
  dash,
  formatDayMonth,
  formatTime,
  formatWeekday,
  isNum,
} from "@/lib/weather-format";
import type { CarbonPeriod, LocalPayload } from "@/lib/local-types";

/** Carbon intensity, neighbourhood crime and the local club. */
export function LocalPanel({
  placeQuery,
  hour12,
}: {
  placeQuery: string;
  hour12: boolean;
}) {
  const [data, setData] = useState<LocalPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/local?p=${encodeURIComponent(placeQuery)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not load local data.");
      setData(payload as LocalPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load local data.");
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
      <CarbonBlock data={data} hour12={hour12} />
      <CrimeBlock data={data} />
      <FootballBlock data={data} hour12={hour12} />

      <p className="wx-dim text-xs">
        Carbon intensity © National Grid ESO, Open Government Licence. Crime data
        © data.police.uk, Open Government Licence — street-level points are
        anonymised to a nearby location, so they show the general area, not exact
        addresses. Fixtures via football-data.org.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const CARBON_TONES: Record<string, string> = {
  "very low": "#22c55e",
  low: "#4ade80",
  moderate: "#eab308",
  high: "#f97316",
  "very high": "#ef4444",
};

function carbonColour(index: string | null): string {
  return CARBON_TONES[(index ?? "").toLowerCase()] ?? "#64748b";
}

const FUEL_COLOURS: Record<string, string> = {
  wind: "#38bdf8",
  solar: "#fbbf24",
  hydro: "#22d3ee",
  nuclear: "#a78bfa",
  biomass: "#84cc16",
  gas: "#f97316",
  coal: "#78716c",
  imports: "#94a3b8",
  other: "#64748b",
};

function CarbonBlock({ data, hour12 }: { data: LocalPayload; hour12: boolean }) {
  return (
    <Card
      title="Grid carbon intensity"
      subtitle={
        data.sections.carbon.data?.regionName
          ? `${data.sections.carbon.data.regionName}${
              data.sections.carbon.data.postcode
                ? ` · ${data.sections.carbon.data.postcode}`
                : ""
            }`
          : "How clean the electricity is right now"
      }
    >
      <SectionBody section={data.sections.carbon}>
        {(carbon) => {
          const current = carbon.current;
          const value = current?.forecast ?? current?.actual ?? null;
          const colour = carbonColour(current?.index ?? null);

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-5">
                <div
                  className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border-2"
                  style={{ borderColor: colour, background: `${colour}1a` }}
                >
                  <span
                    className="text-3xl font-semibold"
                    style={{ color: colour }}
                  >
                    {value === null ? dash : Math.round(value)}
                  </span>
                  <span className="wx-muted text-[10px] uppercase tracking-wide">
                    gCO₂/kWh
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="text-lg font-semibold capitalize"
                    style={{ color: colour }}
                  >
                    {current?.index ?? dash}
                  </div>
                  {carbon.greenest && (
                    <p className="wx-muted mt-1 text-sm">
                      Cleanest window in the next 24 hours is{" "}
                      <span className="text-[var(--wx-text)]">
                        {formatTime(carbon.greenest.fromISO, hour12)}–
                        {formatTime(carbon.greenest.toISO, hour12)}
                      </span>{" "}
                      at {Math.round(carbon.greenest.forecast ?? 0)} gCO₂/kWh —
                      a good slot for the washing machine or a car charge.
                    </p>
                  )}
                  {carbon.dirtiest && (
                    <p className="wx-dim mt-1 text-xs">
                      Worst is {formatTime(carbon.dirtiest.fromISO, hour12)} at{" "}
                      {Math.round(carbon.dirtiest.forecast ?? 0)} gCO₂/kWh.
                    </p>
                  )}
                </div>
              </div>

              {carbon.forecast.length > 1 && (
                <SeriesChart
                  labels={carbon.forecast.map((period) =>
                    formatTime(period.fromISO, hour12)
                  )}
                  height={180}
                  series={[
                    {
                      label: "Forecast (gCO₂/kWh)",
                      color: "#4ade80",
                      fill: true,
                      values: carbon.forecast.map((period) => period.forecast),
                      format: (v) => `${v.toFixed(0)} gCO₂/kWh`,
                    },
                  ]}
                  yFormat={(v) => v.toFixed(0)}
                  ariaLabel="Forecast grid carbon intensity for the next 24 hours"
                />
              )}

              {carbon.generationMix.length > 0 && (
                <div>
                  <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                    Generation mix
                  </h3>
                  <div className="flex h-3 w-full overflow-hidden rounded-full">
                    {carbon.generationMix.map((fuel) => (
                      <div
                        key={fuel.fuel}
                        style={{
                          width: `${fuel.percent}%`,
                          background: FUEL_COLOURS[fuel.fuel] ?? "#64748b",
                        }}
                        title={`${fuel.fuel} ${fuel.percent.toFixed(1)}%`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {carbon.generationMix.map((fuel) => (
                      <span
                        key={fuel.fuel}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{
                            background: FUEL_COLOURS[fuel.fuel] ?? "#64748b",
                          }}
                        />
                        <span className="wx-muted capitalize">
                          {fuel.fuel} {fuel.percent.toFixed(0)}%
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function CrimeBlock({ data }: { data: LocalPayload }) {
  return (
    <Card
      title="Reported crime nearby"
      subtitle={
        data.sections.crime.data
          ? `${data.sections.crime.data.month} · within about ${data.sections.crime.data.radiusMiles} mile`
          : "Street-level crime from data.police.uk"
      }
    >
      <SectionBody section={data.sections.crime}>
        {(crime) => {
          const max = crime.categories[0]?.count ?? 1;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric label="Reports" icon="📋" value={String(crime.total)} />
                <Metric
                  label="Most common"
                  value={crime.categories[0]?.label ?? dash}
                  hint={
                    crime.categories[0]
                      ? `${crime.categories[0].count} reports`
                      : undefined
                  }
                />
                <Metric
                  label="Neighbourhood"
                  value={crime.neighbourhood?.name ?? dash}
                  hint={crime.neighbourhood?.force.replace(/-/g, " ")}
                />
              </div>

              <div className="space-y-2">
                {crime.categories.map((category) => (
                  <div key={category.category}>
                    <div className="flex justify-between text-sm">
                      <span className="wx-muted">{category.label}</span>
                      <span className="font-medium">{category.count}</span>
                    </div>
                    <div className="mt-1">
                      <Meter
                        value={(category.count / max) * 100}
                        color="#818cf8"
                        label={category.label}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {crime.topStreets.length > 0 && (
                <div>
                  <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                    Most reported locations
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {crime.topStreets.map((street) => (
                      <Chip key={street.name}>
                        {street.name} · {street.count}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function FootballBlock({
  data,
  hour12,
}: {
  data: LocalPayload;
  hour12: boolean;
}) {
  return (
    <Card
      title="Football"
      subtitle={
        data.sections.football.data
          ? data.sections.football.data.teamName
          : "Local club fixtures and results"
      }
    >
      <SectionBody section={data.sections.football}>
        {(team) => (
          <div className="space-y-4">
            {isNum(team.position) && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Metric label="Position" value={`${team.position}`} />
                <Metric label="Played" value={`${team.playedGames ?? dash}`} />
                <Metric label="Points" value={`${team.points ?? dash}`} />
                <Metric label="W" value={`${team.won ?? dash}`} />
                <Metric label="D" value={`${team.draw ?? dash}`} />
                <Metric label="L" value={`${team.lost ?? dash}`} />
              </div>
            )}

            {team.next.length > 0 && (
              <div>
                <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  Next fixtures
                </h3>
                <ul className="space-y-1.5">
                  {team.next.map((match) => (
                    <li
                      key={match.id}
                      className="wx-inset flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        {match.homeTeam} v {match.awayTeam}
                        <Chip tone={match.venueIsHome ? "good" : "default"}>
                          {match.venueIsHome ? "H" : "A"}
                        </Chip>
                      </span>
                      <span className="wx-muted text-xs">
                        {formatWeekday(match.utcDateISO)}{" "}
                        {formatDayMonth(match.utcDateISO)} ·{" "}
                        {formatTime(match.utcDateISO, hour12)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {team.recent.length > 0 && (
              <div>
                <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  Recent results
                </h3>
                <ul className="space-y-1.5">
                  {team.recent.map((match) => (
                    <li
                      key={match.id}
                      className="wx-inset flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        {match.homeTeam} {match.homeGoals ?? "-"} –{" "}
                        {match.awayGoals ?? "-"} {match.awayTeam}
                      </span>
                      <span className="wx-muted text-xs">
                        {formatWeekday(match.utcDateISO)}{" "}
                        {formatDayMonth(match.utcDateISO)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SectionBody>
    </Card>
  );
}
