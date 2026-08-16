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
| `METOFFICE_API_KEY` | Optional. Met Office DataHub site-specific, for the Second opinion card |
| `METOFFICE_MAP_API_KEY` | Optional. DataHub map-images — separate subscription, 1000 images/day |
| `METOFFICE_OBS_API_KEY` | **Unused.** DataHub land observations; resolved then dropped, see below |
| `METOFFICE_ATMO_API_KEY` | Optional. DataHub atmospheric models — see the note below before using |

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
- **`places/{query}` wants an identifier, not a name.** Coordinates, a
  postcode, an airport code or "city,state,country" resolve; a bare `Swansea`
  returns `invalid_location`, and because every other endpoint takes the
  resolved point, one unresolved place blanks the entire dashboard. `?p=` is
  what the app writes to the URL and therefore what gets shared, so
  `resolvePlace` falls back to one `places/search` lookup — the same call the
  autocomplete already uses — and only when the direct lookup failed.
- Timestamps carry the location's UTC offset; `weather-format.ts` formats in that
  offset so times read as local-for-the-place.
- **Icons are drawn, not typed.** `src/components/icons.tsx` holds the whole set
  and `ConditionGlyph` picks the weather one from `icon` + `weatherPrimaryCoded`.
  **No emoji in rendered output** — `Metric.icon` was typed `string`, which
  could only ever hold an emoji, so emoji survived in six components long after
  the rest moved over. It is `ReactNode` now. A scan for codepoints above
  U+1F000 outside comments should come back empty.
- **"Next rain" trusts the probability, not the label.** An hour whose
  `weatherPrimary` matched /shower/ used to qualify whatever the numbers said,
  so a 10% chance of 0.0 mm produced "Rain Showers likely" directly above a
  nowcast reading "no precipitation expected in the next 60 minutes". When a
  `pop` is published it decides; the label is only a fallback for when it is not.
- **Forecast arrays are filtered to what has not already finished.**
  `nextPrecipitation` searched from index 0 and could return a period that had
  been and gone — live, on a Sunday morning, "Rain Showers likely in about 0
  hours / From Fri 17:00". `minutesUntil` clamped at zero, which is what turned
  an impossible answer into a plausible-looking one; it is signed now, and the
  search skips anything whose period has ended. It takes a `now` option so
  those cases are testable.
- **`weatherPrimaryCoded` decides the condition, not the icon name.**
  "pcloudyr" is partly cloudy *with rain* and contains neither "rain" nor
  "showers". The coded suffixes are Xweather's: `L`/`ZL` drizzle, `RW` showers,
  `R`/`ZR` rain, `WM` wintry mix, `SC` partly, `BK` mostly, `FW` fair. Twenty-two
  mappings are covered by a test — check the codes against Xweather's list
  rather than from memory, which got five of them wrong in one sitting.

## Met Office comparison

A second forecast beside Xweather rather than instead of it — the DataHub has no
nowcast, no radar rasters and no archive, which is most of what this app does.

- **The free plan is 360 calls a day**, reset at 00:00 UTC. `getMetOfficeHourly`
  caches for 30 minutes, so one location costs about 48. Raising that cache is
  the first thing to check if a `rate_limited` section appears.
- Values arrive in SI and are converted in `lib/metoffice.ts`: m/s to km/h,
  pascals to millibars, metres to kilometres. Do not pass raw Met Office numbers
  to the formatters.
- `compareForecasts` in `weather-format.ts` matches the two by **absolute
  instant, not array index** — Xweather stamps carry the location's offset and
  the Met Office publishes UTC, so index-to-index would compare different times.
  Anything more than 30 minutes apart is dropped rather than fudged.
- Without a key the section returns `no_credentials` and the card explains how
  to switch it on, which is a setup step rather than an error.
- **Each DataHub product is a separate subscription and key.** Four are
  subscribed: site-specific (integrated), map images, land observations
  (dropped), atmospheric models. Only site-specific had a request path that
  could be established from outside; `lib/metoffice-discovery.ts` asks the rest
  where they live and
  `/api/diagnostics` reports the endpoint, identifiers and — for WMTS — the tile
  template under `metofficeProducts`. **Write each client from that answer.**
  Do not guess a path: a wrong path and an unsubscribed product both look like
  "no data", and guessing raster URLs is what took the Xweather map down for
  five rounds. The verdict distinguishes the two — all 404s means the path is
  wrong, a 401 means the path was right and the key was not.
- **Two of the three extra products are order-based, and neither is worth
  integrating.** Atmospheric models deliver gridded GRIB2 against orders placed
  in the portal: hundreds of megabytes, and GRIB2 decoding is not something a
  serverless function should attempt. Map images turn out to work the same way —
  `/map-images/1.0.0/orders`, `/orders/{name}/latest`, `/orders/{name}/latest/
  {fileId}/data`, `/runs?sort=RUNDATETIME`, taken from the Met Office's own
  [map_images_download utility](https://github.com/MetOffice/weather_datahub_utilities)
  rather than guessed — and they are fixed-resolution PNGs of the Global 10 km
  model limited to precipitation rate, surface temperature and MSLP. That is
  not radar, all three parameters already have Xweather rasters, and those
  redraw at any zoom while these do not. Both entries exist so the
  subscriptions are visible, not as a step towards using them.
- **Land observations: resolved, then dropped. Do not restart it.** It lived at
  `/observation-land/1/{6-character geohash}` — inverted noun order, a bare `1`
  where the other products use `1.0.0`, and a geohash where they take a resource
  name. It cost six rounds to find and is not being used, because the premise
  was wrong: this file called it "the only measurement rather than a model", but
  Xweather's `observations`, `observations/summary` and `observations/archive`
  are already integrated and already carry real station readings. It was a
  second source for something the app was not missing. `METOFFICE_OBS_API_KEY`
  is therefore unused.
- **A 4xx is not always a miss.** Both gateway 404s are JSON
  `"type": "Status report"` envelopes; anything else is the product itself
  replying, so even a rejection proves it exists. Land observations answered
  `400 text/plain: "geohash must be exactly 6 chars"` and the probe discarded it
  because it only recognised 2xx and the resource-not-matched 404 — that one
  response was the entire answer, and it named the request shape. That rule is
  still in `productAnswered()` and still worth keeping.
- **The version segment is not always `1.0.0`.** Site-specific lives at
  `/sitespecific/v0/point/hourly`, so a slug that returns product-not-found
  under one version has not been ruled out until the others are tried; pass one
  now sweeps slug × version.
- Probing costs real quota, so each product stops at its first success and
  diagnostics is the only caller. Two products remain in the list and both
  resolve on their first request.

## Keyless sources added beside the paid ones

Six more upstreams, none of which needs a key or registration. All return
`Section<T>`, all report through `/api/diagnostics`. All but ERA5 are in
`/api/overview`.

| Source | Card | Notes |
|--------|------|-------|
| MeteoAlarm CAP / Met Office NSWWS | banner on **Now** | CAP first, RSS as fallback; see below |
| MET Norway Locationforecast | third box in Second opinion | User-Agent is required by their terms |
| Open-Meteo per-model | **Model agreement** on 10-day | one request per model, on purpose |
| Open-Meteo ensemble | **How certain is it?** on 10-day | probability as a member count |
| Open-Meteo ERA5 archive | **Against the record** on History | own route — the payload is ~⅓ MB |
| AuroraWatch UK | card on Air & Sun | national measurement, not a local forecast |

- **Warnings prefer MeteoAlarm's CAP feed and fall back to the RSS.** CAP
  publishes `cap:severity` as a controlled vocabulary — Extreme/Severe → red,
  Moderate → amber, Minor → yellow — so the level is *read* rather than guessed
  out of the title, and `cap:onset`/`cap:expires` give a real validity window.
  `fromMeteoAlarm()` returns `null` rather than a failed Section precisely so a
  bad day at MeteoAlarm falls through to the RSS instead of blanking the banner;
  `via` records which one answered and diagnostics reports it. Entries are
  filtered by `cap:areaDesc` against the region name, and **an entry with no
  area at all is kept** — UK-wide warnings carry no area, and dropping them
  would discard the most important ones.
- **The RSS fallback is a public cache, not an API.**
  `…/PWSCache/WarningsRSS/Region/{id}` is what Home Assistant and
  MMM-UKMOWeatherWarnings read, so it is well-trodden, but it has no
  machine-readable severity field — the level is parsed out of the title — and
  it could change shape without notice. The supported replacement is the NSWWS
  product on DataHub, which needs registration. **The feed still returns an item
  when nothing is in force**, so that title is filtered out; without that the
  page carries a permanent banner.
- **Xweather alerts are not a substitute.** Their network is NWS-derived and a
  query for Swansea returned zero records. UK warnings come from NSWWS, and the
  Met Office is the authoritative publisher whatever Xweather returns.
- **`regionFor()` maps a point to a warning region by bounding box.** They are
  deliberately coarse — they only pick a feed — and anything unmatched falls
  back to the UK-wide feed, which is a superset. The failure mode is "too many
  warnings", never "none".
- **MET Norway will block a caller with no User-Agent**, and rejects
  coordinates with more than four decimals. Both are their documented terms,
  not politeness; `lat.toFixed(4)` is load-bearing.
- **The model spread asks each model separately.** Open-Meteo accepts a
  comma-separated `models=`, which would be one call — but one unrecognised
  identifier fails the whole request, and these identifiers could not be
  verified from the build environment. Separate requests mean a wrong name
  costs its own model and nothing else. Diagnostics lists which answered:
  **anything permanently missing is a wrong name and should be deleted from
  `MODELS`**, not left to fail on every request.
- **Spread measures agreement, not accuracy.** Models can agree and be wrong
  together. The card says so; do not quietly reframe it as confidence in the
  forecast being right.
- **The ensemble is the honest version of that, and the two cards are not
  duplicates.** Model agreement compares four models that each ran once, so its
  spread is an *inference* about confidence. The ensemble is one model run
  dozens of times from perturbed starting states, so "40% chance of rain" is
  literally the share of runs that produced ≥ 0.1 mm and the shaded band is
  where eight runs in ten land. Keep the wording on each card distinct.
- **Count the members, never assume them.** `memberSeries()` counts
  `…_memberNN` keys in the response rather than hard-coding 51: the member count
  differs per model and Open-Meteo can trim it. A response with fewer than three
  members is rejected rather than presented as a percentile.
- **`ENSEMBLES` is an ordered candidate list and the first that answers wins**,
  same reasoning as `MODELS` — an identifier that cannot be verified from the
  build environment should cost only itself.
- **ERA5 is reanalysis, not observation.** A model run backwards over the
  historical record for the grid square. Excellent for "is this month unusual",
  but a "record" here is not one the Met Office would publish, and the card
  carries that caveat explicitly — do not remove it or soften it to "records".
- **ERA5 lags real time by about a week**, so `getClimateContext` ends its range
  at now − 7 days and reports `lastDayISO` rather than implying it is current.
- **Only complete years are ranked.** A half-finished August compared against 85
  finished ones would rank on partial data — `year < thisYear` is the filter,
  and `yearsCompared` is what the card shows so the denominator is visible.
- **`/api/climate` is its own route on purpose.** The archive response is eighty
  years of daily values, around a third of a megabyte; folding it into
  `/api/overview` would put that on the critical path for every location change
  to serve one card on a tab most visits never open.
- **AuroraWatch ask for three minutes between requests**; the cache is ten.

## The Met Office tab

`MetOfficePanel` is everything that provider publishes for the location: the
NSWWS warnings in full, the site-specific forecast with feels-like, gusts,
humidity, visibility, pressure and UV per hour, a 48-hour chart, and the
comparison against Xweather.

The compact "second opinion" on Now and Hourly stays exactly where it was. The
two answer different questions — "do they agree?" belongs beside the number it
qualifies, and none of the extra fields fit in a two-provider diff.

- **Absolutely positioned descendants escape a horizontal scroller.** The hour
  strip uses `sr-only` `<dt>` labels, and with no positioned ancestor they
  resolve against the initial containing block — their static position sits at
  the far end of a 5,000px strip, which dragged the document's scroll width out
  with it and put **4911px of horizontal overflow** on the page at 390px. The
  scroller clipped the visible columns perfectly the whole time; `overflow-x`
  does not contain an absolutely positioned child. `position: relative` on each
  column fixes it, and is why the day/night strip on 10-day never had the
  problem — it has no `sr-only` inside.
- Diagnose this class of bug by bisecting, not by reading CSS: hide each card in
  turn and re-measure `documentElement.scrollWidth`. Three plausible theories
  were wrong before that named the right element in one pass.

## Source attribution

`Card` takes a `source` prop that renders a hairline-separated line at the
bottom. With nine upstreams in play, a card showing a temperature without
saying whose it is makes the Xweather / Met Office / MET Norway disagreements
look like a bug rather than the point of the card.

## Other open data (no keys)

Every one of these is keyless and Open Government Licence or equivalent, and
each returns a `Section<T>` like the Xweather calls, so a dead source blanks one
card and nothing else. All are covered by `/api/diagnostics`.

| Source | Used for | Notes |
|--------|----------|-------|
| EA flood-monitoring | flood warnings, river gauges, **tide gauges** | one API, three queries; Welsh gauges belong to NRW |
| Defra/NRW bathing water | beach classifications | **returns 403 in production**; the card hides itself, see below |
| Open-Meteo Marine | sea state | 5 km European grid; nothing inland |
| Open-Meteo air quality | **pollen** | 11 km CAMS; Europe only, so it returns `warn_no_data` elsewhere |

- **Tides are measurements, not predictions.** The EA gauge reports observed sea
  level every 15 minutes, so the highs and lows shown have already happened;
  they are found by smoothing the series and fitting a parabola to each turn
  (`findTurningPoints`). Predicted tide tables need an Admiralty subscription.
  The "next high water" line projects forward by the mean lunar interval and is
  labelled an estimate on the card — do not quietly promote it to a prediction.
- **Tide readings come from the measure, not the station.**
  `/id/stations/{id}/readings?since=` answers 200 with an empty list, which is
  why the card kept reporting a silent gauge; `getRiverStations` has meanwhile
  been calling the same route with `?latest` successfully throughout, so it is
  `since=` that the station route does not honour. The series is fetched from
  `/id/measures/{id}/readings?since=` instead, via the station→measures hop the
  river code already proves in production. The measure is picked by qualifier,
  then unit (`mAOD`), then parameter, so a spelling change cannot look like a
  dead gauge.
- **The three hops share one 8s budget and every failure names its hop.**
  Separate 8s and 6s timeouts totalled 14s against Netlify's 10s ceiling, so a
  merely slow lookup guaranteed the readings query was killed and blamed. The
  messages now carry the station, its distance, the measure URI and the raw row
  count — "no readings" was a dead end three rounds running.
- **The tide fetch walks outwards through the gauges.** Mumbles (E72924) came
  back with no rows for thirteen hours while six other gauges sat unqueried in
  the same response, so a silent gauge is now a reason to ask the next one, not
  to blank the card. Bounded by the remaining budget rather than a fixed count.
  This is **not** the fallback chain that caused the throttling: that tried
  several URL *shapes* against one station; this makes the same proven request
  against a different station.
- **Do not percent-encode the `since` timestamp.** A colon is legal in a query
  value, and an upstream that does not decode `%3A` sees a malformed date and
  answers with an empty list rather than an error — indistinguishable from a
  silent gauge, which is how it went unnoticed through three rounds.
- **Match the tidal measure on the id as well as the qualifier.** E72924
  publishes `…-level-tidal_level-Mean-15_min-m`: plain metres, and no
  `qualifier` field at all. Unit-only or qualifier-only matching misses it.
- **Bathing water returns 403 and the card removes itself.** Four URL shapes
  were tried, with and without a User-Agent, and every one was refused while
  flood-monitoring — a different service on the same host — answered normally.
  So `BathingBlock` renders nothing when the section is not ok, rather than
  showing a notice that can never clear. The request and the diagnostics entry
  are both still there, so if Defra ever serves it the card reappears on its own.
- **`lib/osgb.ts` converts WGS84 to National Grid** because the bathing water
  service offers no lat/long filter. It is checked against published control
  points (Greenwich and Ben Nevis, both to within ~10 m); keep that test passing
  if you touch it.
- Pollen bands differ per species — birch and alder routinely reach counts that
  would be extraordinary for grass — so `THRESHOLDS` in `lib/pollen.ts` is a
  per-species table, not one shared scale.

## Conventions

1. **Read before writing** — read existing files before modifying them.
2. **Never import `src/lib/xweather.ts` from a client component.** It reads the
   Xweather secret. Client components use `src/lib/weather-format.ts` instead.
3. **Sections degrade, they don't throw.** Every upstream call returns
   `Section<T>` (`{ ok, data, error, code }`). Render a notice for `ok: false`
   rather than failing the page — a data set missing from the user's
   subscription tier is a normal outcome, not a bug.
4. **A section may be absent as well as failed, and the types say so.** The
   section maps on `WeatherOverview`, `HistoryPayload` and `ArchiveDayPayload`
   are `Partial`, because each payload is JSON parsed off the wire and cast:
   declaring a section non-optional asserts a guarantee the response cannot
   make, and a route deployed before a section existed simply will not carry it.
   Three times a component read `.ok` off an absent section and took its whole
   tab down — the pollen card, the warnings banner, the station summaries. So
   **reach a section through `?.`**, or hand it to `SectionBody`, which already
   accepts `undefined`. The producing side keeps the stronger guarantee: the
   routes annotate what they build with `satisfies OverviewSections` (and the
   `History`/`Archive` equivalents), so adding a section to the interface fails
   the build until the route supplies it. This is the same failure mode as
   `Metric.icon` being typed `string` — when a type promises more than the value
   can, the compiler stops helping.
5. **No new dependencies without a reason.** Charts are inline SVG and dates are
   formatted by hand on purpose; keep it that way unless something genuinely
   needs a library.
6. **Validate anything that reaches a URL path.** `/api/map` interpolates input
   into an upstream URL that contains the credentials — the layer allow-list and
   offset regex exist for that reason.
7. **Styling is Tailwind plus the `.wx` tokens** in `globals.css`. Note that
   `globals.css` loads after Tailwind, so a `.wx-*` shorthand (e.g. `.wx-field`'s
   `padding`) will beat a utility class; add a scoped `.wx-*` variant instead of
   fighting it.
8. **Test your work** — run `npm run build` and `npm run typecheck` after
   changes.
9. **Keep this file updated** when adding routes, components or conventions.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
