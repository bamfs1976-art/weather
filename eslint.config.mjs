// eslint-config-next 16 ships native flat configs, so no FlatCompat shim.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      /*
       * The remaining hits for this rule are deliberate:
       *   - reading localStorage and the URL on mount (unavailable during SSR)
       *   - seeding the "local time" clock after hydration
       *   - kicking off a fetch when the selected place or date range changes
       *   - resetting the map image's load/error flags when its src changes
       * Each syncs React with something outside it, which is what effects are
       * for. Kept as a warning so a genuinely cascading setState still shows up.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];

export default eslintConfig;
