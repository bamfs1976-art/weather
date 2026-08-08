# Weather

A personal weather dashboard built on the [Vaisala Xweather](https://www.xweather.com/)
Weather API. One page, seven views, as much detail as the API will give up.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8)

## What it shows

| View | Contents |
|------|----------|
| **Now** | Interpolated current conditions (~25 fields), plain-language narrative, active alerts with expandable full text, minute-by-minute precipitation nowcast for the next hour, nearest reporting station with distance/bearing/QC/flight rule, nearby threats and lightning counts |
| **Hourly** | 48-hour forecast with six switchable chart metrics — temperature/feels-like/dew point, wind and gusts, precipitation chance and amount, humidity and cloud, pressure, UV and solar radiation — plus a full per-hour breakdown |
| **10-day** | Daily outlook chart with precipitation bars, expandable per-day detail, and separate day/night periods |
| **Last 24h** | Observed conditions charted hour by hour, extremes and totals, and the full reading table |
| **History** | Daily summaries for any date range back to 2001, plotted against 30-year climate normals, with station-reported summaries alongside and a drill-down that reconstructs any past day hour by hour |
| **Air & Sun** | Air quality index with per-pollutant breakdown and a 24-hour forecast; sunrise/sunset/solar noon, all three twilight phases, moon phase and illumination |
| **Maps** | Xweather raster maps with 15 stackable layers (radar, satellite, temperature, isobars, alerts, storm cells, lightning, wildfires, tropical systems and more) and a −60m → +60m time slider |

Throughout: place autocomplete, geolocation, saved places, °C/°F and 12/24-hour
toggles, and shareable `?p=` URLs.

## Getting started

1. Create an application at [account.xweather.com](https://account.xweather.com/)
   to get a client ID and secret. The free tier covers most of this dashboard.
2. Install and configure:

   ```bash
   npm install
   cp .env.example .env    # then fill in your ID and secret
   npm run dev
   ```

3. Open <http://localhost:3000>.

### Environment variables

| Variable | Description |
|----------|-------------|
| `XWEATHER_CLIENT_ID` | Xweather application ID |
| `XWEATHER_CLIENT_SECRET` | Xweather application secret |

Both are read server-side only, by `src/lib/xweather.ts`. They never reach the
browser — even raster map tiles, which carry the credentials in their URL path,
are proxied through `/api/map`.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Start production server | `npm start` |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |

## How it fits together

```
src/
├── app/
│   ├── layout.tsx          # Root layout; the .wx theme class lives on <body>
│   ├── page.tsx            # Dashboard shell — place, units, tabs, fetching
│   ├── globals.css         # Tailwind import + the whole .wx theme
│   └── api/
│       ├── overview/       # Everything the dashboard needs, in one call
│       ├── history/        # Daily summaries + normals for a date range
│       ├── archive/        # One past day, hour by hour
│       ├── search/         # Place autocomplete
│       ├── map/            # Raster map proxy (keeps credentials server-side)
│       └── diagnostics/    # Which Xweather endpoints your key unlocks
├── components/             # LocationBar, the seven panels, Chart, ui primitives
└── lib/
    ├── xweather.ts         # SERVER ONLY — the API client
    ├── weather-types.ts    # Response types
    └── weather-format.ts   # Client-safe formatting helpers
```

Picking a place calls `/api/overview`, which resolves the location once and then
fans out to fourteen Xweather data sets in parallel. Every data set comes back
wrapped in a `Section<T>`:

```ts
{ ok: boolean, data: T | null, error: string | null, code: string | null }
```

Nothing throws. Xweather gates data sets by subscription tier, so a data set your
key can't reach renders as a quiet inline notice on the card that wanted it,
rather than taking down the page.

**Charts are hand-rolled inline SVG** (`src/components/Chart.tsx`) — lines,
filled areas, an optional bar series on its own scale, and native `<title>`
tooltips. There is no charting dependency; the only runtime dependencies are
Next, React and React DOM.

## Troubleshooting

If a card is empty, ask the API what your key can actually see:

```bash
curl "http://localhost:3000/api/diagnostics?p=cardiff,uk" | jq
```

It calls all twenty endpoint variants the app uses and reports which answered,
which are missing from your subscription, and which returned no data for that
location.

## Notes

- Xweather returns both metric and imperial fields (`tempC`/`tempF`,
  `windSpeedKPH`/`windSpeedMPH`, …), so the unit toggle costs no extra requests.
- Timestamps carry the location's own UTC offset, so all times are shown as the
  local wall clock at the place you're looking at, wherever you happen to be.
- Daily summary queries are capped at about one month per request upstream; the
  history view enforces that before it asks.

## Licence

Weather data © Vaisala Xweather, subject to their terms of service.
