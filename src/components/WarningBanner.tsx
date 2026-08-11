"use client";

import { useState } from "react";
import { Chip } from "./ui";
import { ChevronDownIcon } from "./icons";
import type { WarningLevel, WeatherWarning } from "@/lib/warning-types";

/**
 * Met Office severe weather warnings, at the top of Now.
 *
 * Deliberately not a card in a tab. A warning is the one thing on this page
 * that changes what someone does today, and it was previously reachable only by
 * opening a tab — and only through Xweather's alerts, which are NWS-derived and
 * returned nothing for Swansea.
 *
 * The colours are the Met Office's own and are not negotiable: yellow, amber
 * and red mean specific things to anyone in the UK, so this is one of the few
 * places the app's palette gives way to an external convention. Each level is
 * paired with the word as well as the colour — a colour alone is not a label.
 */

const LEVEL: Record<WarningLevel, { label: string; colour: string; tone: "warn" | "danger" | "default" }> = {
  yellow: { label: "Yellow warning", colour: "#eab308", tone: "warn" },
  amber: { label: "Amber warning", colour: "#f97316", tone: "warn" },
  red: { label: "Red warning", colour: "#dc2626", tone: "danger" },
  unknown: { label: "Warning", colour: "var(--wx-muted)", tone: "default" },
};

export function WarningBanner({
  region,
  warnings,
}: {
  region: string;
  warnings: WeatherWarning[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      className="space-y-2"
      /*
       * Assertive, not polite. A red warning appearing while the page is open
       * is the one update worth interrupting a screen reader for; everything
       * else on this dashboard can wait for the user to reach it.
       */
      role="alert"
      aria-live="assertive"
    >
      {warnings.map((warning) => (
        <WarningRow key={warning.id} warning={warning} region={region} />
      ))}
    </div>
  );
}

function WarningRow({ warning, region }: { warning: WeatherWarning; region: string }) {
  const [open, setOpen] = useState(false);
  const level = LEVEL[warning.level];
  const body = warning.description?.trim();

  return (
    <article
      className="wx-card border-l-4 p-4"
      style={{ borderLeftColor: level.colour }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold" style={{ color: level.colour }}>
          {level.label}
        </span>
        {warning.hazard && <Chip tone={level.tone}>{warning.hazard}</Chip>}
        <span className="wx-dim text-xs">{region}</span>
      </div>

      <p className="mt-1 text-sm">{warning.title}</p>
      {warning.validity && (
        <p className="wx-muted mt-1 text-xs">{warning.validity}</p>
      )}

      {body && (
        <>
          <button
            type="button"
            className="wx-retry mt-2 inline-flex items-center gap-1"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide detail" : "What this means"}
            <ChevronDownIcon
              size={14}
              style={{ transform: open ? "rotate(180deg)" : undefined }}
            />
          </button>
          {open && (
            <p className="wx-muted mt-2 text-xs leading-relaxed">{body}</p>
          )}
        </>
      )}

      {warning.link && (
        <p className="mt-2 text-xs">
          <a
            href={warning.link}
            target="_blank"
            rel="noreferrer"
            className="wx-accent-text underline"
          >
            Full warning on the Met Office site
          </a>
        </p>
      )}
    </article>
  );
}
