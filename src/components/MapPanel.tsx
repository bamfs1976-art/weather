"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip, Notice } from "./ui";
import type { ResolvedPlace, ThemeName } from "@/lib/weather-types";

/**
 * The weather layers split into two kinds, and conflating them was a bug:
 *
 *  - A "view" is an opaque, full-coverage raster (radar, satellite, a
 *    temperature field). Stacking two of these just hides the lower one, so
 *    only one can be active at a time. Previously every layer button added to
 *    a single list, so clicking Satellite then Temperature buried the map
 *    under opaque sheets and made zoom look broken too.
 *  - An "overlay" is sparse — alerts, storm cells, strikes — and several can
 *    sensibly sit on top of a view at once.
 */
const VIEWS: { id: string; label: string; hint: string }[] = [
  { id: "radar-global", label: "Radar", hint: "Global precipitation radar mosaic" },
  { id: "satellite", label: "Satellite", hint: "Infrared/visible satellite imagery" },
  { id: "temperatures", label: "Temperature", hint: "Surface temperature field" },
  { id: "dew-points", label: "Dew point", hint: "Surface dew point field" },
  { id: "humidity", label: "Humidity", hint: "Relative humidity field" },
  { id: "wind-speeds", label: "Wind speed", hint: "Surface wind speed" },
  { id: "air-quality-index", label: "Air quality", hint: "Air quality index field" },
  { id: "snow-depth", label: "Snow depth", hint: "Modelled snow on the ground" },
  { id: "precip-24hr", label: "24h precip", hint: "Accumulated precipitation" },
];

const OVERLAYS: { id: string; label: string; hint: string }[] = [
  { id: "alerts", label: "Alerts", hint: "Government watches, warnings and advisories" },
  { id: "pressure-isobars", label: "Isobars", hint: "Mean sea-level pressure contours" },
  { id: "stormcells", label: "Storm cells", hint: "Tracked convective cells" },
  { id: "lightning-strikes-5m-icons", label: "Lightning", hint: "Strikes in the last 5 minutes" },
  { id: "fires", label: "Wildfires", hint: "Active fire detections" },
  { id: "tropical-cyclones", label: "Tropical", hint: "Active tropical systems and tracks" },
];

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

  // Base and label layers follow the app theme so the map does not sit as a
  // dark slab in the middle of a light page.
  const layerParam = useMemo(() => {
    const base = theme === "dark" ? "flat-dk" : "flat";
    const admin = theme === "dark" ? "admin-cities-dk" : "admin-cities";
    return [base, view, ...overlays, admin, "countries"]
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
        const blob = await res.blob();
        if (cancelled) return;
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
          <div className="pointer-events-none absolute bottom-2 left-2">
            <Chip tone="accent">{OFFSETS[offsetIndex].label}</Chip>
          </div>
        </div>

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
