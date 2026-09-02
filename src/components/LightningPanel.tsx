"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Card, Chip, EmptyState, Metric, Notice, SectionBody } from "./ui";
import { CloudLightningIcon } from "./icons";
import { useLightningFeed, type FeedStatus } from "./useLightningFeed";
import { useNowSeconds } from "./useClock";
import { clockAt, formatWeekday, isNum } from "@/lib/weather-format";
import { TILE_SIZE, pointToTile, tileGrid } from "@/lib/tiles";
import {
  HOTSPOT_WINDOW_MS,
  LIVE_WINDOW_MS,
  RINGS_KM,
  ageLabel,
  bearingDeg,
  compassPoint,
  haversineKm,
  hotspots,
  metresPerPixel,
  shouldAlarm,
  summariseStrikes,
  threatLabel,
  threatLevel,
  thunderDelaySeconds,
  type HotspotCell,
  type Strike,
  type ThreatLevel,
} from "@/lib/lightning";
import type { RadarIndex } from "@/lib/rainviewer";
import type { UnitSystem, WeatherOverview } from "@/lib/weather-types";

/**
 * The Lightning tab — a free stand-in for the paid strike-tracker apps.
 *
 * Three views, the way those apps lay it out: **Latest** plots the last hour
 * of strikes on a map with distance rings; **Hotspots** grids the last day of
 * them to show where the storms have been; **Radar** puts the same strikes
 * over the RainViewer composite the Now tab already fetches, because a cell
 * that is raining hard and throwing lightning is the one to watch. Under the
 * map: the nearest and latest strikes, an alarm with a radius, and the Met
 * Office's own chance of lightning for the days ahead — which is the answer
 * on the many days when the live feed, correctly, shows nothing.
 *
 * The data is Blitzortung's community network, over a WebSocket straight
 * from the browser. Nothing here costs an access or a key. See
 * `lib/lightning.ts` for what is assumed about the protocol and why the raw
 * counters are on the page.
 */

type View = "latest" | "hotspots" | "radar";
const VIEWS: { id: View; label: string }[] = [
  { id: "latest", label: "Latest" },
  { id: "hotspots", label: "Hotspots" },
  { id: "radar", label: "Radar" },
];

/** Roughly county, region and country at this latitude — matches the radar card. */
const ZOOMS = [
  { z: 9, label: "Near" },
  { z: 7, label: "Region" },
  { z: 6, label: "Wide" },
] as const;
const VIEWPORT_HEIGHT = 360;
const HOTSPOT_CELL_KM = 5;

interface AlarmSettings {
  radiusKm: number;
  sound: boolean;
  notify: boolean;
  vibrate: boolean;
}
const ALARM_KEY = "wx:lightning:alarm";
const ALARM_DEFAULT: AlarmSettings = { radiusKm: 25, sound: false, notify: false, vibrate: true };
const ALARM_RADII = [10, 25, 50, 100];

export function LightningPanel({
  overview,
  units,
  hour12,
}: {
  overview: WeatherOverview;
  units: UnitSystem;
  hour12: boolean;
}) {
  const place = overview.place;
  const offsetMinutes = place.tzoffset !== null ? place.tzoffset / 60 : null;
  const { strikes, status, stats, fresh } = useLightningFeed(place.lat, place.lon);

  /*
   * A one-second clock. `useNow()` ticks once a minute, which is right for
   * warnings and wrong for "12 s ago". It reads 0 until the browser takes
   * over, and every relative phrase below is withheld until then — the same
   * rule the rest of the page follows.
   */
  const now = useNowSeconds();

  const [view, setView] = useState<View>("latest");
  const [zoom, setZoom] = useState<number>(ZOOMS[1].z);

  const summary = useMemo(
    () => (now ? summariseStrikes(strikes, now) : null),
    [strikes, now]
  );
  const level: ThreatLevel = now ? threatLevel(strikes, now) : "none";
  const live = useMemo(
    () => (now ? strikes.filter((s) => now - s.time <= LIVE_WINDOW_MS) : []),
    [strikes, now]
  );
  const cells = useMemo(
    () =>
      view === "hotspots" && now
        ? hotspots(strikes, place.lat, place.lon, now, HOTSPOT_CELL_KM)
        : [],
    [view, strikes, place.lat, place.lon, now]
  );
  const recent = useMemo(
    () => [...live].sort((a, b) => b.time - a.time).slice(0, 12),
    [live]
  );

  /* Radar index, fetched only when the Radar view is opened. */
  const [radar, setRadar] = useState<RadarIndex | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  useEffect(() => {
    if (view !== "radar" || radar || radarError) return;
    let cancelled = false;
    fetch("/api/radar")
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setRadarError(typeof body?.error === "string" ? body.error : "Radar unavailable.");
          return;
        }
        setRadar(body as RadarIndex);
      })
      .catch(() => {
        if (!cancelled) setRadarError("Could not reach the radar service.");
      });
    return () => {
      cancelled = true;
    };
  }, [view, radar, radarError]);

  /* ---------------- Alarm ---------------- */
  const [alarm, updateAlarm] = useAlarmSettings();
  const permission = useNotificationPermission();
  const [lastAlarm, setLastAlarm] = useState<Strike | null>(null);
  const lastAlarmAt = useRef(0);
  const audio = useRef<AudioContext | null>(null);

  /*
   * The audio context has to be created inside a user gesture or the browser
   * mutes it, so it is made when the sound toggle is switched on — not when
   * the first strike lands, by which point it is too late to ask.
   */
  const ensureAudio = useCallback((): AudioContext | null => {
    if (audio.current) return audio.current;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio.current = new Ctor();
    return audio.current;
  }, []);

  const ring = useCallback(
    (strike: Strike | null, test = false) => {
      if (alarm.sound) {
        const ctx = ensureAudio();
        if (ctx) {
          if (ctx.state === "suspended") ctx.resume().catch(() => {});
          chime(ctx);
        }
      }
      if (alarm.vibrate && "vibrate" in navigator) {
        try {
          navigator.vibrate([200, 100, 200]);
        } catch {
          /* not allowed here */
        }
      }
      if (alarm.notify && "Notification" in window && Notification.permission === "granted") {
        const where = strike
          ? `${distanceLabel(strike.distanceKm, units)} ${compassPoint(strike.bearing)} of ${place.name}`
          : `within ${distanceLabel(alarm.radiusKm, units)} of ${place.name}`;
        try {
          new Notification(test ? "Lightning alarm test" : "Lightning nearby", {
            body: test ? `This is what a strike ${where} will look like.` : `Strike ${where}.`,
            tag: "wx-lightning",
          });
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }
    },
    [alarm, ensureAudio, place.name, units]
  );

  useEffect(() => {
    if (fresh.length === 0) return;
    const at = Date.now();
    const nearest = [...fresh].sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (shouldAlarm(nearest, alarm.radiusKm, lastAlarmAt.current, at)) {
      lastAlarmAt.current = at;
      setLastAlarm(nearest);
      ring(nearest);
    }
  }, [fresh, alarm.radiusKm, ring]);

  const requestNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") updateAlarm({ notify: true });
    } catch {
      /* the store re-reads the permission either way */
    }
    permissionStore.changed();
  }, [updateAlarm]);

  /* ---------------- Share ---------------- */
  const [shared, setShared] = useState<string | null>(null);
  const share = useCallback(
    async (strike: Strike) => {
      const url = `${window.location.origin}/?p=${encodeURIComponent(
        `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`
      )}&tab=lightning`;
      const text = `Lightning ${distanceLabel(strike.distanceKm, units)} ${compassPoint(
        strike.bearing
      )} of ${place.name} at ${clockAt(new Date(strike.time), offsetMinutes, hour12)}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: "Lightning nearby", text, url });
          setShared("Shared.");
        } else {
          await navigator.clipboard.writeText(`${text} — ${url}`);
          setShared("Copied to the clipboard.");
        }
      } catch {
        setShared(null);
      }
    },
    [place, units, hour12, offsetMinutes]
  );
  useEffect(() => {
    if (!shared) return;
    const timer = setTimeout(() => setShared(null), 3000);
    return () => clearTimeout(timer);
  }, [shared]);

  const threat = threatLabel(level);
  const nearest = summary?.nearest ?? null;

  return (
    <div className="space-y-4">
      {/* ---------------- Headline ---------------- */}
      <Card
        className={`wx-threat wx-threat-${level}`}
        source="Blitzortung.org contributors — a community detection network, for private use"
        action={<FeedChip status={status} perMinute={stats.worldPerMinute} live={stats.lastMessageAt > 0} />}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="wx-threat-icon">
            <CloudLightningIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="wx-display text-xl font-semibold leading-tight sm:text-2xl">
              {now ? threat.title : "Listening for lightning"}
            </h2>
            <p className="wx-muted mt-1 text-sm leading-relaxed">
              {now ? threat.note : "Connecting to the detection network."}
            </p>
            {nearest && now ? (
              <p className="mt-2 text-sm">
                Nearest in the last hour:{" "}
                <strong className="wx-num">{distanceLabel(nearest.distanceKm, units)}</strong>{" "}
                {compassPoint(nearest.bearing)}, {ageLabel(nearest.time, now)}.
                {nearest.distanceKm <= 30 && (
                  <>
                    {" "}
                    Thunder from it takes about{" "}
                    <strong className="wx-num">{thunderDelaySeconds(nearest.distanceKm)} s</strong>{" "}
                    to arrive.
                  </>
                )}
              </p>
            ) : null}
          </div>
        </div>

        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Last 5 min" value={<span className="wx-num">{summary.last5}</span>} hint={`within ${distanceLabel(250, units)}`} />
            <Metric label="Last 15 min" value={<span className="wx-num">{summary.last15}</span>} hint={`within ${distanceLabel(250, units)}`} />
            <Metric label="Last hour" value={<span className="wx-num">{summary.last60}</span>} hint={`within ${distanceLabel(250, units)}`} />
            <Metric
              label={`Within ${distanceLabel(RINGS_KM[2], units)}`}
              value={<span className="wx-num">{summary.withinRings[2]}</span>}
              hint="last hour"
              accent={summary.withinRings[2] > 0 ? "var(--wx-danger)" : undefined}
            />
          </div>
        )}

        {lastAlarm && now && now - lastAlarm.time < 15 * 60_000 && (
          <div className="mt-3">
            <Notice tone="danger">
              Alarm: strike {distanceLabel(lastAlarm.distanceKm, units)}{" "}
              {compassPoint(lastAlarm.bearing)} of {place.name}, {ageLabel(lastAlarm.time, now)}.
            </Notice>
          </div>
        )}

        {status === "live" && stats.messages > 20 && stats.decoded === 0 && (
          <div className="mt-3">
            <Notice tone="warn">
              The feed is connected and sending, but nothing decodes as a strike. The message
              shape has probably changed — see the feed details at the bottom of this tab.
            </Notice>
          </div>
        )}
        {status === "offline" && (
          <div className="mt-3">
            <Notice tone="warn">
              Could not connect to any Blitzortung server. The map below shows what this
              page saw earlier, if anything.
            </Notice>
          </div>
        )}
      </Card>

      {/* ---------------- Map ---------------- */}
      <Card
        title="Strike map"
        subtitle={
          view === "latest"
            ? `Last hour, centred on ${place.name}. Brighter is newer.`
            : view === "hotspots"
              ? `Last 24 hours on a ${HOTSPOT_CELL_KM} km grid. Darker is busier.`
              : "Last hour of strikes over the latest observed radar frame."
        }
        source={
          view === "radar"
            ? "Blitzortung.org · RainViewer · base map © OpenStreetMap contributors"
            : "Blitzortung.org · base map © OpenStreetMap contributors"
        }
        action={
          <div className="flex items-center gap-1">
            {ZOOMS.map((option) => (
              <button
                key={option.z}
                type="button"
                className={`wx-btn px-2 py-1 text-xs ${zoom === option.z ? "wx-btn-active" : ""}`}
                onClick={() => setZoom(option.z)}
                aria-pressed={zoom === option.z}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="space-y-3">
          <div className="wx-seg" role="tablist" aria-label="Lightning views">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={view === option.id}
                className={`wx-seg-btn ${view === option.id ? "is-active" : ""}`}
                onClick={() => setView(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {view === "radar" && radarError && <Notice tone="warn">{radarError}</Notice>}

          <LightningMap
            lat={place.lat}
            lon={place.lon}
            zoom={zoom}
            now={now}
            strikes={view === "hotspots" ? strikes : live}
            cells={cells}
            radar={view === "radar" ? radar : null}
            hotspotMode={view === "hotspots"}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Legend colour="#ffffff" label="under 2 min" />
            <Legend colour="#ffe14d" label="2–10 min" />
            <Legend colour="#ff9f1c" label="10–30 min" />
            <Legend colour="#e63946" label="30–60 min" />
            {view === "hotspots" && <Legend colour="#8b1e2d" label="older, up to 24 h" />}
            <span className="wx-dim">
              Rings at {RINGS_KM.map((km) => distanceLabel(km, units, 0)).join(", ")}
            </span>
          </div>

          {view === "hotspots" && now && (
            <HotspotList cells={cells} lat={place.lat} lon={place.lon} units={units} />
          )}
        </div>
      </Card>

      {/* ---------------- Recent strikes ---------------- */}
      <Card
        title="Latest strikes"
        subtitle={`The most recent within ${distanceLabel(250, units)}, newest first`}
        source="Blitzortung.org contributors"
        action={
          nearest && (
            <button type="button" className="wx-btn px-3 py-1 text-xs" onClick={() => share(nearest)}>
              {shared ?? "Share nearest"}
            </button>
          )
        }
      >
        {!now ? null : recent.length === 0 ? (
          <EmptyState
            art={<CloudLightningIcon />}
            title="No strikes in the last hour"
            note={
              status === "live"
                ? stats.worldPerMinute > 0
                  ? `The network is live — ${stats.worldPerMinute} strikes a minute worldwide — and none of them are near you.`
                  : "The network is live. Nothing has landed nearby."
                : "Waiting for the network."
            }
          />
        ) : (
          <ul className="divide-y divide-[color:var(--wx-border)]">
            {recent.map((s) => (
              <li key={`${s.time}-${s.lat}-${s.lon}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="wx-strike-swatch" style={{ background: strikeColour(now - s.time) }} aria-hidden />
                <span className="wx-num w-16 shrink-0">{clockAt(new Date(s.time), offsetMinutes, hour12)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="wx-num">{distanceLabel(s.distanceKm, units)}</strong>{" "}
                  <span className="wx-muted">{compassPoint(s.bearing)}</span>
                  {s.stations !== null && (
                    <span className="wx-dim"> · {s.stations} stations</span>
                  )}
                </span>
                <span className="wx-dim shrink-0 text-xs">{ageLabel(s.time, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- Alarm ---------------- */}
      <Card
        title="Lightning alarm"
        subtitle="Rings once per storm when a strike lands inside the radius, while this tab is open"
      >
        <div className="space-y-3">
          <div className="wx-seg-row">
            <span className="wx-seg-label">Alarm radius</span>
            <div className="wx-seg" role="group" aria-label="Alarm radius">
              {ALARM_RADII.map((km) => (
                <button
                  key={km}
                  type="button"
                  className={`wx-seg-btn ${alarm.radiusKm === km ? "is-active" : ""}`}
                  aria-pressed={alarm.radiusKm === km}
                  onClick={() => updateAlarm({ radiusKm: km })}
                >
                  {distanceLabel(km, units, 0)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle
              label="Sound"
              hint="Two-tone chime"
              checked={alarm.sound}
              onChange={(on) => {
                if (on) ensureAudio()?.resume().catch(() => {});
                updateAlarm({ sound: on });
              }}
            />
            <Toggle
              label="Vibrate"
              hint="Phones only"
              checked={alarm.vibrate}
              onChange={(on) => updateAlarm({ vibrate: on })}
            />
            <Toggle
              label="Notification"
              hint={
                permission === "unsupported"
                  ? "Not available in this browser"
                  : permission === "denied"
                    ? "Blocked in browser settings"
                    : permission === "granted"
                      ? "Allowed"
                      : "Asks for permission"
              }
              checked={alarm.notify && permission === "granted"}
              disabled={permission === "unsupported" || permission === "denied"}
              onChange={(on) => {
                if (!on) return updateAlarm({ notify: false });
                if (permission === "granted") return updateAlarm({ notify: true });
                void requestNotifications();
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="wx-btn text-sm" onClick={() => ring(null, true)}>
              Test the alarm
            </button>
            <p className="wx-dim text-xs">
              Runs in the page, not in the background. On a phone, add this site to the
              home screen and keep it open during a storm.
            </p>
          </div>
        </div>
      </Card>

      {/* ---------------- Forecast ---------------- */}
      <ThunderRiskCard overview={overview} hour12={hour12} />

      {/* ---------------- Diagnostics ---------------- */}
      <details className="wx-card p-4 text-sm sm:p-5">
        <summary className="cursor-pointer text-sm font-semibold tracking-wide uppercase">
          Feed details
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="wx-dim">Status</dt>
          <dd>{status}</dd>
          <dt className="wx-dim">Server</dt>
          <dd className="truncate">{stats.host ?? "—"}</dd>
          <dt className="wx-dim">Attempts</dt>
          <dd className="wx-num">{stats.attempts}</dd>
          <dt className="wx-dim">Messages</dt>
          <dd className="wx-num">{stats.messages}</dd>
          <dt className="wx-dim">Decoded strikes</dt>
          <dd className="wx-num">{stats.decoded}</dd>
          <dt className="wx-dim">Undecodable</dt>
          <dd className="wx-num">{stats.undecodable}</dd>
          <dt className="wx-dim">Kept nearby</dt>
          <dd className="wx-num">{stats.kept}</dd>
          <dt className="wx-dim">Last message</dt>
          <dd>{stats.lastMessageAt && now ? ageLabel(stats.lastMessageAt, now) : "none yet"}</dd>
          <dt className="wx-dim">Stored</dt>
          <dd className="wx-num">{strikes.length} strikes, up to {HOTSPOT_WINDOW_MS / 3_600_000} h</dd>
        </dl>
        <p className="wx-dim mt-3 text-xs leading-relaxed">
          Messages arriving with no decoded strikes means the network changed its message
          format, not that the sky is quiet. Zero messages on a live socket for long enough
          moves to the next server automatically.
        </p>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stored settings                                                     */
/* ------------------------------------------------------------------ */

/*
 * Alarm settings and notification permission both live outside React — in
 * localStorage and on `Notification` — so they are read through
 * `useSyncExternalStore` with a server snapshot of the defaults. That is what
 * keeps the first paint identical on both sides: the server renders the
 * defaults, the browser hydrates against them, then re-renders with the
 * stored values. Reading storage in an effect does the same job with a
 * cascading render; reading it in a lazy initialiser is a hydration mismatch.
 */
const alarmStore = {
  listeners: new Set<() => void>(),
  cache: { raw: null as string | null, value: ALARM_DEFAULT },
  subscribe(listener: () => void) {
    alarmStore.listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === ALARM_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      alarmStore.listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  /* Same raw string, same object — the store must return a stable reference. */
  read(): AlarmSettings {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(ALARM_KEY);
    } catch {
      raw = null;
    }
    if (raw === alarmStore.cache.raw) return alarmStore.cache.value;
    let value = ALARM_DEFAULT;
    if (raw) {
      try {
        value = { ...ALARM_DEFAULT, ...(JSON.parse(raw) as Partial<AlarmSettings>) };
      } catch {
        value = ALARM_DEFAULT;
      }
    }
    alarmStore.cache = { raw, value };
    return value;
  },
  write(patch: Partial<AlarmSettings>) {
    const next = { ...alarmStore.read(), ...patch };
    try {
      localStorage.setItem(ALARM_KEY, JSON.stringify(next));
    } catch {
      /* keep it for this page at least */
      alarmStore.cache = { raw: alarmStore.cache.raw, value: next };
    }
    for (const l of alarmStore.listeners) l();
  },
};

function useAlarmSettings(): [AlarmSettings, (patch: Partial<AlarmSettings>) => void] {
  const settings = useSyncExternalStore(alarmStore.subscribe, alarmStore.read, () => ALARM_DEFAULT);
  return [settings, alarmStore.write];
}

type Permission = NotificationPermission | "unsupported";
const permissionStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    permissionStore.listeners.add(listener);
    return () => {
      permissionStore.listeners.delete(listener);
    };
  },
  read(): Permission {
    return "Notification" in window ? Notification.permission : "unsupported";
  },
  /* Called after `requestPermission` resolves; the browser fires no event. */
  changed() {
    for (const l of permissionStore.listeners) l();
  },
};

function useNotificationPermission(): Permission {
  return useSyncExternalStore(permissionStore.subscribe, permissionStore.read, () => "default");
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

function LightningMap({
  lat,
  lon,
  zoom,
  now,
  strikes,
  cells,
  radar,
  hotspotMode,
}: {
  lat: number;
  lon: number;
  zoom: number;
  now: number;
  strikes: readonly Strike[];
  cells: HotspotCell[];
  radar: RadarIndex | null;
  hotspotMode: boolean;
}) {
  /*
   * Same rule as the radar card: the grid depends on the measured width, so
   * the map renders only after mount. A guessed width on the server and a
   * real one in the browser would mismatch on every tile.
   */
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo(
    () => (width > 0 ? tileGrid(lat, lon, zoom, width, VIEWPORT_HEIGHT) : []),
    [lat, lon, zoom, width]
  );
  const centre = useMemo(() => pointToTile(lat, lon, zoom), [lat, lon, zoom]);
  const mpp = metresPerPixel(lat, zoom);
  const cellPx = (HOTSPOT_CELL_KM * 1000) / mpp;

  const toPx = (sLat: number, sLon: number) => {
    const t = pointToTile(sLat, sLon, zoom);
    return {
      x: width / 2 + (t.x - centre.x) * TILE_SIZE,
      y: VIEWPORT_HEIGHT / 2 + (t.y - centre.y) * TILE_SIZE,
    };
  };

  const frame = radar ? radar.frames[radar.nowIndex] : null;

  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded-lg"
      /*
       * Dark by design, whatever the theme: the tiles are dimmed to read under
       * bright dots, and if a tile fails to load the rings and strikes must
       * still read against something — white on the light inset was invisible.
       */
      style={{ height: `${VIEWPORT_HEIGHT}px`, background: "#1b2130" }}
    >
      {tiles.length > 0 && (
        <>
          {tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`base-${tile.z}-${tile.x}-${tile.y}`}
              src={`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`}
              alt=""
              aria-hidden
              width={TILE_SIZE}
              height={TILE_SIZE}
              loading="lazy"
              className="pointer-events-none absolute select-none"
              style={{
                left: `${tile.left}px`,
                top: `${tile.top}px`,
                filter: "grayscale(1) brightness(0.55) contrast(0.9)",
              }}
            />
          ))}

          {frame &&
            radar &&
            tiles.map((tile) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`radar-${frame.time}-${tile.z}-${tile.x}-${tile.y}`}
                src={`${radar.host}${frame.path}/${TILE_SIZE}/${tile.z}/${tile.x}/${tile.y}/4/1_1.png`}
                alt=""
                aria-hidden
                width={TILE_SIZE}
                height={TILE_SIZE}
                className="pointer-events-none absolute select-none"
                style={{ left: `${tile.left}px`, top: `${tile.top}px`, opacity: 0.75 }}
              />
            ))}

          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={VIEWPORT_HEIGHT}
            viewBox={`0 0 ${width} ${VIEWPORT_HEIGHT}`}
            aria-hidden
          >
            {/* Hotspot cells first, under everything. */}
            {cells.map((cell) => {
              const p = toPx(cell.lat, cell.lon);
              return (
                <rect
                  key={`${cell.lat}-${cell.lon}`}
                  x={p.x - cellPx / 2}
                  y={p.y - cellPx / 2}
                  width={cellPx}
                  height={cellPx}
                  fill="#e63946"
                  fillOpacity={0.15 + 0.65 * cell.weight}
                  stroke="#ffb3ba"
                  strokeOpacity={0.35}
                />
              );
            })}

            {/* Distance rings, labelled at the top of each. */}
            {RINGS_KM.map((km) => {
              const r = (km * 1000) / mpp;
              if (r < 12 || r > Math.max(width, VIEWPORT_HEIGHT)) return null;
              return (
                <g key={km}>
                  <circle
                    cx={width / 2}
                    cy={VIEWPORT_HEIGHT / 2}
                    r={r}
                    fill="none"
                    stroke="rgba(255,255,255,0.45)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={width / 2 + 4}
                    y={VIEWPORT_HEIGHT / 2 - r - 3}
                    fontSize="10"
                    fill="rgba(255,255,255,0.7)"
                  >
                    {km} km
                  </text>
                </g>
              );
            })}

            {/* Strikes, oldest first so the newest draw on top. */}
            {now > 0 &&
              strikes.map((s) => {
                const p = toPx(s.lat, s.lon);
                if (p.x < -10 || p.y < -10 || p.x > width + 10 || p.y > VIEWPORT_HEIGHT + 10) return null;
                const age = now - s.time;
                const fresh = age < 2 * 60_000;
                const old = age > LIVE_WINDOW_MS;
                return (
                  <circle
                    key={`${s.time}-${s.lat}-${s.lon}`}
                    cx={p.x}
                    cy={p.y}
                    r={old ? 2 : fresh ? 5 : hotspotMode ? 2.5 : 3.5}
                    fill={strikeColour(age)}
                    stroke={fresh ? "#ffe14d" : "rgba(0,0,0,0.6)"}
                    strokeWidth={fresh ? 2 : 1}
                    opacity={old ? 0.55 : 1}
                    className={fresh ? "wx-strike-new" : undefined}
                  />
                );
              })}
          </svg>

          <div
            className="pointer-events-none absolute"
            style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
            aria-hidden
          >
            <div className="wx-radar-pin" />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function FeedChip({
  status,
  perMinute,
  live,
}: {
  status: FeedStatus;
  perMinute: number;
  live: boolean;
}) {
  if (status === "live") {
    return (
      <Chip tone="good" title="Connected to the Blitzortung network">
        <span className="wx-live-dot" aria-hidden />
        Live{live && perMinute > 0 ? ` · ${perMinute}/min worldwide` : ""}
      </Chip>
    );
  }
  if (status === "offline") return <Chip tone="danger">Feed offline</Chip>;
  if (status === "reconnecting") return <Chip tone="warn">Reconnecting…</Chip>;
  return <Chip>Connecting…</Chip>;
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="wx-strike-swatch" style={{ background: colour }} aria-hidden />
      <span className="wx-muted">{label}</span>
    </span>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={`wx-inset flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 ${disabled ? "opacity-60" : ""}`}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="wx-dim block text-xs">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function HotspotList({
  cells,
  lat,
  lon,
  units,
}: {
  cells: HotspotCell[];
  lat: number;
  lon: number;
  units: UnitSystem;
}) {
  if (cells.length === 0) {
    return (
      <p className="wx-muted text-sm">
        No strikes stored for the last 24 hours. Hotspots build up while this page is open
        and are kept between visits.
      </p>
    );
  }
  const top = cells.slice(0, 5);
  return (
    <ol className="grid gap-1 text-sm sm:grid-cols-5">
      {top.map((cell, i) => {
        const d = haversineFromPlace(lat, lon, cell.lat, cell.lon);
        return (
          <li key={`${cell.lat}-${cell.lon}`} className="wx-inset px-3 py-2">
            <span className="wx-dim text-xs">#{i + 1}</span>{" "}
            <strong className="wx-num">{cell.count}</strong>{" "}
            <span className="wx-muted text-xs">
              strikes · {distanceLabel(d.km, units)} {d.point}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ThunderRiskCard({ overview, hour12 }: { overview: WeatherOverview; hour12: boolean }) {
  const offsetMinutes = overview.place.tzoffset !== null ? overview.place.tzoffset / 60 : null;
  return (
    <Card
      title="Chance of lightning"
      subtitle="The Met Office's probability of a strike within 50 km — the forecast, where the map is the observation"
      source="Met Office DataHub"
    >
      <div className="space-y-4">
        <SectionBody section={overview.sections.metofficeThreeHourly} empty="No three-hourly forecast for this location.">
          {(data) => {
            const steps = data.steps.filter((s) => isNum(s.sferics)).slice(0, 16);
            if (steps.length === 0) {
              return <p className="wx-muted text-sm">This forecast did not carry a lightning probability.</p>;
            }
            const peak = Math.max(...steps.map((s) => s.sferics ?? 0));
            return (
              <div>
                <p className="wx-muted mb-2 text-xs">
                  Next 48 hours, three-hour steps.{" "}
                  {peak >= 40
                    ? "Thunderstorms are likely at some point."
                    : peak >= 15
                      ? "A chance of thunder at some point."
                      : "Thunder is unlikely."}
                </p>
                <div className="wx-scroll -mx-1 px-1 pb-1">
                  <div className="flex min-w-[32rem] items-end gap-1" style={{ height: 72 }}>
                    {steps.map((s) => {
                      const v = s.sferics ?? 0;
                      return (
                        <div key={s.timeISO} className="flex flex-1 flex-col items-center justify-end gap-1 self-stretch">
                          <span className="wx-dim text-[10px]">{v}%</span>
                          <div
                            className="w-full rounded-t"
                            style={{
                              height: `${Math.max(2, v)}%`,
                              background: v >= 40 ? "var(--wx-danger)" : v >= 15 ? "var(--wx-warn)" : "var(--wx-accent)",
                            }}
                            role="img"
                            aria-label={`${v}% at ${clockAt(new Date(s.timeISO), offsetMinutes, hour12)}`}
                          />
                          <span className="wx-dim text-[10px]">
                            {clockAt(new Date(s.timeISO), offsetMinutes, hour12).replace(/:00| /g, "")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          }}
        </SectionBody>

        <SectionBody section={overview.sections.metofficeDaily} empty="No daily forecast for this location.">
          {(data) => {
            const days = data.days.filter((d) => isNum(d.day.sferics) || isNum(d.night.sferics));
            if (days.length === 0) return null;
            return (
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-7">
                {days.map((d) => {
                  const day = d.day.sferics;
                  const night = d.night.sferics;
                  const worst = Math.max(day ?? 0, night ?? 0);
                  return (
                    <div key={d.timeISO} className="wx-inset px-2 py-2 text-center">
                      <div className="wx-dim text-[11px]">{formatWeekday(d.timeISO)}</div>
                      <div
                        className="wx-num text-base font-semibold"
                        style={{ color: worst >= 40 ? "var(--wx-danger)" : worst >= 15 ? "var(--wx-warn)" : undefined }}
                      >
                        {worst}%
                      </div>
                      <div className="wx-dim text-[10px]">
                        day {isNum(day) ? `${day}%` : "—"} · night {isNum(night) ? `${night}%` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }}
        </SectionBody>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Age → colour. White is "just now"; the ramp runs through yellow to red over the hour. */
export function strikeColour(ageMs: number): string {
  const min = ageMs / 60_000;
  if (min < 2) return "#ffffff";
  if (min < 10) return "#ffe14d";
  if (min < 30) return "#ff9f1c";
  if (min <= 60) return "#e63946";
  return "#8b1e2d";
}

function distanceLabel(km: number, units: UnitSystem, digits?: number): string {
  const value = units === "imperial" ? km * 0.621371 : km;
  const unit = units === "imperial" ? "mi" : "km";
  const d = digits ?? (value < 10 ? 1 : 0);
  return `${value.toFixed(d)} ${unit}`;
}

function haversineFromPlace(lat: number, lon: number, toLat: number, toLon: number) {
  return {
    km: haversineKm(lat, lon, toLat, toLon),
    point: compassPoint(bearingDeg(lat, lon, toLat, toLon)),
  };
}

/** Two rising tones, half a second in all. Loud enough to notice, short enough not to annoy. */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [offset, freq] of [
    [0, 880],
    [0.22, 1318],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.45);
  }
}
