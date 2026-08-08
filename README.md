# Weather

A personal weather dashboard built on the [Vaisala Xweather](https://www.xweather.com/)
Weather API. One page, seven views, as much detail as the API will give up.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8)

## What it shows

| View | Contents |
|------|----------|
| **Now** | Interpolated current conditions (~25 fields), "next rain" answer, plain-language narrative, active alerts with expandable full text, minute-by-minute precipitation nowcast, nearest reporting station with distance/bearing/QC/flight rule, nearby threats and lightning counts, and the radar map with 15 stackable layers and a −60m → +60m time slider |
| **Hourly** | 48-hour forecast with six switchable chart metrics — temperature/feels-like/dew point, wind and gusts, precipitation chance and amount, humidity and cloud, pressure, UV and solar radiation — plus a full per-hour breakdown |
| **10-day** | Daily outlook chart with precipitation bars, expandable per-day detail, and separate day/night periods |
| **Last 24h** | Observed conditions charted hour by hour, extremes and totals, and the full reading table |
| **History** | Daily summaries for any date range back to 2001, plotted against 30-year climate normals, with station-reported summaries alongside and a drill-down that reconstructs any past day hour by hour |
| **Air & Sun** | Air quality index with per-pollutant breakdown and a 24-hour forecast; sunrise/sunset/solar noon, all three twilight phases, moon phase and illumination |
| **Rivers & Tides** | Live river/sea gauge levels against their typical range, flood warnings and alerts, UKHO tide predictions with next high/low, and sea state (wave height, period, swell, sea temperature) |
| **Local** | Grid carbon intensity for your postcode's region with a 24-hour forecast and generation mix, street-level crime for the surrounding mile, and the local club's league position, fixtures and results |

Throughout: place autocomplete, geolocation, saved places, °C/°F, 12/24-hour and
light/dark toggles, and shareable `?p=` URLs.

The app is light by default with a dark toggle. The choice persists and is
applied before first paint, so there is no flash of the wrong theme. Colours
come from CSS custom properties on `.wx`, so one `data-theme` attribute flips
the whole app — including the raster map's base layer.

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

| Variable | Required | Description |
|----------|----------|-------------|
| `XWEATHER_CLIENT_ID` | yes | Xweather application ID |
| `XWEATHER_CLIENT_SECRET` | yes | Xweather application secret |
| `ADMIRALTY_API_KEY` | no | UKHO ADMIRALTY UK Tidal API key for tide times. The [Discovery tier](https://admiraltyapi.portal.azure-api.net/) is free (10,000 calls/month). Without it, the Rivers & Tides tab still shows river levels, sea state and flood warnings. |
| `FOOTBALL_DATA_TOKEN` | no | [football-data.org](https://www.football-data.org/client/register) token for fixtures. Without it the rest of the Local tab is unaffected. |
| `FOOTBALL_TEAM` | no | Club to follow (default `Swansea`). |
| `FOOTBALL_COMPETITION` | no | Competition code the club plays in (default `ELC`, the Championship). Change this if they move division. |

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
│       ├── water/          # River levels, flood warnings, tides, sea state
│       ├── local/          # Carbon intensity, crime, football
│       └── diagnostics/    # Which Xweather endpoints your key unlocks
├── components/             # LocationBar, the seven panels, Chart, ui primitives
└── lib/
    ├── xweather.ts         # SERVER ONLY — the Xweather client
    ├── water.ts            # SERVER ONLY — Environment Agency, ADMIRALTY, Open-Meteo
    ├── local.ts            # SERVER ONLY — carbon, police, postcodes, football
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
curl "http://localhost:3000/api/diagnostics?p=51.6656,-3.9333" | jq
```

It calls all twenty endpoint variants the app uses and reports which answered,
which are missing from your subscription, and which returned no data for that
location.

## Data sources

| Source | Auth | Covers |
|--------|------|--------|
| [Vaisala Xweather](https://www.xweather.com/) | ID + secret | Everything on the weather tabs |
| [EA flood-monitoring](https://environment.data.gov.uk/flood-monitoring/doc/reference) | none | River/sea gauges and flood warnings. Open Government Licence. Its flood *warnings* are England-only, but the station feed carries Welsh gauges owned by Natural Resources Wales under the same licence — which is how the Tawe appears without a portal signup |
| [ADMIRALTY UK Tidal API](https://admiraltyapi.portal.azure-api.net/) | subscription key | Tide predictions for 607 UK stations |
| [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api) | none | Wave height, period, swell and sea temperature. 5 km European model — coastal water only, so inland points simply hide the card |
| [Carbon Intensity](https://carbonintensity.org.uk/) | none | Half-hourly grid carbon for the postcode's DNO region, 24-hour forecast, generation mix. Great Britain only |
| [data.police.uk](https://data.police.uk/docs/) | none | Street-level crime within a mile, plus the neighbourhood team. England and Wales. Published monthly, roughly two months in arrears |
| [postcodes.io](https://postcodes.io/) | none | Reverse geocoding lat/lon to a UK postcode, which is what the carbon API is keyed on |
| [football-data.org](https://www.football-data.org/) | token | Fixtures, results and league position |

## Notes

- Xweather returns both metric and imperial fields (`tempC`/`tempF`,
  `windSpeedKPH`/`windSpeedMPH`, …), so the unit toggle costs no extra requests.
- Timestamps carry the location's own UTC offset, so all times are shown as the
  local wall clock at the place you're looking at, wherever you happen to be.
- Daily summary queries are capped at about one month per request upstream; the
  history view enforces that before it asks.
- The Environment Agency and ADMIRALTY both report in UTC. Times from those
  feeds are re-stamped with the selected place's UTC offset before display, so
  a tide at 18:44 BST does not show as 17:44.
- Tide times are predictions and do not account for weather or storm surge.
- Police street-level points are anonymised to a nearby location, so they
  indicate the general area rather than exact addresses.
- The club is resolved by name within its competition rather than by a
  hard-coded id, so a change of division shows a clear message instead of
  silently emptying the card.

## Attribution

- Weather data © Vaisala Xweather, subject to their terms of service.
- River levels and flood warnings © Environment Agency, [Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); Welsh gauges in that feed are owned by Natural Resources Wales.
- Tide predictions © UK Hydrographic Office (ADMIRALTY).
- Sea state from Open-Meteo (CC BY 4.0).
- Carbon intensity © National Grid ESO, Open Government Licence.
- Crime data © data.police.uk, Open Government Licence.
- Fixtures via football-data.org.

The app icon is an original device — a gold double-towered castle over the
blue-and-white wavy bars of Swansea Bay — inspired by Swansea's civic
symbolism. It is **not** the city's coat of arms, which was granted by the
College of Arms in 1922 and belongs to the City and County of Swansea.
