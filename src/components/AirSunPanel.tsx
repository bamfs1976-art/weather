"use client";

import { Card, Chip, Meter, Metric, Notice, SectionBody } from "./ui";
import { SeriesChart } from "./Chart";
import { ClockIcon, MoonPhaseIcon, SunIcon, SunriseIcon, SunsetIcon } from "@/components/icons";
import {
  aqiCategory,
  dash,
  formatHourLabel,
  formatWeekday,
  formatNumber,
  formatTime,
  relativeFromNow,
  isNum,
  pollutantLabel,
} from "@/lib/weather-format";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";
import type { PollenBand, PollenSpecies } from "@/lib/pollen-types";

export function AirSunPanel({
  overview,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const { sections } = overview;
  const aq = sections.airQuality?.data?.periods?.[0] ?? null;
  const category = aqiCategory(aq?.aqi);
  const sun = sections.sunMoon?.data?.sun ?? null;
  const moon = sections.sunMoon?.data?.moon ?? null;
  const aqiValue = aq && isNum(aq.aqi) ? aq.aqi : null;
  const moonIllum = moon?.phase?.illum ?? null;
  const moonAge = moon?.phase?.age ?? null;

  return (
    <div className="space-y-4">
      <Card
        title="Air quality"
        subtitle={
          sections.airQuality?.data?.profile?.sources?.length
            ? `Source: ${sections.airQuality?.data.profile.sources
                .map((s) => s.name)
                .join(", ")}`
            : "Current air quality index and pollutant breakdown"
        }
      >
        <SectionBody section={sections.airQuality}>
          {() => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-5">
                <div
                  className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border-2"
                  style={{
                    borderColor: category.color,
                    background: `${category.color}1a`,
                  }}
                >
                  <span className="text-3xl font-semibold" style={{ color: category.color }}>
                    {aqiValue === null ? dash : Math.round(aqiValue)}
                  </span>
                  <span className="wx-muted text-[10px] uppercase tracking-wide">AQI</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold" style={{ color: category.color }}>
                    {aq?.category ?? category.label}
                  </div>
                  <p className="wx-muted mt-1 text-sm">{category.advice}</p>
                  {aq?.dominant && (
                    <div className="mt-2">
                      <Chip tone="accent">
                        Dominant pollutant: {pollutantLabel(aq.dominant)}
                      </Chip>
                    </div>
                  )}
                </div>
              </div>

              {aq?.pollutants && aq.pollutants.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {aq.pollutants.map((pollutant) => {
                    const tone = aqiCategory(pollutant.aqi);
                    const isParticulate = /pm/i.test(pollutant.type);
                    const value = isParticulate
                      ? pollutant.valueUGM3
                      : pollutant.valuePPB;
                    return (
                      <div key={pollutant.type} className="wx-inset px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {pollutantLabel(pollutant.type)}
                          </span>
                          <span className="text-sm" style={{ color: tone.color }}>
                            {isNum(pollutant.aqi) ? `AQI ${Math.round(pollutant.aqi)}` : dash}
                          </span>
                        </div>
                        <div className="wx-muted mt-0.5 text-xs">
                          {isNum(value)
                            ? `${value.toFixed(1)} ${isParticulate ? "µg/m³" : "ppb"}`
                            : dash}
                          {pollutant.category ? ` · ${pollutant.category}` : ""}
                        </div>
                        <div className="mt-2">
                          <Meter
                            value={pollutant.aqi ?? null}
                            max={300}
                            color={tone.color}
                            label={`${pollutant.type} air quality index`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </SectionBody>
      </Card>

      <PollenCard overview={overview} hour12={hour12} />

      <Card title="Air quality forecast" subtitle="Next 24 hours">
        <SectionBody section={sections.airQualityForecast}>
          {(data) => {
            const periods = data.periods ?? [];
            if (periods.length === 0) {
              return <Notice>No air quality forecast for this location.</Notice>;
            }
            return (
              <>
                <SeriesChart
                  labels={periods.map((p) => formatHourLabel(p.dateTimeISO, hour12))}
                  height={190}
                  series={[
                    {
                      label: "AQI",
                      color: "#34d399",
                      fill: true,
                      values: periods.map((p) => (isNum(p.aqi) ? p.aqi : null)),
                      format: (v) => `${v.toFixed(0)} (${aqiCategory(v).label})`,
                    },
                  ]}
                  yFormat={(v) => v.toFixed(0)}
                  ariaLabel="Forecast air quality index"
                />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric
                    label="Peak AQI"
                    value={formatNumber(
                      Math.max(
                        ...periods
                          .map((p) => p.aqi)
                          .filter((v): v is number => isNum(v))
                      )
                    )}
                  />
                  <Metric
                    label="Best AQI"
                    value={formatNumber(
                      Math.min(
                        ...periods
                          .map((p) => p.aqi)
                          .filter((v): v is number => isNum(v))
                      )
                    )}
                  />
                  <Metric
                    label="Dominant"
                    value={
                      periods[0]?.dominant ? pollutantLabel(periods[0].dominant) : dash
                    }
                  />
                  <Metric label="Periods" value={String(periods.length)} />
                </div>
              </>
            );
          }}
        </SectionBody>
      </Card>

      {/*
        * Aurora sits with sun and moon rather than with the weather: it is a
        * geomagnetic measurement for the whole UK, not a forecast for this
        * point, and the card says so rather than implying a local reading.
        */}
      {sections.aurora?.ok && sections.aurora.data && (
        <Card
          title="Aurora"
          subtitle="Geomagnetic activity measured in the UK — not a local forecast"
          source="AuroraWatch UK, Lancaster University"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Chip
              tone={
                sections.aurora.data.level === "red"
                  ? "danger"
                  : sections.aurora.data.level === "amber"
                    ? "warn"
                    : sections.aurora.data.level === "yellow"
                      ? "default"
                      : "good"
              }
            >
              {sections.aurora.data.level.charAt(0).toUpperCase() +
                sections.aurora.data.level.slice(1)}
            </Chip>
            <p className="text-sm">{sections.aurora.data.meaning}</p>
          </div>
          {sections.aurora.data.updatedISO && (
            <p className="wx-dim mt-2 text-xs">
              Measured {relativeFromNow(sections.aurora.data.updatedISO)}
            </p>
          )}
        </Card>
      )}

      <Card
        title="Sun & moon"
        subtitle="Daylight, twilight and lunar detail for today"
        source="Vaisala Xweather"
      >
        <SectionBody section={sections.sunMoon}>
          {() => (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Sunrise" icon={<SunriseIcon />} value={formatTime(sun?.riseISO, hour12)} />
                <Metric label="Solar noon" icon={<SunIcon />} value={formatTime(sun?.transitISO, hour12)} />
                <Metric label="Sunset" icon={<SunsetIcon />} value={formatTime(sun?.setISO, hour12)} />
                <Metric
                  label="Day length"
                  icon={<ClockIcon />}
                  value={dayLength(sun?.riseISO, sun?.setISO)}
                />
              </div>

              <div>
                <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  Twilight
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric
                    label="Civil"
                    value={`${formatTime(sun?.twilight?.civilBeginISO, hour12)} – ${formatTime(
                      sun?.twilight?.civilEndISO,
                      hour12
                    )}`}
                    hint="Enough light to read outdoors"
                  />
                  <Metric
                    label="Nautical"
                    value={`${formatTime(
                      sun?.twilight?.nauticalBeginISO,
                      hour12
                    )} – ${formatTime(sun?.twilight?.nauticalEndISO, hour12)}`}
                    hint="Horizon still visible at sea"
                  />
                  <Metric
                    label="Astronomical"
                    value={`${formatTime(
                      sun?.twilight?.astronomicalBeginISO,
                      hour12
                    )} – ${formatTime(sun?.twilight?.astronomicalEndISO, hour12)}`}
                    hint="Sky fully dark outside this window"
                  />
                </div>
              </div>

              <div>
                <h3 className="wx-muted mb-2 text-xs font-semibold uppercase tracking-wide">
                  Moon
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric
                    label="Phase"
                    icon={<MoonPhaseIcon phase={moon?.phase?.phase} />}
                    value={moon?.phase?.name ?? dash}
                  />
                  <Metric
                    label="Illumination"
                    value={moonIllum === null ? dash : `${moonIllum.toFixed(0)}%`}
                  />
                  <Metric label="Moonrise" value={formatTime(moon?.riseISO, hour12)} />
                  <Metric label="Moonset" value={formatTime(moon?.setISO, hour12)} />
                </div>
                {moonAge !== null && (
                  <p className="wx-dim mt-2 text-xs">
                    {moonAge.toFixed(1)} days into the current lunar cycle.
                  </p>
                )}
              </div>
            </div>
          )}
        </SectionBody>
      </Card>
    </div>
  );
}

function dayLength(
  riseISO: string | null | undefined,
  setISO: string | null | undefined
): string {
  if (!riseISO || !setISO) return dash;
  const rise = Date.parse(riseISO);
  const set = Date.parse(setISO);
  if (Number.isNaN(rise) || Number.isNaN(set) || set <= rise) return dash;
  const minutes = Math.round((set - rise) / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/* ------------------------------------------------------------------ */

const POLLEN_COLOUR: Record<PollenBand, string> = {
  none: "#64748b",
  low: "#34d399",
  moderate: "#fbbf24",
  high: "#fb923c",
  "very high": "#ef4444",
};

/**
 * Pollen for the next few days.
 *
 * The headline is the worst band any species reaches in the next 24 hours,
 * because that is the number that decides whether to take an antihistamine —
 * an average across six species would read "low" on a day when grass alone is
 * severe. Species are listed worst-first for the same reason.
 */
function PollenCard({
  overview,
  hour12,
}: {
  overview: WeatherOverview;
  hour12: boolean;
}) {
  const section = overview.sections.pollen;
  /*
   * Guarded, not assumed. Reading `.ok` off a section that is simply absent
   * threw, and took the whole Air & Sun tab down with it — a payload cached
   * from before this section existed is enough to do it. "Sections degrade,
   * they don't throw" has to cover the section not being there at all.
   */
  if (!section) return null;
  // Outside CAMS's European domain there is simply no forecast; that is not a
  // failure worth a warning box.
  if (!section.ok && section.code === "warn_no_data") return null;

  return (
    <Card
      title="Pollen"
      subtitle="Grains per cubic metre, from the CAMS European forecast"
    >
      <SectionBody section={section}>
        {(pollen) => {
          const leading = pollen.peaks[0];
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <div
                    className="text-3xl font-semibold capitalize"
                    style={{ color: POLLEN_COLOUR[pollen.overallBand] }}
                  >
                    {pollen.overallBand}
                  </div>
                  <div className="wx-muted text-xs">peak in the next 24 hours</div>
                </div>
                {leading && leading.band !== "none" && (
                  <Chip tone={leading.band === "low" ? "accent" : "warn"}>
                    {leading.label} leading
                  </Chip>
                )}
              </div>

              <div className="space-y-2">
                {pollen.peaks.map((peak) => (
                  <div key={peak.species}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm">{peak.label}</span>
                      <span className="wx-muted text-xs">
                        {isNum(peak.value) ? `${peak.value.toFixed(0)} gr/m³` : dash}
                        {" · "}
                        <span style={{ color: POLLEN_COLOUR[peak.band] }}>
                          {peak.band}
                        </span>
                      </span>
                    </div>
                    <Meter
                      /* Scaled against the top of the "high" band so a bar that
                         fills the track means genuinely severe, not merely the
                         worst of a quiet day. */
                      value={Math.min(100, ((peak.value ?? 0) / POLLEN_FULL[peak.species]) * 100)}
                      color={POLLEN_COLOUR[peak.band]}
                      label={`${peak.label} pollen`}
                    />
                  </div>
                ))}
              </div>

              {pollen.hours.length > 1 && (
                <SeriesChart
                  /* Weekday as well as hour: this series runs four days, so
                     hour-only labels repeat the same time on every axis tick
                     and read as if the chart were stuck. */
                  labels={pollen.hours.map(
                    (hour) =>
                      `${formatWeekday(hour.timeISO)} ${formatHourLabel(hour.timeISO, hour12)}`
                  )}
                  height={170}
                  series={pollen.peaks
                    .filter((peak) => peak.band !== "none")
                    .slice(0, 3)
                    .map((peak, index) => ({
                      label: peak.label,
                      color: ["#34d399", "#fbbf24", "#fb923c"][index],
                      fill: index === 0,
                      values: pollen.hours.map((hour) => hour.values[peak.species]),
                      format: (v: number) => `${v.toFixed(0)} gr/m³`,
                    }))}
                  yFormat={(v) => v.toFixed(0)}
                  ariaLabel="Pollen forecast by species"
                />
              )}

              <p className="wx-dim text-xs">
                Bands are the thresholds in common European use, which differ by
                species — birch and alder routinely reach counts that would be
                extraordinary for grass.
              </p>
            </div>
          );
        }}
      </SectionBody>
    </Card>
  );
}

/** Top of the "high" band per species, used to scale the meters. */
const POLLEN_FULL: Record<PollenSpecies, number> = {
  grass: 150,
  birch: 500,
  alder: 500,
  mugwort: 500,
  olive: 200,
  ragweed: 50,
};
