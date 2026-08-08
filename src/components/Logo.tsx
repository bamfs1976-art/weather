/**
 * The app mark: sun behind a cloud with rain. Same drawing as the favicon and
 * home-screen icon, so the header and the iOS app icon read as one thing.
 *
 * Pure SVG with no client hooks, so it can render on the server.
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
      aria-label="Weather"
    >
      <defs>
        <radialGradient id="wx-logo-sun" cx="42%" cy="36%" r="62%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="60%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <linearGradient id="wx-logo-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
      </defs>

      <circle cx="196" cy="180" r="74" fill="url(#wx-logo-sun)" />
      <g stroke="#fbbf24" strokeWidth="15" strokeLinecap="round" opacity="0.9">
        <line x1="196" y1="62" x2="196" y2="30" />
        <line x1="196" y1="330" x2="196" y2="298" />
        <line x1="78" y1="180" x2="46" y2="180" />
        <line x1="113" y1="97" x2="90" y2="74" />
        <line x1="279" y1="97" x2="302" y2="74" />
        <line x1="113" y1="263" x2="90" y2="286" />
      </g>

      <g fill="url(#wx-logo-cloud)">
        <circle cx="228" cy="316" r="66" />
        <circle cx="316" cy="292" r="86" />
        <circle cx="392" cy="330" r="60" />
        <rect x="228" y="330" width="164" height="62" rx="31" />
      </g>

      <g stroke="#38bdf8" strokeWidth="18" strokeLinecap="round">
        <line x1="248" y1="416" x2="232" y2="462" />
        <line x1="318" y1="416" x2="302" y2="462" />
        <line x1="388" y1="416" x2="372" y2="462" />
      </g>
    </svg>
  );
}
