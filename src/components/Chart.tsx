"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface ChartSeries {
  label: string;
  color: string;
  values: (number | null)[];
  /** Draw a soft gradient below the line. */
  fill?: boolean;
  dashed?: boolean;
  format?: (value: number) => string;
}

export interface ChartBars {
  label: string;
  color: string;
  values: (number | null)[];
  format?: (value: number) => string;
}

/**
 * Dependency-free SVG chart: one or more lines on a shared y-axis, plus an
 * optional bar series drawn on its own scale along the bottom (precipitation,
 * typically). Per-column tooltips come from native <title> elements so the
 * chart stays usable on touch and with a keyboard.
 */
export function SeriesChart({
  labels,
  series,
  bars,
  height = 200,
  yFormat = (v) => v.toFixed(0),
  showEvery,
  ariaLabel,
}: {
  labels: string[];
  series: ChartSeries[];
  bars?: ChartBars;
  height?: number;
  yFormat?: (value: number) => string;
  /** Show every Nth x-axis label; defaults to a sensible density. */
  showEvery?: number;
  ariaLabel?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const count = labels.length;

  /*
   * Track the rendered width so the viewBox can match it 1:1. With a fixed
   * viewBox the whole drawing scales to fit, which shrinks axis labels to a few
   * pixels on a phone; matching the box to real pixels keeps text at its stated
   * size at every screen width.
   */
  const hostRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1000);
  /** Column under the pointer or keyboard focus, for the tooltip card. */
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  if (count === 0 || series.every((s) => s.values.every((v) => v === null))) {
    return (
      <p className="wx-muted py-6 text-center text-sm">Not enough data to chart.</p>
    );
  }

  const padL = 42;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  /*
   * Headroom below the lowest value is what stops a line sitting on the axis,
   * but it must not invent negative readings: a pollen count, a wave height or
   * a rainfall total cannot go below zero, and an axis labelled -11 grains
   * makes the chart look broken. Only clamp when the data is entirely
   * non-negative, so series that genuinely go below zero — temperature, say —
   * keep their padding.
   */
  if (min < 0 && all.every((v) => v >= 0)) min = 0;

  /** One row per series, used by both the card and the hit area's aria-label. */
  function tooltipRows(i: number): { label: string; value: string; color: string }[] {
    const rows = series.map((s) => ({
      label: s.label,
      color: s.color,
      value: s.values[i] === null ? "—" : (s.format ?? yFormat)(s.values[i] as number),
    }));
    if (bars) {
      rows.push({
        label: bars.label,
        color: bars.color,
        value:
          bars.values[i] === null
            ? "—"
            : (bars.format ?? ((v: number) => v.toFixed(1)))(bars.values[i] as number),
      });
    }
    return rows;
  }

  function tooltipText(i: number, label: string): string {
    return [label, ...tooltipRows(i).map((r) => `${r.label}: ${r.value}`)].join(", ");
  }

  const x = (i: number) => padL + (count === 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / (max - min)) * plotH;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));

  const barMax = bars
    ? Math.max(0.001, ...bars.values.filter((v): v is number => v !== null))
    : 0;
  const barBandH = plotH * 0.32;
  const barW = Math.max(2, (plotW / Math.max(count, 1)) * 0.55);

  // Roughly 78px per label — fewer labels on a narrow phone, more on a desktop.
  const maxLabels = Math.max(3, Math.floor(plotW / 78));
  const step = showEvery ?? Math.max(1, Math.ceil(count / maxLabels));

  function pathFor(values: (number | null)[]): string {
    let d = "";
    let pen = false;
    values.forEach((value, i) => {
      if (value === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(value).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }

  function areaFor(values: (number | null)[]): string {
    const points = values
      .map((value, i) => (value === null ? null : { i, value }))
      .filter((p): p is { i: number; value: number } => p !== null);
    if (points.length < 2) return "";
    const top = points
      .map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)} ${y(p.value).toFixed(1)}`)
      .join(" ");
    const baseline = padT + plotH;
    return `${top} L${x(points[points.length - 1].i).toFixed(1)} ${baseline} L${x(points[0].i).toFixed(1)} ${baseline} Z`;
  }

  return (
    <figure className="wx-chart m-0" ref={hostRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full"
        role="img"
        aria-label={ariaLabel ?? series.map((s) => s.label).join(", ")}
      >
        <defs>
          {series.map((s, si) =>
            s.fill ? (
              <linearGradient key={si} id={`${uid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ) : null
          )}
        </defs>

        {/* horizontal grid + y labels */}
        {gridValues.map((value, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--wx-chart-grid)"
              strokeWidth="1"
            />
            <text
              x={padL - 6}
              y={y(value) + 3.5}
              textAnchor="end"
              fontSize="11"
              fill="var(--wx-chart-text)"
            >
              {yFormat(value)}
            </text>
          </g>
        ))}

        {/* bars (own scale, anchored to the baseline) */}
        {bars &&
          bars.values.map((value, i) =>
            value === null || value <= 0 ? null : (
              <rect
                key={`b${i}`}
                // Clamp so the first and last bars don't spill into the axis gutter.
                x={Math.min(
                  Math.max(x(i) - barW / 2, padL),
                  width - padR - barW
                )}
                y={padT + plotH - (value / barMax) * barBandH}
                width={barW}
                height={(value / barMax) * barBandH}
                fill={bars.color}
                opacity="0.55"
                rx="1.5"
              />
            )
          )}

        {/* series */}
        {series.map((s, si) => (
          <g key={si}>
            {s.fill && areaFor(s.values) && (
              <path d={areaFor(s.values)} fill={`url(#${uid}-g${si})`} />
            )}
            <path
              d={pathFor(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {/* x labels */}
        {labels.map((label, i) =>
          i % step === 0 ? (
            <text
              key={`x${i}`}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill="var(--wx-chart-text)"
            >
              {label}
            </text>
          ) : null
        )}

        {/* hover guide + markers */}
        {hover !== null && (
          <g aria-hidden pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--wx-border-strong)"
              strokeWidth="1"
            />
            {series.map((s, si) => {
              const value = s.values[hover];
              return value === null ? null : (
                <circle
                  key={`d${si}`}
                  cx={x(hover)}
                  cy={y(value)}
                  r="3.5"
                  fill="var(--wx-surface-strong)"
                  stroke={s.color}
                  strokeWidth="2"
                />
              );
            })}
          </g>
        )}

        {/* hit areas: one per column, focusable so the values are keyboard reachable */}
        {labels.map((label, i) => (
          <rect
            key={`h${i}`}
            x={x(i) - plotW / Math.max(count, 1) / 2}
            y={padT}
            width={plotW / Math.max(count, 1)}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={tooltipText(i, label)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </svg>

      {hover !== null && (
        <div
          className="wx-chart-tip"
          style={{
            left: `${(x(hover) / width) * 100}%`,
            /* Flip to the other side near the right edge so the card never
               hangs off the container and forces the page to scroll. */
            transform:
              x(hover) > width * 0.6 ? "translate(-100%, 0)" : "translate(0, 0)",
          }}
          role="status"
        >
          <div className="wx-chart-tip-title">{labels[hover]}</div>
          {tooltipRows(hover).map((row) => (
            <div key={row.label} className="wx-chart-tip-row">
              <span className="wx-chart-tip-swatch" style={{ background: row.color }} />
              <span className="wx-chart-tip-label">{row.label}</span>
              <span className="wx-chart-tip-value wx-num">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((s, si) => (
          <span key={si} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{
                background: s.color,
                opacity: s.dashed ? 0.7 : 1,
              }}
            />
            <span className="wx-muted">{s.label}</span>
          </span>
        ))}
        {bars && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: bars.color, opacity: 0.6 }}
            />
            <span className="wx-muted">{bars.label}</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
