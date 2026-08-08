/**
 * App mark: a gold double-towered castle over the blue-and-white wavy bars of
 * Swansea Bay.
 *
 * This is an ORIGINAL device inspired by Swansea's civic symbolism, not a
 * reproduction of the city's coat of arms. Those arms were granted by the
 * College of Arms in 1922 and belong to the City and County of Swansea; the
 * granted achievement (supporters, inescutcheon, osprey crest, "Floreat
 * Swansea") is deliberately absent here. The castle and the barry-wavy sea are
 * ordinary heraldic charges standing for Swansea Castle and the bay.
 *
 * Same drawing as the favicon and home-screen icon, so the header and the iOS
 * app icon read as one thing.
 */
export function Logo({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="Swansea weather"
    >
      <defs>
        <linearGradient id="wx-logo-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="55%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0f2057" />
        </linearGradient>
        <linearGradient id="wx-logo-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="45%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <clipPath id="wx-logo-frame">
          <rect width="512" height="512" rx="96" />
        </clipPath>
      </defs>

      <g clipPath="url(#wx-logo-frame)">
        <rect width="512" height="512" fill="url(#wx-logo-sky)" />

        {/* Double-towered castle — Swansea Castle */}
        <g fill="url(#wx-logo-gold)">
          <path d="M112 168h26v-26h26v26h26v-26h26v26h26v148H112z" />
          <path d="M270 168h26v-26h26v26h26v-26h26v26h26v148H270z" />
          <path d="M186 226h20v-22h24v22h24v-22h24v22h20v90H186z" />
        </g>
        <path d="M226 316v-46a30 30 0 0 1 60 0v46z" fill="#0f2057" />
        <g fill="#0f2057">
          <rect x="150" y="212" width="24" height="38" rx="12" />
          <rect x="308" y="212" width="24" height="38" rx="12" />
        </g>

        {/* Swansea Bay — barry wavy, argent and azure */}
        <g stroke="#e8eefc" strokeWidth="24" fill="none" strokeLinecap="round">
          <path d="M-20 366q36-22 72 0t72 0 72 0 72 0 72 0 72 0" />
          <path d="M-20 424q36-22 72 0t72 0 72 0 72 0 72 0 72 0" />
          <path d="M-20 482q36-22 72 0t72 0 72 0 72 0 72 0 72 0" />
        </g>
      </g>
    </svg>
  );
}
