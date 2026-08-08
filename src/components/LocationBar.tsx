"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaceSuggestion, UnitSystem } from "@/lib/weather-types";

export interface SavedPlace {
  query: string;
  label: string;
}

export function LocationBar({
  current,
  favorites,
  units,
  hour12,
  loading,
  onSelect,
  onUnitsChange,
  onHour12Change,
  onToggleFavorite,
  onRefresh,
  lastUpdated,
}: {
  current: SavedPlace | null;
  favorites: SavedPlace[];
  units: UnitSystem;
  hour12: boolean;
  loading: boolean;
  onSelect: (place: SavedPlace) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onHour12Change: (hour12: boolean) => void;
  onToggleFavorite: () => void;
  onRefresh: () => void;
  lastUpdated: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const isFavorite =
    current !== null && favorites.some((f) => f.query === current.query);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(term)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setHighlight(-1);
      } catch {
        /* aborted or offline — leave the previous suggestions in place */
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  function choose(suggestion: PlaceSuggestion) {
    onSelect({ query: suggestion.query, label: suggestion.displayName });
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function submitRaw() {
    const term = query.trim();
    if (!term) return;
    if (results.length > 0) {
      choose(results[Math.max(highlight, 0)]);
      return;
    }
    // Fall through to the API's own location parser — it accepts postcodes,
    // airport codes, station IDs and "city, country" strings directly.
    onSelect({ query: term, label: term });
    setQuery("");
    setOpen(false);
  }

  function useMyLocation() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("This browser does not support geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        onSelect({
          query: `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
          label: "My location",
        });
      },
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied."
            : "Could not determine your location."
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  }

  return (
    <div className="wx-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div ref={boxRef} className="relative flex-1">
          <label htmlFor="wx-search" className="sr-only">
            Search for a place
          </label>
          <div className="flex items-center gap-2">
            <span className="wx-muted pointer-events-none absolute left-3 text-sm" aria-hidden>
              🔍
            </span>
            <input
              id="wx-search"
              className="wx-field wx-field-search w-full"
              placeholder="City, postcode, airport code or lat,lon…"
              value={query}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRaw();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight((h) => Math.min(h + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          </div>

          {open && (query.trim().length >= 2 || searching) && (
            <ul className="wx-card absolute z-30 mt-2 max-h-72 w-full overflow-auto p-1 shadow-2xl">
              {searching && results.length === 0 && (
                <li className="wx-muted px-3 py-2 text-sm">Searching…</li>
              )}
              {!searching && results.length === 0 && (
                <li className="wx-muted px-3 py-2 text-sm">
                  No matches. Press Enter to try “{query.trim()}” as-is.
                </li>
              )}
              {results.map((suggestion, index) => (
                <li key={suggestion.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(suggestion)}
                    className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                      index === highlight ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="truncate">{suggestion.displayName}</span>
                    <span className="wx-dim shrink-0 font-mono text-[11px]">
                      {suggestion.lat.toFixed(2)}, {suggestion.lon.toFixed(2)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="wx-btn text-sm" onClick={useMyLocation}>
            📍 My location
          </button>
          <button
            type="button"
            className={`wx-btn text-sm ${isFavorite ? "wx-btn-active" : ""}`}
            onClick={onToggleFavorite}
            disabled={!current}
            title={isFavorite ? "Remove from saved places" : "Save this place"}
          >
            {isFavorite ? "★ Saved" : "☆ Save"}
          </button>

          <div className="flex overflow-hidden rounded-lg border border-slate-400/20">
            {(["metric", "imperial"] as UnitSystem[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onUnitsChange(option)}
                className={`px-3 py-2 text-sm ${
                  units === option ? "bg-sky-400/20 text-sky-100" : "hover:bg-white/5"
                }`}
              >
                {option === "metric" ? "°C" : "°F"}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="wx-btn text-sm"
            onClick={() => onHour12Change(!hour12)}
            title="Toggle 12/24-hour clock"
          >
            {hour12 ? "12h" : "24h"}
          </button>

          <button
            type="button"
            className="wx-btn text-sm"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {(favorites.length > 0 || geoError || lastUpdated) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-400/15 pt-3">
          {favorites.map((favorite) => (
            <button
              key={favorite.query}
              type="button"
              onClick={() => onSelect(favorite)}
              className={`wx-btn px-2.5 py-1 text-xs ${
                current?.query === favorite.query ? "wx-btn-active" : ""
              }`}
            >
              {favorite.label}
            </button>
          ))}
          {geoError && (
            <span className="text-xs text-amber-300/90">{geoError}</span>
          )}
          {lastUpdated && (
            <span className="wx-dim ml-auto text-xs">
              Updated {lastUpdated}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
