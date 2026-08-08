"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip, Notice } from "./ui";
import type { ResolvedPlace } from "@/lib/weather-types";

/** Weather overlays offered in the picker, in draw order (bottom to top). */
const WEATHER_LAYERS: { id: string; label: string; hint: string }[] = [
  { id: "radar-global", label: "Radar", hint: "Global precipitation radar mosaic" },
  { id: "satellite", label: "Satellite", hint: "Infrared/visible satellite imagery" },
  { id: "temperatures", label: "Temperature", hint: "Surface temperature field" },
  { id: "dew-points", label: "Dew point", hint: "Surface dew point field" },
  { id: "humidity", label: "Humidity", hint: "Relative humidity field" },
  { id: "wind-speeds", label: "Wind speed", hint: "Surface wind speed" },
  { id: "pressure-isobars", label: "Isobars", hint: "Mean sea-level pressure contours" },
  { id: "precip-24hr", label: "24h precip", hint: "Accumulated precipitation" },
  { id: "snow-depth", label: "Snow depth", hint: "Modelled snow on the ground" },
  { id: "air-quality-index", label: "Air quality", hint: "Air quality index field" },
  { id: "alerts", label: "Alerts", hint: "Government watches, warnings and advisories" },
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

export function MapPanel({ place }: { place: ResolvedPlace }) {
  const [selected, setSelected] = useState<string[]>(["radar-global"]);
  const [zoom, setZoom] = useState(7);
  const [offsetIndex, setOffsetIndex] = useState(
    OFFSETS.findIndex((o) => o.id === "current")
  );
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setOffsetIndex((index) => (index + 1) % OFFSETS.length);
    }, 900);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const layerParam = useMemo(
    () => ["flat-dk", ...selected, "admin-cities-dk", "countries"].join(","),
    [selected]
  );

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

  useEffect(() => {
    setLoaded(false);
    setFailed(null);
  }, [src]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((layer) => layer !== id)
        : [...current, id]
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title="Weather map"
        subtitle={`Centred on ${place.displayName} · Xweather raster maps`}
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="wx-btn px-2 py-1 text-xs"
              onClick={() => setZoom((z) => Math.max(3, z - 1))}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="wx-muted w-14 text-center text-xs">zoom {zoom}</span>
            <button
              type="button"
              className="wx-btn px-2 py-1 text-xs"
              onClick={() => setZoom((z) => Math.min(12, z + 1))}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        }
      >
        <div className="relative overflow-hidden rounded-xl border border-slate-400/20 bg-slate-900/60">
          {/* Static raster tile composite; the API key stays on the server. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            src={src}
            alt={`Weather map of ${place.displayName} showing ${selected.join(", ") || "base map"}`}
            className="block w-full"
            // Pin the box to the requested aspect so the layout can't jump if
            // the upstream image comes back at an unexpected size.
            style={{ aspectRatio: "1000 / 620", objectFit: "cover" }}
            width={1000}
            height={620}
            onLoad={() => setLoaded(true)}
            onError={() =>
              setFailed(
                "The map image could not be loaded. Raster maps may not be included in your Xweather subscription."
              )
            }
          />
          {!loaded && !failed && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 text-sm">
              Loading map…
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <Notice tone="warn">{failed}</Notice>
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

      <Card title="Layers" subtitle="Stack any combination over the base map">
        <div className="flex flex-wrap gap-2">
          {WEATHER_LAYERS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              title={layer.hint}
              onClick={() => toggle(layer.id)}
              className={`wx-btn px-3 py-1.5 text-sm ${
                selected.includes(layer.id) ? "wx-btn-active" : ""
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>
        <p className="wx-dim mt-3 text-xs">
          Layers render bottom-to-top in the order listed. Some layers (storm
          cells, lightning, tropical systems) only draw where that phenomenon is
          currently occurring, and forecast offsets apply to modelled layers only.
        </p>
      </Card>
    </div>
  );
}
