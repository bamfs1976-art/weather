"use client";

import type { ReactNode } from "react";

/**
 * A primary metric tile.
 *
 * The brief's tiering rule in component form: four of these carry the readings
 * people actually scan for, each paired with a small visual that encodes the
 * same number a second way — a bearing, a position on a scale, a proportion.
 * Everything else lives in the Details disclosure and stays a plain label and
 * value, because a nine-tile grid where every tile has a graphic is noise.
 */
export function MetricTile({
  label,
  value,
  hint,
  visual,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  visual?: ReactNode;
}) {
  return (
    <div className="wx-tile">
      <div className="min-w-0">
        <div className="wx-tile-label">{label}</div>
        <div className="wx-tile-value wx-num">{value}</div>
        {hint ? <div className="wx-tile-hint">{hint}</div> : null}
      </div>
      {visual ? <div className="wx-tile-visual shrink-0">{visual}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A compass whose needle points along the true bearing the wind is coming from.
 *
 * Meteorological convention: a "north-westerly" blows *from* the north-west, so
 * the needle points at the reported bearing rather than away from it.
 */
export function WindCompass({
  deg,
  size = 56,
}: {
  deg: number | null | undefined;
  size?: number;
}) {
  const bearing = typeof deg === "number" && Number.isFinite(deg) ? deg : null;
  const r = size / 2;

  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <circle cx="28" cy="28" r="25" fill="none" stroke="var(--wx-track)" strokeWidth="2" />
      {/* Cardinal ticks, N slightly longer so the rose has an orientation. */}
      {[0, 90, 180, 270].map((a) => (
        <line
          key={a}
          x1="28"
          y1={a === 0 ? 4 : 6}
          x2="28"
          y2="10"
          stroke="var(--wx-dim)"
          strokeWidth={a === 0 ? 2 : 1.2}
          strokeLinecap="round"
          transform={`rotate(${a} 28 28)`}
        />
      ))}
      {bearing !== null && (
        <g transform={`rotate(${bearing} 28 28)`} style={{ transition: "transform 400ms ease-out" }}>
          <path
            d="M28 11 L32.4 30 L28 26.6 L23.6 30 Z"
            fill="var(--wx-accent)"
          />
          <circle cx="28" cy="28" r="2.6" fill="var(--wx-accent)" />
        </g>
      )}
      {bearing === null && <circle cx="28" cy="28" r="2.6" fill="var(--wx-dim)" />}
      <text
        x="28"
        y={r - 15}
        textAnchor="middle"
        fontSize="7"
        fill="var(--wx-dim)"
        style={{ fontFamily: "var(--wx-font-body)" }}
      >
        N
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/** The WHO/WMO UV bands, which is what the colours below encode. */
const UV_STOPS = [
  { upto: 2, color: "oklch(0.63 0.14 150)" },
  { upto: 5, color: "oklch(0.75 0.15 90)" },
  { upto: 7, color: "oklch(0.68 0.16 55)" },
  { upto: 10, color: "oklch(0.58 0.19 25)" },
  { upto: 20, color: "oklch(0.5 0.16 320)" },
];

/**
 * A 0–11 UV scale with a marker at the current index.
 *
 * The gradient is the band scale itself rather than a decorative ramp, so the
 * marker's colour and its position agree by construction.
 */
export function UVScale({ value, width = 64 }: { value: number | null | undefined; width?: number }) {
  const uvi = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
  const pct = uvi === null ? 0 : Math.min(1, uvi / 11) * 100;

  return (
    <div style={{ width }}>
      <div
        className="wx-uv-track"
        style={{
          backgroundImage: `linear-gradient(90deg, ${UV_STOPS.map(
            (stop, i) => `${stop.color} ${(i / UV_STOPS.length) * 100}%`
          ).join(", ")}, ${UV_STOPS[UV_STOPS.length - 1].color} 100%)`,
        }}
      >
        {uvi !== null && <span className="wx-uv-marker" style={{ left: `${pct}%` }} />}
      </div>
      <div className="wx-uv-scale-labels">
        <span>0</span>
        <span>11+</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A proportion as a ring.
 *
 * Used for humidity and cloud cover, where the number is a percentage of a
 * fixed whole and a ring reads faster than a bar at tile size.
 */
export function RadialRing({
  value,
  size = 56,
  color = "var(--wx-accent)",
  label,
  showValue = true,
}: {
  value: number | null | undefined;
  size?: number;
  color?: string;
  label?: string;
  /**
   * Off when the ring shows a proportion of something whose tile value is in
   * different units — visibility is "9.2 km", and printing "57" in the middle
   * of its ring reads as a contradiction rather than as a percentage of range.
   */
  showValue?: boolean;
}) {
  const pct =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const dash = pct === null ? 0 : (pct / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label={label} focusable="false">
      <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--wx-track)" strokeWidth="5" />
      {pct !== null && (
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform="rotate(-90 28 28)"
          style={{ transition: "stroke-dasharray 400ms ease-out" }}
        />
      )}
      {showValue && (
        <text
          x="28"
          y="32"
          textAnchor="middle"
          fontSize="14"
          fill="var(--wx-text)"
          style={{ fontFamily: "var(--wx-font-display)", fontVariantNumeric: "tabular-nums" }}
        >
          {pct === null ? "–" : Math.round(pct)}
        </text>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A sparkline with a trend arrow, for pressure.
 *
 * Pressure only means anything as a direction of travel — 1013 mb tells you
 * nothing, 1013 and falling tells you a lot — so the shape carries the message
 * and the number is the caption.
 */
export function Sparkline({
  values,
  direction,
  width = 64,
  height = 28,
}: {
  values: (number | null)[];
  direction?: "rising" | "falling" | "steady" | null;
  width?: number;
  height?: number;
}) {
  const points = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");

  const colour =
    direction === "rising"
      ? "var(--wx-good)"
      : direction === "falling"
        ? "var(--wx-warn)"
        : "var(--wx-dim)";

  return (
    <div className="flex items-center gap-1.5">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <path d={d} fill="none" stroke={colour} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {direction && direction !== "steady" && (
        <span
          aria-hidden
          style={{
            color: colour,
            fontSize: 14,
            lineHeight: 1,
            transform: direction === "falling" ? "rotate(180deg)" : undefined,
          }}
        >
          ↑
        </span>
      )}
    </div>
  );
}
