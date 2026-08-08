# CLAUDE.md — Weather

Guidance for AI assistants (Claude, etc.) working in this repository.

## Project overview

A personal weather dashboard on the Vaisala Xweather Weather API. Single Next.js
app: one page with seven tabbed views (Now, Hourly, 10-day, Last 24h, History,
Air & Sun, Maps).

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 ·
Vaisala Xweather API. Runtime dependencies are Next, React and React DOM only —
there is deliberately no charting or date library.

## Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout; .wx theme class sits on <body>
│   ├── page.tsx            # Dashboard shell: place, units, clock, tabs, fetch
│   ├── globals.css         # Tailwind import + the entire .wx theme
│   └── api/
│       ├── overview/route.ts     # 14 Xweather data sets, one call
│       ├── history/route.ts      # Daily summaries + station summaries + normals
│       ├── archive/route.ts      # One past day, hour by hour
│       ├── search/route.ts       # Place autocomplete
│       ├── map/route.ts          # Raster map proxy
│       └── diagnostics/route.ts  # Per-endpoint availability report
├── components/
│   ├── ui.tsx                    # Card, Metric, Chip, Meter, Notice, SectionBody
│   ├── Chart.tsx                 # Dependency-free SVG line/area/bar chart
│   ├── LocationBar.tsx           # Search, geolocation, favourites, unit toggles
│   ├── NowPanel.tsx              # Current conditions, alerts, nowcast, hazards
│   ├── HourlyPanel.tsx           # 48-hour forecast
│   ├── ForecastPanel.tsx         # 10-day + day/night
│   ├── RecentPanel.tsx           # Trailing 24 hours
│   ├── WeatherHistoryPanel.tsx   # Archive explorer (fetches independently)
│   ├── AirSunPanel.tsx           # Air quality + sun/moon
│   └── MapPanel.tsx              # Raster map with layer picker
└── lib/
    ├── xweather.ts         # SERVER ONLY — reads the credentials
    ├── weather-types.ts    # Xweather response types
    └── weather-format.ts   # Client-safe formatting helpers
```

## Commands

| Task | Command |
|------|---------|
| Install | `npm install` |
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |

## Environment

| Variable | Description |
|----------|-------------|
| `XWEATHER_CLIENT_ID` | Xweather application ID from https://account.xweather.com/ |
| `XWEATHER_CLIENT_SECRET` | Xweather application secret |

Copy `.env.example` to `.env`. Without them the app still renders — every route
returns a clear "credentials are not configured" notice instead of crashing.

## Data flow

```
User picks a place (search / geolocation / saved chip)
  → page.tsx calls GET /api/overview?p=…
  → route resolves the place once, then fans out to Xweather in parallel
  → each data set is wrapped in a Section (ok | error + code)
  → panels render, showing an inline notice for any unavailable section
```

`WeatherHistoryPanel` is the exception — it fetches `/api/history` and
`/api/archive` itself, because the date range is user-driven.

## Xweather notes

- Base URL `https://data.api.xweather.com/{endpoint}/{action}`, auth via
  `client_id` / `client_secret` query params, envelope
  `{ success, error: { code, description }, response }`.
- Endpoints used: `places`, `places/search`, `conditions` (current, `filter=1min`
  nowcast, trailing window, and `conditions/summary` for daily history),
  `observations` (+ `/summary`, `/archive`), `forecasts` (`1hr`, `mdnt2mdnt`,
  `daynight`), `alerts`, `airquality` (+ `/forecasts`), `sunmoon`, `threats`,
  `lightning/summary`, `phrases/summary`, `normals`.
- Raster maps come from
  `https://maps.api.xweather.com/{id}_{secret}/{layers}/{w}x{h}/{lat},{lon},{zoom}/{offset}.png`.
  `/api/map` validates the layer list against an allow-list before building it.
- **Never invent a raster layer token.** They live in `src/lib/map-layers.ts`,
  which both the proxy route and `MapPanel` import so the two cannot drift.
  A rejected token fails the *whole* image rather than just its own layer, so
  one wrong guess takes the map down under every setting. Several obvious
  guesses are wrong: it is `satellite-geocolor` not `satellite`,
  `countries-outlines` not `countries`, `fires-obs-points` not `fires`,
  `lightning-all` not `lightning-strikes-5m-icons`, and
  `air-quality-index-categories` not `air-quality-index`. To add a layer, get
  the real token from the Vaisala Xweather MCP server's `xweather_get_raster_maps`
  tool — it returns a fully built map URL, and the tokens can be read straight
  out of the path.
- `GET /api/diagnostics?p=<place>` calls every endpoint above and reports which
  ones the configured key can actually reach — start there when a card is empty.
- Responses carry both metric and imperial fields, so the unit toggle needs no
  extra requests.
- Timestamps carry the location's UTC offset; `weather-format.ts` formats in that
  offset so times read as local-for-the-place.

## Conventions

1. **Read before writing** — read existing files before modifying them.
2. **Never import `src/lib/xweather.ts` from a client component.** It reads the
   Xweather secret. Client components use `src/lib/weather-format.ts` instead.
3. **Sections degrade, they don't throw.** Every upstream call returns
   `Section<T>` (`{ ok, data, error, code }`). Render a notice for `ok: false`
   rather than failing the page — a data set missing from the user's
   subscription tier is a normal outcome, not a bug.
4. **No new dependencies without a reason.** Charts are inline SVG and dates are
   formatted by hand on purpose; keep it that way unless something genuinely
   needs a library.
5. **Validate anything that reaches a URL path.** `/api/map` interpolates input
   into an upstream URL that contains the credentials — the layer allow-list and
   offset regex exist for that reason.
6. **Styling is Tailwind plus the `.wx` tokens** in `globals.css`. Note that
   `globals.css` loads after Tailwind, so a `.wx-*` shorthand (e.g. `.wx-field`'s
   `padding`) will beat a utility class; add a scoped `.wx-*` variant instead of
   fighting it.
7. **Test your work** — run `npm run build` and `npm run typecheck` after
   changes.
8. **Keep this file updated** when adding routes, components or conventions.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
