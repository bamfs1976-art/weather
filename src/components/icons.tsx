"use client";

import type { SVGProps } from "react";
import type { ConditionKind } from "@/lib/weather-format";

/*
 * The icon set, drawn rather than installed.
 *
 * lucide-react would have done the job, but this repo deliberately runs with no
 * runtime dependencies beyond React and Next, and the weather glyphs need
 * day/night pairs that a general-purpose set does not provide. Every path is
 * stroked in currentColor at a 24-unit grid, so colour comes from whatever the
 * icon sits inside and one component works on the hero, in a tile and inside a
 * chip without variants.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function Svg({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------------------------- weather ----------------------------- */

const CLOUD_PATH = "M7 18h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.4A4 4 0 0 0 7 18Z";

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.3 8.3 0 1 0 20 14.5Z" />
  </Svg>
);

export const CloudIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={CLOUD_PATH} />
  </Svg>
);

export const CloudSunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="7.5" r="2.6" />
    <path d="M8 2.4v1.4M3.4 7.5h-1.4M8 12.6v.6M4.4 3.9l1 1M11.6 3.9l-1 1" />
    <path d="M10 19h7.2a3.2 3.2 0 0 0 .3-6.4A4.6 4.6 0 0 0 9 11.4 3.8 3.8 0 0 0 10 19Z" />
  </Svg>
);

export const CloudMoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.6 8.4A5 5 0 0 1 7.4 2.5a5.1 5.1 0 1 0 6.2 5.9Z" />
    <path d="M10 19h7.2a3.2 3.2 0 0 0 .3-6.4A4.6 4.6 0 0 0 9 11.4 3.8 3.8 0 0 0 10 19Z" />
  </Svg>
);

export const CloudRainIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.4A4 4 0 0 0 7 15.5Z" />
    <path d="M9 18.4l-.9 2.4M13 18.4l-.9 2.4M17 18.4l-.9 2.4" />
  </Svg>
);

export const CloudDrizzleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.4A4 4 0 0 0 7 15.5Z" />
    <path d="M9.4 18.6v1.3M13 18.6v1.3M16.6 18.6v1.3" />
  </Svg>
);

export const CloudLightningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.4A4 4 0 0 0 7 15Z" />
    <path d="M13 16.6l-2.4 3.4h3l-2 3.2" transform="translate(0,-1.6)" />
  </Svg>
);

export const SnowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
    <path d="M9.6 4.6 12 6.9l2.4-2.3M9.6 19.4 12 17.1l2.4 2.3" />
  </Svg>
);

export const CloudSnowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.4A4 4 0 0 0 7 15.5Z" />
    <path d="M9.4 19h.01M13 19h.01M16.6 19h.01M11.2 21.4h.01M14.8 21.4h.01" />
  </Svg>
);

export const HailIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.4A4 4 0 0 0 7 15Z" />
    <circle cx="9.6" cy="19.4" r="1" />
    <circle cx="14.4" cy="19.4" r="1" />
    <circle cx="12" cy="22" r="1" />
  </Svg>
);

export const FogIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h16M6 13h13M4 17h11" />
    <path d="M8 5h10" opacity="0.55" />
  </Svg>
);

export const WindIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5h10.5a2.75 2.75 0 1 0-2.75-2.75" />
    <path d="M3 13h14a2.75 2.75 0 1 1-2.75 2.75" />
    <path d="M3 17.5h7" />
  </Svg>
);

export const ThermometerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z" />
    <path d="M12 9.5v6.2" />
  </Svg>
);

/* ------------------------------- UI -------------------------------- */

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="m20 20-3.6-3.6" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 4.8V11h-6.2" />
  </Svg>
);

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.5 14.2a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.3a1.9 1.9 0 0 1-3.8 0V20a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a1.9 1.9 0 0 1 0-3.8h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a1.9 1.9 0 0 1 3.8 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1h.3a1.9 1.9 0 0 1 0 3.8H21a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);

export const StarIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? "currentColor" : "none"}>
    <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M8 5.4v13.2l11-6.6z" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="7" y="5.4" width="3.4" height="13.2" rx="1.2" />
    <rect x="13.6" y="5.4" width="3.4" height="13.2" rx="1.2" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19.5v-15M5.5 11 12 4.5 18.5 11" />
  </Svg>
);

export const DropletIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2s5.6 5.6 5.6 9.4a5.6 5.6 0 1 1-11.2 0C6.4 8.8 12 3.2 12 3.2Z" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const GaugeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16.5a8.5 8.5 0 1 1 16 0" />
    <path d="m12 12.5 4-3.2" />
    <circle cx="12" cy="16.4" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const MountainIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 19 6.2-10.4 3.6 5.6 2.2-3.2L21 19Z" />
  </Svg>
);

export const SunriseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4v3.4M5.6 9.4 4.2 8M18.4 9.4 19.8 8M3 17h18M6.8 17a5.2 5.2 0 0 1 10.4 0" />
    <path d="m9.2 6 2.8-2.8L14.8 6" />
  </Svg>
);

export const SunsetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 6.8V3.4M5.6 9.4 4.2 8M18.4 9.4 19.8 8M3 17h18M6.8 17a5.2 5.2 0 0 1 10.4 0" />
    <path d="M9.2 4.2 12 7l2.8-2.8" />
  </Svg>
);

/* --------------------------- dispatcher ---------------------------- */

const BY_KIND: Record<ConditionKind, (p: IconProps) => React.ReactElement> = {
  clear: SunIcon,
  fair: CloudSunIcon,
  pcloudy: CloudSunIcon,
  mcloudy: CloudIcon,
  cloudy: CloudIcon,
  rain: CloudRainIcon,
  showers: CloudDrizzleIcon,
  drizzle: CloudDrizzleIcon,
  tstorm: CloudLightningIcon,
  snow: CloudSnowIcon,
  sleet: HailIcon,
  hail: HailIcon,
  fog: FogIcon,
  wind: WindIcon,
  hot: ThermometerIcon,
  cold: ThermometerIcon,
  unknown: ThermometerIcon,
};

/** Kinds whose night form is a different drawing rather than the same one. */
const NIGHT_SWAP: Partial<Record<ConditionKind, (p: IconProps) => React.ReactElement>> = {
  clear: MoonIcon,
  fair: CloudMoonIcon,
  pcloudy: CloudMoonIcon,
};

/**
 * The icon for a condition, in its day or night form.
 *
 * `title` gives it an accessible name; without one it stays decorative, which
 * is right when the condition is already written out beside it.
 */
export function ConditionIcon({
  kind,
  night = false,
  size = 24,
  title,
  ...rest
}: IconProps & { kind: ConditionKind; night?: boolean; title?: string }) {
  const Component = (night && NIGHT_SWAP[kind]) || BY_KIND[kind] || ThermometerIcon;
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "inline-flex", lineHeight: 0 }}
    >
      <Component size={size} {...rest} />
    </span>
  );
}
