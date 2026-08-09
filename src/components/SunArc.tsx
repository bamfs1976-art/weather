"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/weather-format";

/**
 * The day's arc, with the sun at its current position along it.
 *
 * The horizontal position is the fraction of daylight elapsed, which is the
 * honest reading of "how much of the day is left" — not the sun's true altitude,
 * which would need the solar position and would look wrong beside a sunrise and
 * sunset time. Before dawn and after dusk the marker parks at the relevant end
 * and the arc dims, rather than disappearing and leaving an unexplained gap.
 */
export function SunArc({
  riseISO,
  setISO,
  hour12,
}: {
  riseISO: string | null | undefined;
  setISO: string | null | undefined;
  hour12: boolean;
}) {
  // Time-dependent, so it must not render during SSR or the first paint.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const rise = riseISO ? Date.parse(riseISO) : NaN;
  const set = setISO ? Date.parse(setISO) : NaN;
  if (Number.isNaN(rise) || Number.isNaN(set) || set <= rise) return null;

  const progress =
    now === null ? null : Math.max(0, Math.min(1, (now - rise) / (set - rise)));
  const isDaylight = progress !== null && progress > 0 && progress < 1;

  // Quadratic curve from (8,64) to (192,64) peaking at y=14.
  const W = 200;
  const H = 78;
  const x0 = 8;
  const x1 = W - 8;
  const t = progress ?? 0;
  const x = x0 + (x1 - x0) * t;
  // Point on the quadratic Bézier for the same t, so the marker sits on the line.
  const y = (1 - t) ** 2 * 64 + 2 * (1 - t) * t * 4 + t ** 2 * 64;

  const dayMinutes = Math.round((set - rise) / 60_000);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Daylight from ${formatTime(riseISO, hour12)} to ${formatTime(setISO, hour12)}`}
      >
        <defs>
          <linearGradient id="wx-sunarc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--wx-solar)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--wx-solar)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizon */}
        <line x1="0" y1="64" x2={W} y2="64" stroke="var(--wx-chart-grid)" strokeWidth="1" />

        {/* Daylight area under the arc */}
        <path d={`M${x0} 64 Q100 4 ${x1} 64 Z`} fill="url(#wx-sunarc-fill)" />
        <path
          d={`M${x0} 64 Q100 4 ${x1} 64`}
          fill="none"
          stroke="var(--wx-solar)"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity={isDaylight ? 1 : 0.4}
        />

        {progress !== null && (
          <g style={{ transition: "transform 600ms ease-out" }}>
            <circle cx={x} cy={y} r="7" fill="var(--wx-solar)" opacity={isDaylight ? 0.28 : 0.16} />
            <circle cx={x} cy={y} r="4" fill="var(--wx-solar)" opacity={isDaylight ? 1 : 0.5} />
          </g>
        )}

        <text x={x0} y={75} fontSize="9" fill="var(--wx-chart-text)" style={{ fontFamily: "var(--wx-font-body)" }}>
          {formatTime(riseISO, hour12)}
        </text>
        <text
          x={x1}
          y={75}
          fontSize="9"
          textAnchor="end"
          fill="var(--wx-chart-text)"
          style={{ fontFamily: "var(--wx-font-body)" }}
        >
          {formatTime(setISO, hour12)}
        </text>
      </svg>

      <p className="wx-dim mt-1 text-xs">
        {Math.floor(dayMinutes / 60)}h {dayMinutes % 60}m of daylight
        {isDaylight && progress !== null
          ? ` · ${Math.round((1 - progress) * dayMinutes / 60)}h remaining`
          : ""}
      </p>
    </div>
  );
}
