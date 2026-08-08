"use client";

import type { ReactNode } from "react";
import type { Section } from "@/lib/weather-types";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`wx-card p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="wx-muted mt-0.5 text-xs">{subtitle}</p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Renders children only when the section came back with data. Missing sections
 * are common (subscription tier, no station nearby) so they get a quiet inline
 * notice rather than an error state.
 */
export function SectionBody<T>({
  section,
  children,
  empty = "No data available.",
}: {
  section: Section<T> | undefined;
  children: (data: T) => ReactNode;
  empty?: string;
}) {
  if (!section) {
    return <Notice>{empty}</Notice>;
  }
  if (!section.ok || section.data === null) {
    return <Notice tone={section.code === "no_credentials" ? "warn" : "muted"}>{section.error ?? empty}</Notice>;
  }
  return <>{children(section.data)}</>;
}

export function Notice({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warn" | "danger";
}) {
  const color =
    tone === "warn"
      ? "text-amber-300/90 border-amber-400/25 bg-amber-400/5"
      : tone === "danger"
        ? "text-red-300/90 border-red-400/25 bg-red-400/5"
        : "wx-muted border-slate-500/20 bg-slate-500/5";
  return (
    <p className={`rounded-lg border px-3 py-2.5 text-sm ${color}`}>{children}</p>
  );
}

/** Label + value pair used throughout the detail grids. */
export function Metric({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: string;
  accent?: string;
}) {
  return (
    <div className="wx-inset px-3 py-2.5">
      <div className="wx-muted flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        {icon && <span aria-hidden>{icon}</span>}
        <span>{label}</span>
      </div>
      <div
        className="mt-1 text-lg font-semibold leading-tight"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {hint && <div className="wx-dim mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

export function Chip({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger" | "good";
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: "border-slate-400/25 bg-slate-400/10 text-slate-200",
    accent: "border-sky-400/40 bg-sky-400/12 text-sky-200",
    warn: "border-amber-400/40 bg-amber-400/12 text-amber-200",
    danger: "border-red-400/40 bg-red-400/12 text-red-200",
    good: "border-emerald-400/40 bg-emerald-400/12 text-emerald-200",
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`wx-skeleton ${className}`} />;
}

/** Thin horizontal meter, used for humidity, POP, AQI and similar 0–100 values. */
export function Meter({
  value,
  max = 100,
  color = "var(--wx-accent)",
  label,
}: {
  value: number | null;
  max?: number;
  color?: string;
  label?: string;
}) {
  const pct =
    value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-500/25"
      role="meter"
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

/** Compass arrow pointing the way the wind is blowing *to*. */
export function WindArrow({ deg }: { deg: number | null | undefined }) {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-4 w-4 align-[-2px]"
      style={{ transform: `rotate(${(deg + 180) % 360}deg)` }}
      aria-hidden
    >
      <path
        d="M12 2 L18 21 L12 17 L6 21 Z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}
