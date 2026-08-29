"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip, Notice } from "./ui";
import { formatTime } from "@/lib/weather-format";
import { TILE_SIZE, tileGrid } from "@/lib/tiles";
import type { RadarIndex } from "@/lib/rainviewer";
import type { ResolvedPlace } from "@/lib/weather-types";

/**
 * Weather radar, scrubbable — roughly two hours behind and a short
 * extrapolation ahead.
 *
 * The rain timeline on this same tab says *when* rain arrives; this says
 * *where it is*, which is the other half of the question and the half a model
 * forecast cannot answer. Radar is an observation.
 *
 * **A tiled map, without a mapping library.** RainViewer serves XYZ tiles
 * rather than the single composite image the Xweather map uses, so the
 * projection is done in `lib/tiles.ts` and the tiles are laid out as absolutely
 * positioned images. That is about forty lines of arithmetic against a
 * dependency the size of Leaflet, and CLAUDE.md's rule about new dependencies
 * is the reason it went the first way.
 *
 * Tiles load straight from the browser: both sources are keyless, so a proxy
 * would add a serverless hop and the shared-cache hazard `/api/map` already
 * suffered, for no gain.
 */

/** Zooms offered. Roughly county, region and country at this latitude. */
const ZOOMS = [9, 7, 5] as const;
const VIEWPORT_HEIGHT = 320;

export function RadarMap({
  place,
  hour12,
}: {
  place: ResolvedPlace;
  hour12: boolean;
}) {
  const [index, setIndex] = useState<RadarIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState<number>(ZOOMS[1]);

  /*
   * The tile grid depends on how wide the card actually is, which the server
   * cannot know — so the map renders only after mount and after a measurement.
   * Rendering a guessed width on the server and a real one in the browser
   * would be a hydration mismatch across every tile in the grid.
   */
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(measured));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/radar")
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof body?.error === "string" ? body.error : "Radar unavailable.");
          return;
        }
        setIndex(body as RadarIndex);
        /* Open on the most recent observed frame, not on an extrapolation. */
        setFrame((body as RadarIndex).nowIndex);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the radar service.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!playing || !index) return;
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % index.frames.length);
    }, 500);
    return () => clearInterval(timer);
  }, [playing, index]);

  const tiles = useMemo(
    () => (width > 0 ? tileGrid(place.lat, place.lon, zoom, width, VIEWPORT_HEIGHT) : []),
    [place.lat, place.lon, zoom, width]
  );

  const current = index?.frames[frame] ?? null;

  return (
    <Card
      title="Rain radar"
      subtitle={
        index
          ? `${index.pastCount} observed frames and ${index.forecastCount} forecast, centred on ${place.name}`
          : "Where the rain actually is"
      }
      source="RainViewer · base map © OpenStreetMap contributors"
      action={
        index && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="wx-btn px-2 py-1 text-xs"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "Pause radar animation" : "Play radar animation"}
            >
              {playing ? "Pause" : "Play"}
            </button>
            {ZOOMS.map((z) => (
              <button
                key={z}
                type="button"
                className={`wx-btn px-2 py-1 text-xs ${zoom === z ? "wx-btn-active" : ""}`}
                onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
              >
                {z === 9 ? "Near" : z === 7 ? "Region" : "Wide"}
              </button>
            ))}
          </div>
        )
      }
    >
      {error ? (
        <Notice tone="warn">{error}</Notice>
      ) : (
        <div className="space-y-3">
          <div
            ref={boxRef}
            className="wx-inset relative overflow-hidden rounded-lg"
            style={{ height: `${VIEWPORT_HEIGHT}px` }}
          >
            {tiles.length > 0 && (
              <>
                {/*
                  * Base map underneath, dimmed and desaturated so the radar
                  * reads on top of it rather than competing with it. The
                  * filter is also what keeps a light street map from glaring
                  * out of a dark dashboard.
                  */}
                {tiles.map((tile) => (
                  /*
                   * Plain <img>, not next/image, and deliberately so: the
                   * optimiser would route every one of these through the
                   * host's image pipeline, which costs money per tile, defeats
                   * the browser cache that makes an animation loop cheap on
                   * the second pass, and buys nothing for a 256px PNG that is
                   * already the exact size it is displayed at.
                   */
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

                {current &&
                  index &&
                  tiles.map((tile) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`radar-${current.time}-${tile.z}-${tile.x}-${tile.y}`}
                      src={`${index.host}${current.path}/${TILE_SIZE}/${tile.z}/${tile.x}/${tile.y}/4/1_1.png`}
                      alt=""
                      aria-hidden
                      width={TILE_SIZE}
                      height={TILE_SIZE}
                      className="pointer-events-none absolute select-none"
                      style={{ left: `${tile.left}px`, top: `${tile.top}px`, opacity: 0.85 }}
                    />
                  ))}

                {/* Where you are. */}
                <div
                  className="pointer-events-none absolute"
                  style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
                  aria-hidden
                >
                  <div className="wx-radar-pin" />
                </div>
              </>
            )}

            {!index && !error && (
              <div className="wx-dim absolute inset-0 grid place-items-center text-sm">
                Loading radar…
              </div>
            )}
          </div>

          {index && current && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="wx-num text-sm font-medium">
                  {formatTime(current.iso, hour12)}
                </span>
                {current.forecast ? (
                  <Chip tone="accent">Forecast</Chip>
                ) : frame === index.nowIndex ? (
                  <Chip tone="good">Latest</Chip>
                ) : (
                  <Chip>Past</Chip>
                )}
                <span className="wx-dim text-xs">
                  frame {frame + 1} of {index.frames.length}
                </span>
              </div>

              <label className="block">
                <span className="sr-only">Radar frame</span>
                <input
                  type="range"
                  min={0}
                  max={index.frames.length - 1}
                  value={frame}
                  onChange={(event) => {
                    setPlaying(false);
                    setFrame(Number(event.target.value));
                  }}
                  className="w-full"
                  aria-valuetext={`${formatTime(current.iso, hour12)}${
                    current.forecast ? ", forecast" : ""
                  }`}
                />
              </label>

              <p className="wx-muted text-xs leading-relaxed">
                Radar shows rain that has been observed. Frames after{" "}
                {formatTime(index.frames[index.nowIndex]?.iso, hour12)} are extrapolated
                from its recent movement — good for the next half hour, and not a
                forecast beyond that.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
