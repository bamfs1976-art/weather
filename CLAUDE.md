# CLAUDE.md — Weather

Guidance for AI assistants (Claude, etc.) working in this repository.

## Project overview

A personal weather dashboard for Swansea. **The Met Office is the data feed;
Xweather does the maps and the second opinion, and nothing else.** Single
Next.js app: one page with tabbed views (Now, Hourly, 7-day, Last 24h, History,
Rivers & Sea, Air & Sun, Local, Maps).

**One dashboard load costs two Xweather accesses** — a `places` resolve and the
hourly forecast the comparison card compares against — down from fifteen. Every
other data set it used to supply moved to the Met Office, to a keyless source
already in the app, or (sun and moon) to arithmetic.

| What | Where it comes from now |
|------|-------------------------|
| Current, hourly, 7-day, day/night | Met Office site-specific |
| Severe weather warnings | MeteoAlarm CAP → NSWWS RSS |
| Maps | Xweather rasters |
| Second opinion | Xweather hourly + MET Norway |
| Nowcast (next 2 h) | Open-Meteo `minutely_15` |
| Rain radar | RainViewer tiles + OpenStreetMap base |
| Last 24 hours | Open-Meteo `past_days` |
| Air quality | Open-Meteo (CAMS), European AQI |
| Pollen | Open-Meteo (CAMS) |
| **Sun & moon** | **computed locally — no upstream at all** |
| Model spread, ensemble, ERA5 | Open-Meteo |
| Rivers, tides, floods | Environment Agency |
| **Live lightning strikes** | **Blitzortung.org WebSocket, straight from the browser** |

- **Geocoding is keyless, and must stay that way.** Every section is fetched
  for the coordinates `resolvePlace` returns, so a failure there blanks the
  *whole page* — and while that ran through Xweather, a paused Xweather key
  took the dashboard down even with the Met Office, Open-Meteo and the EA all
  answering. `lib/geocode.ts` parses a `lat,lon` pair outright (the default
  place and every shared `?p=` link), asks Open-Meteo for names, and only then
  falls back to Xweather for the identifiers Open-Meteo will not take, such as
  airport codes. **Do not put place resolution back on a rationed provider.**
- **A missing Xweather key is no longer fatal to `/api/overview`.** That gate
  dates from when Xweather supplied every number; refusing to build the page
  without it now fails eight working upstreams for the sake of one.
- **The geocoder separates `network` from `invalid_location`**, for the reason
  `capReason` exists on the warnings feed: "cannot reach it" and "no such
  place" call for opposite responses, and telling someone their spelling is
  wrong when the service is down is the worse of the two mistakes.

**Retired, deliberately:** Xweather's `conditions`, `observations`,
`forecasts` (daily and daynight), `alerts`, `airquality`, `sunmoon`, `threats`,
`lightning/summary` and `phrases/summary`. The forecast ones because the Met
Office publishes them better for the UK; `alerts` because NSWWS is the
authoritative UK publisher and Xweather's NWS-derived network returned nothing
for Swansea anyway; the rest because something free already covered them. They
are still in `xweather.ts` and still swept by `/api/diagnostics` — knowing what
a key unlocks is worth asking on the day a plan changes — but nothing calls
them on the per-load path.

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
│   ├── LightningPanel.tsx        # Live strikes, hotspots, alarm (Blitzortung)
│   ├── useLightningFeed.ts       # The Blitzortung WebSocket, as a hook
│   └── MapPanel.tsx              # Raster map with layer picker
└── lib/
    ├── xweather.ts         # SERVER ONLY — reads the credentials
    ├── lightning.ts        # Client-safe: strike decoding, distance, threat, hotspots
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

## The access allowance, and what spends it

The plan is 15,000 accesses a month and it was spent in eighteen days. Every
number here is per action, counted from the call sites — **a raster map image
is an access too**, which is the part that is easy to forget.

| Action | Accesses |
|--------|----------|
| One dashboard load (`/api/overview`) | **15** — 14 data sets + one `places` resolve |
| One `/api/diagnostics` run | **~19**, or **~66** with `?maps=1` |
| One map image on screen | **1** — seven time offsets, so seven per animation cycle |
| History range change / archive day | ~3 each |
| Typing a place name | 2–4 (`places/search`, 250 ms debounce) |

- **`TTL` in `xweather.ts` is the main lever, and every value was tighter than
  the data behind it moves.** Observations publish hourly, forecasts a few
  times a day, normals never. Set these from the publication interval, not from
  how fresh it would be nice for the page to look. `minutely` stays shortest
  because a 60-minute nowcast is the one thing here genuinely about the next
  few minutes.
- **A key-level refusal opens a breaker.** Xweather pauses a plan that has
  spent its allowance, and a paused key still costs a request to say so — so
  every load was firing fifteen doomed calls at an allowance that had already
  run out. `KEY_LEVEL_CODES` (plus HTTP 429) parks further calls for ten
  minutes. It lives in module scope deliberately: a cold start clears it, so
  there is nothing to invalidate when the plan resumes. Diagnostics calls
  `resetBreaker()` first, because measuring is its whole purpose.
- **The raster probes in diagnostics are off by default.** They were 47 of the
  66 accesses a run cost, and they answer a question — "do the layer tokens
  still resolve?" — that is asked once after changing a token and never again.
  `?maps=1` runs them. The report says `mapsProbed` either way: an empty
  `maps.working` and a skipped probe look identical otherwise, and "every layer
  is broken" is exactly the alarm that sent five rounds after the map.
- **Do not re-enable the shared caches on `/api/map` to save accesses.** That
  is the obvious-looking economy and it is a bug this route already had: a
  shared cache in front of it stored one image and served it for every distinct
  layer stack. The browser cache is the safe one — keyed on the full URL,
  private to one reader — so the lever is its *lifetime*, not its scope. It is
  ten minutes rather than two, which matches how often radar composites
  publish and cuts the animation's cost by five.

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

## The radar

`RadarMap` on **Now** is real weather radar — RainViewer's public index, ~2 h of
observed frames plus a short extrapolation, keyless. It answers *where the rain
is*; the rain timeline below answers *when it arrives*. Radar is an observation
and a model forecast is not, which is why both are on the page.

- **It is a tile service, not a composite.** The Xweather map takes a centre and
  a zoom and returns one rendered picture; RainViewer serves XYZ tiles, so the
  Web Mercator projection lives in `lib/tiles.ts` and the tiles are laid out as
  absolutely positioned images. Forty lines of arithmetic instead of Leaflet,
  which is what convention 5 is for. The projection is checked by round-trip
  against an independent inverse and by asserting the point lands dead centre
  across 36 place/zoom/viewport combinations — **an off-by-one in a tile grid
  still looks like a plausible map**, so eyeballing it proves nothing.
- **Tiles load straight from the browser.** Both sources are keyless, so a
  proxy would add a serverless hop and re-create the shared-cache hazard
  `/api/map` was bitten by, for nothing. Only the small JSON index goes through
  `/api/radar`, which sidesteps any question about CORS on the index.
- **`/api/radar` may be publicly cached**, unlike `/api/map`: the response is
  identical for every viewer and carries no credentials. That difference is the
  whole reason the map route's caching rules do not apply here.
- **Written against published docs, unverified from the build environment** —
  the egress proxy refuses `api.rainviewer.com`, as it does every Met Office
  host. So every field is optional and coerced, a renamed `nowcast` key
  degrades to past-frames-only rather than failing, and `/api/diagnostics`
  reports `pastFrames`/`forecastFrames`: **a successful request with zero
  frames is a wrong assumption about the shape, not a quiet radar**, and on the
  map those two look identical.
- **The base map is OpenStreetMap**, attributed on the card as their licence
  requires. Their tile policy discourages heavy use; a personal dashboard is
  within it, but if the tiles ever start returning errors this is the first
  thing to suspect.
- **`nowIndex` is the last *observed* frame, not the last frame.** The scrubber
  opens there so the map shows what radar has seen rather than an
  extrapolation, and the forecast frames sit to its right where they read as
  the future. They are labelled, and the caption says they are good for about
  half an hour and are not a forecast beyond that.

## The lightning tab

`LightningPanel` is a free stand-in for the paid strike-tracker apps — Latest,
Hotspots and Radar views over a map, the nearest strike and how far away it is,
an alarm with a radius, and the Met Office's chance of lightning for the days
ahead. The data is **Blitzortung.org**, a volunteer detection network whose
strikes are published to the browser over a public WebSocket — the feed their
own map at map.blitzortung.org draws from. Keyless; the terms are private,
non-commercial use with attribution, so keep the credit on the cards and never
put this behind anything that charges.

- **The socket is opened from the browser, not the server.** A serverless
  function cannot hold a WebSocket open, and the feed is worldwide and
  unfiltered — tens of strikes a second in a busy hour — so the client decodes
  each message, measures the distance to the place, keeps anything within
  250 km and drops the rest. `useLightningFeed` pushes kept strikes onto a ref
  and flushes to React state once a second; setting state per message would
  re-render the map fifty times a second.
- **Written against the reverse-engineered protocol and unverified from the
  build environment**, which refuses every `blitzortung.org` host. The
  assumptions are listed at the top of `lib/lightning.ts`: hosts `ws1`–`ws8`,
  `{"a":111}` to subscribe, one LZW-compressed JSON strike per message, `time`
  in nanoseconds. Every field is optional and coerced, plain JSON is tried
  before the LZW decoder so dropping the compression would not break it, and
  the epoch unit is told from magnitude. The panel's "Feed details" shows raw
  counters — messages, decoded, undecodable, kept, last message age. **A live
  socket with messages arriving and nothing decoding is a wrong assumption
  about the shape, not a quiet sky**; on the map the two look identical.
- **Hosts rotate on failure and on silence.** A socket that opens and never
  speaks for 45 s is closed and the next host tried; after two full rounds the
  status reads `offline` and the page shows whatever it saw earlier. Backoff
  caps at a minute — every host having refused is not a reason to hammer them.
- **`threatLevel` counts only the last 15 minutes**: within 10 km is
  "overhead", 25 "near", 100 "distant". A storm that passed an hour ago is
  history, and the headline must not say otherwise. `summariseStrikes` covers
  the hour; the two windows are deliberate.
- **The alarm rings once per storm, not per strike**, and never for a strike
  older than two minutes — a backlog replayed on reconnect must not set it
  off. Sound is a Web Audio chime created inside the toggle's click handler,
  because a context created later is muted by the browser. Notifications use
  the page-level API and only work while the tab is open; there is no push
  server and the card says so.
- **Strikes are persisted per place in localStorage** (`wx:lightning:<lat,lon>`)
  for the 24-hour hotspot grid, capped at 5,000, so a page reopened after a
  storm still knows the storm happened. A change of place starts from an empty
  sky rather than plotting one town's strikes over another.
- **`hotspots()` grids in degrees, widened by cos(lat)** so the cells are
  square on the ground, and anchors the grid to the place so it does not shift
  as strikes arrive. Distance rings on the map come from `metresPerPixel`,
  the Web Mercator scale at the place's latitude — the tile arithmetic itself
  is still `tiles.ts`.
- **The pure functions are checked, not eyeballed**: an LZW round trip
  against an independent encoder (including the KwKwK case), the epoch-unit
  ladder, Swansea→Cardiff at 57 km and roughly east, ring counts, threat
  levels across the windows, the alarm's quiet period, and hotspot cell
  centres. The check script is in the session scratchpad rather than the
  repo; keep the functions pure so it can be re-run.
- **The one-second clock is `useNowSeconds()` in `useClock.ts`**, a second
  store beside the once-a-minute one rather than a faster shared timer. Same
  server snapshot of 0, same rule: no relative phrase until the browser takes
  over.
- **A shared link carries `&tab=lightning`.** `page.tsx` reads a `tab` query
  on mount and ignores unknown values, so the recipient lands on the strike
  rather than the forecast.

## The rain timeline

`RainTimeline` on **Now** answers "is it about to rain?" in a sentence, the way
a rain-radar app does, from a forecast the page already fetches. Two hours of
quarter-hour steps from Open-Meteo `minutely_15`; no extra call, no allowance.

- **`rainOutlook()` in `weather-format.ts` is pure and takes no clock.** Every
  answer is an instant from the series, so the caller decides what "in 25
  minutes" means. That keeps the hydration hazard in the component instead of
  baked into a value the server computed.
- **`peak` is the peak of the spell being described, not of the window.** A
  light shower in fifteen minutes followed by a downpour in an hour was being
  announced as "Moderate rain in 15 min" — the imminent spell labelled with a
  later one's intensity. `windowPeak` and `moreLater` carry the rest.
- **`endsISO` is null when the rain is still falling at the end of the
  window**, which is a different statement from "stops at the end" and must not
  be rendered as one.
- **`useNow()` (`components/useClock.ts`) reports 0 until the browser takes
  over** and every caller must treat it as "no clock yet" — show the absolute
  time on the first paint, add the relative phrase after. The first render is
  then less specific rather than wrong. `WarningBanner` uses the same hook;
  there is one timer on the page.
- **It is a model, not radar**, and the card says so. Good for "rain this
  hour", less sharp than radar at "rain in eight minutes". Do not let the
  headline's confident phrasing outrun that. The Maps tab radar loop is where
  the rain actually is.

## Sun and moon are computed, not fetched

`lib/sunmoon.ts` is the one data set with no upstream: NOAA's solar equations
and Meeus's lunar ephemeris, pure and synchronous. It returns a `Section` like
everything else so `SectionBody` and the degrade-don't-throw rule still apply.

**The accuracy is measured, not assumed, and the presentation depends on it.**
Day length at 51.6°N comes out 16 h 40 m at the summer solstice and 7 h 49 m at
the winter; the transit tracks the equation of time across its full ±16 minute
swing; rise and set are symmetric about the transit to the second. Moon rise and
set land within a few minutes, and the day-to-day shift varies between 30 and 66
minutes — that spread is the moon's changing declination, not noise. Over six
years the model gives 74 new moons at a mean synodic month of 29.522 days
against a true 29.531, so the phase instant runs ~12 minutes early per month;
illumination is taken from the instantaneous elongation instead of that
accumulating count, and lands on 0.000 and 1.000 at new and full.

- **The single-term lunar longitude is not enough.** The 6.289° equation of the
  centre alone — where most one-file implementations stop — put successive new
  moons 29.25 days apart. Evection, variation and the annual equation fix it.
- **A missing horizon crossing is ambiguous**: it means the sun never reaches
  that altitude, which is midnight sun in one hemisphere and polar night in the
  other. The sun's altitude at transit decides which, and both are reported as
  their own field rather than as a null time.

## Met Office is the primary forecast

**The Met Office supplies the headline numbers; Xweather is the second opinion.**
It is the authoritative forecaster for the UK and this is a UK dashboard. The
DataHub still has no nowcast, no radar rasters and no archive — so Xweather is
not going anywhere, it just stopped being what the page leads with.

- **The conversion happens once, on the server.** `metoffice-periods.ts` turns
  `MetOfficeHour`/`MetOfficeDay` into `WeatherPeriod` — Xweather's shape — and
  `/api/overview` publishes the result as the `primary` section. Teaching each
  panel about a second provider would have meant touching every one of them and
  leaving two rendering paths to drift; instead **no panel knows there are two
  providers**. `leadForecast()` in `weather-format.ts` picks `primary` when it
  is ok and falls back to the Xweather sections when it is not, and returns
  ready-made `Section`s so a panel swaps one identifier rather than growing a
  second branch.
- **A failed `primary` is not an error state**, it is the fallback path — the
  panels then render exactly what they always rendered. Which is why the cards
  take their `source` from `lead.source` rather than a hard-coded string: with
  nine upstreams the provider has to be visible, and it is no longer constant.
- **The condition round-trip is asserted, not assumed.** A synthesised period
  carries the kind in `weatherPrimaryCoded` and the night flag in `icon` —
  `classifyCondition` decides the kind from the code outright and derives night
  from the name's trailing "n" independently, so one pair of names serves every
  condition. All 17 kinds × day/night were checked to classify back to
  themselves. Do not hand-edit `CODE_FOR_KIND` from memory; CLAUDE.md already
  records five of those suffixes being got wrong in one sitting.
- **The daily action's field names are unverified.** No Met Office host is
  reachable from the build environment, so `dayMaxScreenTemperature` and its
  siblings follow the documentation. The *path* is not a guess — `daily` is the
  action sibling of the `hourly` endpoint already proven in production on the
  same subscription, which is the distinction this file draws between adding an
  action and hunting for a product. Diagnostics reports `days` **and**
  `daysWithTemp`: a successful request with zero `daysWithTemp` is a wrong
  field name, not a wrong path.
- **`pop` on a day is the higher of the day and night halves.** A 60% chance
  overnight is still a wet day; taking the daytime figure alone would hide it.

### The API does not support parameter subsetting

**Every request returns every parameter for that time step**, so a field the
app does not read is a field it fetched and threw away. Hourly returns 18,
three-hourly 21, daily 41. Reading more of them costs nothing — no extra call,
no extra allowance, no extra latency. This is the first thing to check before
adding an upstream: the answer may already be in a response being fetched.

- **All three actions share one free 360-a-day allowance**: `hourly` (48 h),
  `three-hourly` (168 h) and `daily` (7 days). Caches are 1 h, 3 h and 3 h, so
  a location costs 40 a day and nine saved places fit.
- **Dew point was the visible casualty.** `NowPanel` reads `dewpointC` for a
  tile and for the "Comfortable / Humid" hints, and nothing was feeding it once
  the Met Office became primary — `screenDewPointTemperature` had been arriving
  in every response all along. Also now read: `precipitationRate`,
  `totalSnowAmount`, `maxScreenAirTemp`, `minScreenAirTemp`, `max10mWindGust`.
- **The daily bounds are a real confidence interval**, not a spread inferred
  from disagreement: `dayLowerBoundMaxTemp` is the value with a 97.5%
  probability of being exceeded and `dayUpperBoundMaxTemp` the one with a 97.5%
  probability of not being, so the gap is a 95% interval on the day's high.
  `ConfidenceCard` shows it and **falls back to the Open-Meteo `EnsembleCard`
  when no day carries a bound** — the check is on a bound actually arriving,
  not on the section being ok, so an unrecognised field name degrades to the
  card that already worked instead of showing an empty one.
- **Probability by type replaces one blended number.** Rain, heavy rain, snow,
  heavy snow, hail and sferics, day and night. **"Sferics" is a lightning
  strike within 50 km** — the Met Office's own answer to a card that was
  costing an Xweather access. `PrecipChancesCard` hides any row no day carries.
- **Day/night now comes from the daily response**, which already splits every
  measurement into the two halves that strip wants, so the Xweather `daynight`
  call was dropped: one fewer access on every dashboard load. The night half is
  stamped at +12 h rather than sharing the day's instant, because two periods
  at the same time collapse in any list keyed on time.
- **`RestOfWeek` takes its cutoff from the data, never the clock.**
  `Date.now()` during render is impure *and* a hydration hazard — server and
  browser would disagree about how many tiles to draw. The last hour the 48-hour
  strip actually shows is deterministic and is the more literal reading of
  "where the hourly forecast ends".
- **A range converts as a scale, not a temperature.** A 4 °C spread is 7.2 °F,
  not 39.2 °F; putting a difference through `formatTemp` adds the 32° offset
  and turns every band into nonsense. `degrees()` in `ConfidenceCard` exists
  for that.
- **BPF is not free and should not be built on.** The Blended Probabilistic
  Forecast is a 30-day trial at 55 calls a day, one site, then paid. It is the
  most tempting product on the DataHub and it does not fit this app; the daily
  bounds above give most of the same value at no cost.
- **Land observations is free (360/day) and still not used.** The note below
  says do not restart it, and the reasoning — Xweather already carries station
  readings — was sound when Xweather was healthy. It is weaker now that
  Xweather is rationed, so this is no longer a closed case, only a low
  priority: it covers ~140 UK sites, so the question is whether one is near
  enough to be worth a call.

- **The free plan is 360 calls a day**, reset at 00:00 UTC, and **two** actions
  are now in play. Half an hour each would be 96 a day for one location — three
  saved places and the allowance is gone by evening. Hourly is cached for an
  hour and daily for three: 32 a day per location, so eleven places fit.
  Nothing is lost by it, because the displayed "now" is chosen per request from
  the cached 48-hour series (`metOfficeCurrent`) rather than being whatever the
  cache happened to store — **a cached series still shows the right hour**.
  Raising these is the first thing to check if a `rate_limited` section appears.
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
  publishes `cap:severity` as a controlled vocabulary — so the level is *read*
  rather than guessed out of the title, and `cap:onset`/`cap:expires` give a
  real validity window. `fromMeteoAlarm()` returns `null` rather than a failed
  Section precisely so a bad day at MeteoAlarm falls through to the RSS instead
  of blanking the banner; `via` records which one answered and diagnostics
  reports it. Entries are filtered by `cap:areaDesc` against the region name,
  and **an entry with no area at all is kept** — UK-wide warnings carry no
  area, and dropping them would discard the most important ones.
- **`cap:expires` is a filter, not just a caption.** It was being formatted
  into the "Valid from … to …" line and never compared to the clock, so a
  thunderstorm warning that ended on 20 August was still on the card on the
  26th, in the present tense, under a live-looking heading. The feed listing
  recent alerts is normal; showing them is not. Entries whose expiry has passed
  are dropped, and a feed where *every* entry has expired reports `all-expired`
  rather than `none-for-region` — a stale feed and a quiet region are different
  findings, and only the first one went unnoticed for a week. An entry with no
  expiry is kept, the same reasoning as one with no area.
- **The same rule runs again in the browser, because a payload outlives its
  fetch.** `activeWarnings()` in `weather-format.ts` re-applies it against a
  once-a-minute clock, so a dashboard left open on a phone does not still show
  a warning that ended an hour ago. The clock is a `useSyncExternalStore`
  singleton with a **server snapshot of `0`, which filters nothing** — the
  server cannot know what time it will be at hydration, and a mismatch here
  would land on the one element of the page that must not flicker.
- **MeteoAlarm severity is one level lower than it reads.** Its awareness
  levels are 2 yellow, 3 amber, 4 red, published as `Moderate`, `Severe` and
  `Extreme`; mapping Severe → red and Moderate → amber put the words "Amber
  warning" directly above "Yellow thunderstorm warning" on the same card. It is
  Extreme → red, Severe → amber, Moderate/Minor → yellow, and the
  `awareness_level` parameter — "2; yellow; Moderate" — is preferred over
  `severity` where the entry carries it, because it names the colour outright.
- **The colour is not always the word before "warning".** The RSS says "Yellow
  warning of rain affecting Wales" but CAP events read "Yellow thunderstorm
  warning affecting …", so `levelFrom()` matching the literal string
  `yellow warning` silently found the first and missed the second. It allows
  words in between now, but still requires "warning" nearby — a colour in prose
  must not set a level.
- **`capReason` says why CAP lost, because `via` alone cannot.** An empty feed
  and an unreachable one both fell back to the RSS and both reported
  `via: "nswws-rss"`, so a wrong URL would have looked exactly like a quiet day
  and could have gone unnoticed indefinitely. The reason separates `ok` /
  `http-<status>` / `network` / `timeout` / `not-xml` / `no-entries` /
  `none-for-region`. **A status and a connection failure are not the same
  finding** — a 404 means the feed moved and the URL is fixable, a `network`
  means egress is blocked and no URL will help — so they are reported
  separately rather than flattened into one "unreachable", which is exactly the
  mistake the `via` field made one level up.
- **MeteoAlarm needs a permissive `Accept`, and 406 was how it said so.**
  Production reported `http-406` — Not Acceptable — against
  `application/atom+xml, application/xml, text/xml`. That status is
  unambiguous: the URL exists and egress works, and content negotiation was
  what refused us, not the address. Sending `Accept: */*` is the fix, and it
  costs nothing because the body is sniffed for feed markup regardless — a
  wrong content type still fails as `not-xml`. **Do not narrow this header
  again**; had the reason still read `unreachable`, the natural next move would
  have been to go hunting for a new URL that was never wrong.
- **Report every candidate's outcome, not just the last.** The first version of
  the loop overwrote `reason` each pass, so a run reporting `http-406` gave no
  way to tell whether the other feeds agreed or failed differently — the exact
  mistake `capReason` exists to prevent, repeated one level further in. The
  reasons are joined (`"http-406; http-404; network"`) when all candidates fail.
- **`METEOALARM_FEEDS` is an ordered candidate list, first that answers wins**,
  the same reasoning as `MODELS` and `ENSEMBLES`: production reported the single
  hard-coded URL unreachable and no build environment here can reach MeteoAlarm
  to tell a renamed feed from a blocked one. Guessing a replacement would only
  swap one unverified URL for another. `capFeed` reports which one answered —
  **keep that one and delete any entry permanently reported `http-404`.**
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
- **The tide fetch asks the nearest four gauges concurrently, and must.**
  Mumbles (E72924) came back with no rows for thirteen hours while six other
  gauges sat unqueried, so a silent gauge is a reason to ask another rather than
  to blank the card. The first attempt walked them *sequentially* under a budget
  and production reported `6 in range, tried 1` — because at ~1.9 s a request one
  gauge costs three round trips including the station lookup, so a second could
  never fit under Netlify's 10 s ceiling. **No budget arithmetic fixes an
  ordering that cannot fit**; a stub at that latency reproduces the exact live
  message, and is the regression test. This is **not** the fallback chain that
  caused the throttling: that retried several URL *shapes* against one station
  in sequence, where this makes the one proven request against four distinct
  stations — the same shape `getRiverStations` has run in production throughout.
  The fan-out is bounded to keep it that way.
- **Concurrency must not change which gauge wins.** The candidates are in
  distance order and the winner is the first usable *attempt*, not the first
  reply — otherwise the nearest gauge would quietly lose to whichever responded
  fastest.
- **Station geography is not a reading, and must not share its TTL.** The tide
  gauge listing was cached for ten minutes behind a 4 s cap, so a slow day at the
  Environment Agency timed the lookup out at 4,002 ms having asked no gauge at
  all — the concurrency fix underneath it never got a chance to run. Which
  gauges exist near a point changes when the EA commissions a station, so it is
  cached for a day (`TTL.stations`) and given a budget that reflects being the
  gate for everything after it.
- **`left()` reports the real remaining budget, including zero.** It used to be
  floored at 1,500 ms, which made the "is there time for another gauge?" guard
  self-defeating: the guard needed more than 1,500 ms, and the floor guaranteed
  it never saw less. A budget that cannot report being empty is worse than no
  budget. `spend()` is where the per-request floor belongs.
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
