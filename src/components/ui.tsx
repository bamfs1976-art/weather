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
  onRetry,
}: {
  section: Section<T> | undefined;
  children: (data: T) => ReactNode;
  empty?: string;
  /**
   * Offered on failures worth retrying. A missing subscription or an inland
   * point with no tide gauge will never succeed on a second attempt, so the
   * button appears only for transport-level codes — a retry that cannot work is
   * worse than no retry at all.
   */
  onRetry?: () => void;
}) {
  if (!section) {
    return <Notice>{empty}</Notice>;
  }
  if (!section.ok || section.data === null) {
    const retryable =
      onRetry !== undefined &&
      (section.code === "timeout" ||
        section.code === "network" ||
        section.code === "bad_response" ||
        (section.code ?? "").startsWith("http_5"));
    return (
      <Notice tone={section.code === "no_credentials" ? "warn" : "muted"}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{section.error ?? empty}</span>
          {retryable && (
            <button type="button" className="wx-retry" onClick={onRetry}>
              Try again
            </button>
          )}
        </span>
      </Notice>
    );
  }
  return <>{children(section.data)}</>;
}

/**
 * A card-shaped placeholder for first load.
 *
 * The height is passed in so the placeholder occupies the same space as the
 * card that replaces it — the point of a skeleton is that nothing moves when
 * the data lands.
 */
export function CardSkeleton({ height = 180, title = true }: { height?: number; title?: boolean }) {
  return (
    <section className="wx-card p-4 sm:p-5" aria-hidden>
      {title && <div className="wx-skeleton mb-3 h-3.5 w-32 rounded" />}
      <div className="wx-skeleton rounded-xl" style={{ height }} />
    </section>
  );
}

/** A calm stand-in for "nothing to show", used where a chart of zeroes would lie. */
export function EmptyState({
  art,
  title,
  note,
}: {
  art?: ReactNode;
  title: string;
  note?: string;
}) {
  return (
    <div className="wx-empty">
      {art ? <div className="wx-empty-art">{art}</div> : null}
      <p className="wx-empty-title">{title}</p>
      {note ? <p className="wx-empty-note">{note}</p> : null}
    </div>
  );
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
      ? "text-[var(--wx-warn)] border-[color-mix(in_srgb,var(--wx-warn)_35%,transparent)] bg-[var(--wx-warn-bg)]"
      : tone === "danger"
        ? "text-[var(--wx-danger)] border-[color-mix(in_srgb,var(--wx-danger)_35%,transparent)] bg-[var(--wx-danger-bg)]"
        : "wx-muted border-[var(--wx-border)] bg-[var(--wx-surface)]";
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-sm ${color}`}>{children}</div>
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
  /*
   * ReactNode, not string. Typed as `string` this could only ever hold an
   * emoji, which is why emoji survived here after every other surface moved to
   * the icon set — the type was quietly enforcing the thing being removed.
   */
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="wx-inset px-3 py-2.5">
      <div className="wx-muted flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        {icon && (
          <span aria-hidden className="inline-flex items-center [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
        )}
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
    default: "border-[var(--wx-border-strong)] bg-slate-400/10 text-[var(--wx-text)]",
    accent: "border-[var(--wx-accent-border)] bg-sky-400/12 text-[var(--wx-accent-text)]",
    warn: "border-[color-mix(in_srgb,var(--wx-warn)_45%,transparent)] bg-[var(--wx-warn-bg)] text-[var(--wx-warn)]",
    danger: "border-[color-mix(in_srgb,var(--wx-danger)_45%,transparent)] bg-[var(--wx-danger-bg)] text-[var(--wx-danger)]",
    good: "border-[color-mix(in_srgb,var(--wx-good)_45%,transparent)] bg-[var(--wx-good-bg)] text-[var(--wx-good)]",
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
      className="h-1.5 w-full overflow-hidden rounded-full wx-track"
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
