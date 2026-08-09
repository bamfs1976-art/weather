"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip, Notice } from "./ui";
import { PauseIcon, PlayIcon } from "./icons";
import type { ResolvedPlace, ThemeName } from "@/lib/weather-types";
/*
 * The weather layers split into two kinds, and conflating them was a bug:
 *
 *  - A "view" is an opaque, full-coverage raster (radar, satellite, a
 *    temperature field). Stacking two of these just hides the lower one, so
 *    only one can be active at a time. Previously every layer button added to
 *    a single list, so clicking Satellite then Temperature buried the map
 *    under opaque sheets and made zoom look broken too.
 *  - An "overlay" is sparse — alerts, storm cells, strikes — and several can
 *    sensibly sit on top of a view at once.
 *
 * The tokens themselves live in lib/map-layers.ts, read back from Xweather's
 * own URL builder rather than guessed. Guessing them here is what repeatedly
 * broke the map: a single rejected name fails the whole image.
 */
import { WEATHER_OVERLAYS as OVERLAYS, WEATHER_VIEWS as VIEWS } from "@/lib/map-layers";

/**
 * Short commit ref of the build serving this bundle, injected by netlify.toml.
 * It is the quickest way to tell a genuine fault from a phone still running an
 * old cached bundle — a distinction that cost several rounds of blind fixes.
 */
const BUILD_REF = (process.env.NEXT_PUBLIC_BUILD_REF ?? "").slice(0, 7);

const NOW_INDEX = 4;

const OFFSETS = [
  { id: "-60minutes", label: "-60m" },
  { id: "-45minutes", label: "-45m" },
  { id: "-30minutes", label: "-30m" },
  { id: "-15minutes", label: "-15m" },
  { id: "current", label: "Now" },
  { id: "+30minutes", label: "+30m" },
  { id: "+60minutes", label: "+60m" },
];

export function MapPanel({
  place,
  theme = "light",
}: {
  place: ResolvedPlace;
  theme?: ThemeName;
}) {
  const [view, setView] = useState<string>("radar-global");
  const [overlays, setOverlays] = useState<string[]>([]);
  const [zoom, setZoom] = useState(7);
  const [offsetIndex, setOffsetIndex] = useState(
    OFFSETS.findIndex((o) => o.id === "current")
  );
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /*
   * Everything known about one particular map URL, stored against that URL.
   * Keying it this way means a change of layers or zoom invalidates the old
   * verdict for free — there is no reset effect to forget, and a stale error
   * can never be shown over a fresh picture.
   */
  const [status, setStatus] = useState<{
    src: string;
    error?: string;
    /** Layers the server had to drop because the upstream refused them. */
    dropped?: string[];
    /**
     * What the picture on screen actually is, as opposed to what the controls
     * currently say. The two drift apart when a stale bundle is running or a
     * response is served from cache, and without this the only symptom is "the
     * map looks wrong", which is impossible to act on.
     */
    shown?: { layers: string; zoom: string };
  } | null>(null);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setOffsetIndex((index) => (index + 1) % OFFSETS.length);
    }, 1200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  /*
   * Base and label layers follow the app theme so the map does not sit as a
   * dark slab in the middle of a light page.
   *
   * Order is the draw order, and it matters: base, then the bathymetry mask
   * that shapes the coast, then the opaque view, then sparse overlays, and
   * place names last so they stay legible on top of everything.
   */
  const layerParam = useMemo(() => {
    const dark = theme === "dark";
    return [
      dark ? "flat-dk" : "flat",
      "water-depth",
      view,
      ...overlays,
      // Tropical tracks are unlabelled without their companion name layer.
      overlays.includes("tropical-cyclones") ? "tropical-cyclones-names" : "",
      "countries-outlines",
      dark ? "admin-cities-dk" : "admin-cities",
    ]
      .filter(Boolean)
      .join(",");
  }, [view, overlays, theme]);

  /*
   * Everything that varies goes in the path, not the query string. A cache in
   * front of this route was keying on the path alone and serving one image for
   * every set of layers and every zoom — the map appeared frozen in every
   * browser. Distinct paths cannot be collapsed that way.
   */
  const src = useMemo(() => {
    const parts = [
      encodeURIComponent(layerParam),
      String(zoom),
      `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`,
      OFFSETS[offsetIndex].id,
      "1000x620.png",
    ];
    return `/api/map/${parts.join("/")}`;
  }, [place.lat, place.lon, zoom, layerParam, offsetIndex]);

  // Only trust the stored verdict if it belongs to the URL now on screen.
  const current = status?.src === src ? status : null;
  const error = current?.error ?? null;
  const loading = current === null;
  const droppedLayers = current?.dropped ?? [];
  const shown = current?.shown ?? null;

  /*
   * The image is rendered by pointing <img> straight at the proxy URL, which is
   * the path every browser optimises and caches. An earlier version fetched the
   * bytes, wrapped them in a Blob and swapped object URLs by hand, purely so a
   * JSON error body could be read. That put the one thing that must always work
   * — showing a picture — behind blob lifetimes and manual revocation, and left
   * no way to tell a broken layer from a browser that had simply kept the old
   * object URL. Errors are rare, so pay for the detail only when one happens:
   * onError re-requests the same (already-cached) URL just to read the reason.
   */
  function handleLoad(loaded: string) {
    const zoomShown = String(zoom);
    setStatus({
      src: loaded,
      shown: { layers: layerParam, zoom: zoomShown },
    });
    /*
     * The response headers say which layers actually rendered, and <img> cannot
     * read headers. This repeat request is a cache hit (the route sends
     * max-age=120 for the identical URL), so it costs a header read, not an
     * image download.
     */
    fetch(loaded)
      .then((res) => {
        const used = res.headers.get("X-Map-Layers");
        const requested = res.headers.get("X-Map-Requested");
        if (!used || !requested) return;
        const kept = new Set(used.split(","));
        const dropped = requested.split(",").filter((l) => !kept.has(l));
        setStatus({
          src: loaded,
          dropped,
          shown: { layers: used, zoom: zoomShown },
        });
      })
      .catch(() => {
        /* the picture is already on screen; the chip is a nicety */
      });
  }

  function handleError(failed: string) {
    fetch(failed)
      .then(async (res) => {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = String(body.error);
        } catch {
          /* non-JSON error body — the status will have to do */
        }
        setStatus({ src: failed, error: detail });
      })
      .catch(() =>
        setStatus({ src: failed, error: "The map image could not be loaded." })
      );
  }

  function toggleOverlay(id: string) {
    setOverlays((current) =>
      current.includes(id)
        ? current.filter((layer) => layer !== id)
        : [...current, id]
    );
  }

  const activeView = VIEWS.find((v) => v.id === view);

  return (
    <div className="space-y-4">
      <Card
        title="Weather map"
        subtitle={`${activeView?.label ?? "Base map"} · centred on ${place.displayName}`}
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="wx-btn px-2 py-1 text-xs"
              onClick={() => setZoom((z) => Math.max(3, z - 1))}
              disabled={zoom <= 3}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="wx-muted w-14 text-center text-xs">zoom {zoom}</span>
            <button
              type="button"
              className="wx-btn px-2 py-1 text-xs"
              onClick={() => setZoom((z) => Math.min(12, z + 1))}
              disabled={zoom >= 12}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        }
      >
        <div className="relative overflow-hidden rounded-xl border border-[var(--wx-border)] bg-[var(--wx-inset)]">
          {!error ? (
            /*
             * key={src} forces a fresh element per URL. Without it a browser
             * that decides the swap is not worth a repaint can leave the old
             * picture up, which is indistinguishable from a broken map.
             */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={src}
              src={src}
              onLoad={() => handleLoad(src)}
              onError={() => handleError(src)}
              alt={`Weather map of ${place.displayName} showing ${
                activeView?.label ?? "base map"
              }${overlays.length ? ` with ${overlays.join(", ")}` : ""}`}
              className="block w-full"
              style={{ aspectRatio: "1000 / 620", objectFit: "cover" }}
            />
          ) : (
            <div style={{ aspectRatio: "1000 / 620" }} />
          )}

          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm">
              Loading map…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <Notice tone="warn">
                <span className="font-medium">Map unavailable.</span> {error}
                <span className="wx-dim mt-1 block font-mono text-[11px]">
                  layers: {layerParam}
                </span>
              </Notice>
            </div>
          )}
          <div className="pointer-events-none absolute right-2 top-2 flex flex-wrap justify-end gap-1">
            <Chip tone="accent">{OFFSETS[offsetIndex].label}</Chip>
            {droppedLayers.length > 0 && (
              <Chip tone="warn" title="Xweather would not render these layers, so they were dropped">
                not available: {droppedLayers.join(", ")}
              </Chip>
            )}
          </div>
        <div className="wx-map-controls">
          <button
            type="button"
            className="wx-map-play"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause animation" : "Play animation"}
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <div className="min-w-0 flex-1">
            <label htmlFor="wx-map-time" className="sr-only">
              Map time offset
            </label>
            <input
              id="wx-map-time"
              type="range"
              className="wx-slider"
              min={0}
              max={OFFSETS.length - 1}
              step={1}
              value={offsetIndex}
              onChange={(event) => {
                setPlaying(false);
                setOffsetIndex(Number(event.target.value));
              }}
              aria-valuetext={OFFSETS[offsetIndex].label}
            />
            <div className="wx-map-ticks" aria-hidden>
              {OFFSETS.map((offset, index) => (
                <span
                  key={offset.id}
                  className={index === NOW_INDEX ? "is-now" : undefined}
                >
                  {index === NOW_INDEX ? "Now" : ""}
                </span>
              ))}
            </div>
          </div>
          <span className="wx-map-time-label wx-num">{OFFSETS[offsetIndex].label}</span>
        </div>
        </div>

        {/*
          A caption describing the image actually on screen. If this disagrees
          with the buttons above it, the page is running stale code or serving a
          cached response — which is otherwise indistinguishable from a bug in
          the map itself.
        */}
        <p className="wx-dim mt-2 font-mono text-[11px] break-all">
          showing {shown ? `${shown.layers} · zoom ${shown.zoom}` : "…"}
          {BUILD_REF ? ` · build ${BUILD_REF}` : ""}
        </p>

        {/*
          Playback lives over the map as a glass panel rather than as a row of
          buttons beneath it: the scrubber is only meaningful while looking at
          the image, and putting it there halves the vertical space the card
          needs on a phone.
        */}
      </Card>

      <Card
        title="View"
        subtitle="Pick one — these cover the whole map, so only one can show at a time"
      >
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Map view">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={view === option.id}
              title={option.hint}
              onClick={() => setView(option.id)}
              className={`wx-btn px-3 py-1.5 text-sm ${
                view === option.id ? "wx-btn-active" : ""
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={view === ""}
            title="Base map only"
            onClick={() => setView("")}
            className={`wx-btn px-3 py-1.5 text-sm ${view === "" ? "wx-btn-active" : ""}`}
          >
            None
          </button>
        </div>
      </Card>

      <Card title="Overlays" subtitle="Stack any of these on top of the view">
        <div className="flex flex-wrap gap-2">
          {OVERLAYS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={overlays.includes(option.id)}
              title={option.hint}
              onClick={() => toggleOverlay(option.id)}
              className={`wx-btn px-3 py-1.5 text-sm ${
                overlays.includes(option.id) ? "wx-btn-active" : ""
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="wx-dim mt-3 text-xs">
          Overlays draw above the view in the order listed. Storm cells,
          lightning, wildfires and tropical systems only draw where that
          phenomenon is currently occurring, so an empty map is a valid answer.
          Forecast offsets apply to modelled layers only.
        </p>
      </Card>
    </div>
  );
}
