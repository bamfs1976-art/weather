"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip, Notice } from "./ui";
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

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Set when the server had to drop layers the upstream would not render. */
  const [droppedLayers, setDroppedLayers] = useState<string[]>([]);
  /**
   * What the picture on screen actually is, as opposed to what the controls
   * currently say. The two drift apart when a stale bundle is running or a
   * response is served from cache, and without this the only symptom is "the
   * map looks wrong", which is impossible to act on.
   */
  const [shown, setShown] = useState<{ layers: string; zoom: string } | null>(null);

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

  const src = useMemo(() => {
    const params = new URLSearchParams({
      lat: place.lat.toFixed(4),
      lon: place.lon.toFixed(4),
      zoom: String(zoom),
      layers: layerParam,
      offset: OFFSETS[offsetIndex].id,
      w: "1000",
      h: "620",
    });
    return `/api/map?${params.toString()}`;
  }, [place.lat, place.lon, zoom, layerParam, offsetIndex]);

  /*
   * Fetched rather than dropped straight into <img src>, because an <img> can
   * only report "it failed" — it cannot read the JSON body explaining why. A
   * rejected layer name and an unsubscribed account both used to surface as
   * the same misleading message.
   */
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(null);
    setDroppedLayers([]);

    (async () => {
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) detail = String(body.error);
          } catch {
            /* non-JSON error body — the status will have to do */
          }
          if (!cancelled) setError(detail);
          return;
        }
        const used = res.headers.get("X-Map-Layers");
        const requested = res.headers.get("X-Map-Requested");
        if (used && requested && used !== requested) {
          const kept = new Set(used.split(","));
          const dropped = requested.split(",").filter((l) => !kept.has(l));
          if (!cancelled && dropped.length) setDroppedLayers(dropped);
        }

        const blob = await res.blob();
        if (cancelled) return;
        const sent = new URL(src, window.location.origin).searchParams;
        setShown({
          layers: used ?? sent.get("layers") ?? "",
          zoom: sent.get("zoom") ?? "",
        });
        objectUrl = URL.createObjectURL(blob);
        setImageUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return objectUrl;
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.name === "TimeoutError"
            ? "The map image timed out."
            : "The map image could not be loaded."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // Release the last object URL when the panel goes away.
  useEffect(() => {
    return () => {
      setImageUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    };
  }, []);

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
          {imageUrl && !error ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={imageUrl}
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
          <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1">
            <Chip tone="accent">{OFFSETS[offsetIndex].label}</Chip>
            {droppedLayers.length > 0 && (
              <Chip tone="warn" title="Xweather would not render these layers, so they were dropped">
                not available: {droppedLayers.join(", ")}
              </Chip>
            )}
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`wx-btn text-sm ${playing ? "wx-btn-active" : ""}`}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "⏸ Pause" : "▶ Animate"}
          </button>
          <div className="wx-scroll flex gap-1">
            {OFFSETS.map((offset, index) => (
              <button
                key={offset.id}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setOffsetIndex(index);
                }}
                className={`wx-btn shrink-0 px-2.5 py-1 text-xs ${
                  offsetIndex === index ? "wx-btn-active" : ""
                }`}
              >
                {offset.label}
              </button>
            ))}
          </div>
        </div>
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
