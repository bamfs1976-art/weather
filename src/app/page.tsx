"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationBar, type SavedPlace } from "@/components/LocationBar";
import { NowPanel } from "@/components/NowPanel";
import { HourlyPanel } from "@/components/HourlyPanel";
import { ForecastPanel } from "@/components/ForecastPanel";
import { RecentPanel } from "@/components/RecentPanel";
import { WeatherHistoryPanel } from "@/components/WeatherHistoryPanel";
import { AirSunPanel } from "@/components/AirSunPanel";
import { WaterPanel } from "@/components/WaterPanel";
import { LocalPanel } from "@/components/LocalPanel";
import { Logo } from "@/components/Logo";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Notice, Skeleton } from "@/components/ui";
import { relativeFromNow } from "@/lib/weather-format";
import type { ThemeName, UnitSystem, WeatherOverview } from "@/lib/weather-types";

const TABS = [
  { id: "now", label: "Now" },
  { id: "hourly", label: "Hourly" },
  { id: "forecast", label: "10-day" },
  { id: "recent", label: "Last 24h" },
  { id: "history", label: "History" },
  { id: "water", label: "Rivers & Sea" },
  { id: "air", label: "Air & Sun" },
  { id: "local", label: "Local" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STORAGE = {
  place: "wx:place",
  favorites: "wx:favorites",
  units: "wx:units",
  hour12: "wx:hour12",
  theme: "wx:theme",
} as const;

/*
 * Used when geolocation is unavailable or declined and nothing is saved.
 * Coordinates rather than a name on purpose: Xweather's place search resolves
 * "Morriston, Swansea, UK" to Port Talbot ~15km east, and "Swansea, Wales, UK"
 * to the city centre ~5km south. The lat/lon is unambiguous.
 */
const FALLBACK_PLACE: SavedPlace = {
  query: "51.6656,-3.9333",
  label: "Morriston, Swansea",
};

export default function WeatherPage() {
  const [place, setPlace] = useState<SavedPlace | null>(null);
  const [favorites, setFavorites] = useState<SavedPlace[]>([]);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [hour12, setHour12] = useState(false);
  // Light is the default; layout.tsx has already applied any stored choice to
  // <html> before paint, so read it back from there rather than re-deciding.
  const [theme, setTheme] = useState<ThemeName>("light");
  const [tab, setTab] = useState<TabId>("now");

  const [overview, setOverview] = useState<WeatherOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  /* Restore preferences, then pick a starting location. */
  useEffect(() => {
    try {
      const savedUnits = localStorage.getItem(STORAGE.units);
      if (savedUnits === "metric" || savedUnits === "imperial") setUnits(savedUnits);
      setHour12(localStorage.getItem(STORAGE.hour12) === "true");
      setTheme(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light"
      );

      const savedFavorites = localStorage.getItem(STORAGE.favorites);
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites) as SavedPlace[]);

      const fromUrl = new URLSearchParams(window.location.search).get("p");
      if (fromUrl) {
        setPlace({ query: fromUrl, label: fromUrl });
        return;
      }

      const savedPlace = localStorage.getItem(STORAGE.place);
      if (savedPlace) {
        setPlace(JSON.parse(savedPlace) as SavedPlace);
        return;
      }
    } catch {
      /* corrupt or unavailable storage — fall through to geolocation */
    }

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          setPlace({
            query: `${position.coords.latitude.toFixed(4)},${position.coords.longitude.toFixed(4)}`,
            label: "My location",
          }),
        () => setPlace(FALLBACK_PLACE),
        { timeout: 8000, maximumAge: 600_000 }
      );
    } else {
      setPlace(FALLBACK_PLACE);
    }
  }, []);

  const load = useCallback(async (target: SavedPlace) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/overview?p=${encodeURIComponent(target.query)}`
      );
      const payload = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(payload.error ?? "Could not load weather data.");
      setOverview(payload as WeatherOverview);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Could not load weather data.");
      setOverview(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!place) return;
    load(place);
    try {
      localStorage.setItem(STORAGE.place, JSON.stringify(place));
      const url = new URL(window.location.href);
      url.searchParams.set("p", place.query);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* non-fatal */
    }
  }, [place, load]);

  /*
   * The label the user sees comes from the API once it has answered. Deriving
   * it instead of writing it back into `place` matters: `place` is the fetch
   * key, so refining its label in an effect would retrigger the effect below
   * and fetch the whole overview a second time for every location change.
   */
  const displayPlace = useMemo<SavedPlace | null>(
    () =>
      place
        ? { query: place.query, label: overview?.place.displayName || place.label }
        : null,
    [place, overview]
  );

  const persist = useCallback((next: SavedPlace[]) => {
    setFavorites(next);
    try {
      localStorage.setItem(STORAGE.favorites, JSON.stringify(next));
    } catch {
      /* non-fatal */
    }
  }, []);

  const toggleFavorite = useCallback(() => {
    if (!displayPlace) return;
    const exists = favorites.some((f) => f.query === displayPlace.query);
    persist(
      exists
        ? favorites.filter((f) => f.query !== displayPlace.query)
        : [...favorites, displayPlace].slice(-8)
    );
  }, [favorites, displayPlace, persist]);

  const changeUnits = useCallback((next: UnitSystem) => {
    setUnits(next);
    try {
      localStorage.setItem(STORAGE.units, next);
    } catch {
      /* non-fatal */
    }
  }, []);

  const changeTheme = useCallback((next: ThemeName) => {
    setTheme(next);
    // The attribute drives every colour token in globals.css.
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE.theme, next);
    } catch {
      /* non-fatal */
    }
  }, []);

  const changeHour12 = useCallback((next: boolean) => {
    setHour12(next);
    try {
      localStorage.setItem(STORAGE.hour12, String(next));
    } catch {
      /* non-fatal */
    }
  }, []);

  const lastUpdated = useMemo(
    () => (overview ? relativeFromNow(overview.fetchedAt) : null),
    [overview]
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-8">
      <header className="mb-4 flex items-center gap-3">
        <Logo size={44} className="shrink-0" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Weather
          </h1>
          <p className="wx-muted text-xs">
            Live data from the Vaisala Xweather API
          </p>
        </div>
      </header>

      <LocationBar
        current={displayPlace}
        favorites={favorites}
        units={units}
        hour12={hour12}
        theme={theme}
        loading={loading}
        onSelect={setPlace}
        onUnitsChange={changeUnits}
        onHour12Change={changeHour12}
        onThemeChange={changeTheme}
        onToggleFavorite={toggleFavorite}
        onRefresh={() => place && load(place)}
        lastUpdated={lastUpdated}
      />

      <nav className="wx-scroll mt-4 flex gap-1 pb-1" aria-label="Weather views">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setTab(option.id)}
            aria-current={tab === option.id ? "page" : undefined}
            className={`wx-btn shrink-0 text-sm ${tab === option.id ? "wx-btn-active" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {error && (
          <div className="mb-4">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        {loading && !overview && <LoadingState />}

        {overview && (
          <ErrorBoundary
            key={`${tab}-${overview.place.id}`}
            label={TABS.find((option) => option.id === tab)?.label ?? tab}
          >
            <div className="wx-fade">
            {tab === "now" && (
              <NowPanel
                overview={overview}
                units={units}
                hour12={hour12}
                theme={theme}
              />
            )}
            {tab === "hourly" && (
              <HourlyPanel overview={overview} units={units} hour12={hour12} />
            )}
            {tab === "forecast" && (
              <ForecastPanel overview={overview} units={units} hour12={hour12} />
            )}
            {tab === "recent" && (
              <RecentPanel overview={overview} units={units} hour12={hour12} />
            )}
            {tab === "history" && place && (
              <WeatherHistoryPanel
                placeQuery={place.query}
                units={units}
                hour12={hour12}
              />
            )}
            {tab === "water" && place && (
              <WaterPanel placeQuery={place.query} hour12={hour12} />
            )}
            {tab === "air" && (
              <AirSunPanel overview={overview} units={units} hour12={hour12} />
            )}
            {tab === "local" && place && (
              <LocalPanel placeQuery={place.query} hour12={hour12} />
            )}
            </div>
          </ErrorBoundary>
        )}

        {!overview && !loading && !error && (
          <Notice>Search for a place to get started.</Notice>
        )}
      </div>

      <footer className="wx-dim mt-8 border-t border-slate-400/15 pt-4 text-xs">
        <p>
          Weather data © Vaisala Xweather. Conditions are interpolated for the
          exact coordinates shown; station observations, archives and forecasts
          come from the Xweather Weather API.
        </p>
        {overview && (
          <p className="mt-1">
            {overview.place.lat.toFixed(4)}, {overview.place.lon.toFixed(4)}
            {overview.place.tzname ? ` · ${overview.place.tzname}` : ""}
          </p>
        )}
      </footer>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="wx-card p-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-16 w-40" />
        <Skeleton className="mt-3 h-4 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="wx-card p-6">
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="wx-card p-6">
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
