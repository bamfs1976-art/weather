"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CloseIcon,
  GearIcon,
  MoonIcon,
  PinIcon,
  RefreshIcon,
  SearchIcon,
  StarIcon,
  SunIcon,
} from "./icons";
import type { PlaceSuggestion, ThemeName, UnitSystem } from "@/lib/weather-types";

export interface SavedPlace {
  query: string;
  label: string;
}

const RECENTS_KEY = "wx:recents";
const MAX_RECENTS = 5;

function readRecents(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedPlace[]).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

/**
 * Search, location controls and settings.
 *
 * The split the brief asks for: search stays full width and prominent because
 * it is the only control most visits use, while the unit, clock and theme
 * switches — set once and then left alone for months — move behind a gear.
 * That takes four permanent buttons out of the bar without removing anything.
 */
export function LocationBar({
  current,
  favorites,
  units,
  hour12,
  theme,
  loading,
  onSelect,
  onUnitsChange,
  onHour12Change,
  onThemeChange,
  onToggleFavorite,
  onRefresh,
  lastUpdated,
}: {
  current: SavedPlace | null;
  favorites: SavedPlace[];
  units: UnitSystem;
  hour12: boolean;
  theme: ThemeName;
  loading: boolean;
  onSelect: (place: SavedPlace) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onHour12Change: (hour12: boolean) => void;
  onThemeChange: (theme: ThemeName) => void;
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
  const [recents, setRecents] = useState<SavedPlace[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const isFavorite =
    current !== null && favorites.some((f) => f.query === current.query);

  useEffect(() => setRecents(readRecents()), []);

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
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
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

  function remember(place: SavedPlace) {
    setRecents((previous) => {
      const next = [place, ...previous.filter((p) => p.query !== place.query)].slice(
        0,
        MAX_RECENTS
      );
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* private mode — recents are a convenience, not state worth failing for */
      }
      return next;
    });
  }

  function pick(place: SavedPlace) {
    remember(place);
    onSelect(place);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  function submitRaw() {
    const term = query.trim();
    if (!term) return;
    if (results.length > 0) {
      const chosen = results[Math.max(highlight, 0)];
      pick({ query: chosen.query, label: chosen.displayName });
      return;
    }
    // The API's own parser accepts postcodes, airport codes and "city, country".
    pick({ query: term, label: term });
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

  // With nothing typed the list offers recents, so the control is useful the
  // moment it is focused rather than only after two characters.
  const showRecents = open && query.trim().length < 2 && recents.length > 0;
  const listOpen = open && (query.trim().length >= 2 || showRecents);
  const options: SavedPlace[] = showRecents
    ? recents
    : results.map((r) => ({ query: r.query, label: r.displayName }));

  /*
   * While either overlay is open the whole card is lifted above the sticky tab
   * bar. The popover's own z-index is not enough: the tab bar carries a
   * backdrop-filter, which creates a stacking context, and Safari paints such
   * an element over later content whatever its z-index says — the popover
   * appeared sliced in half by the tab strip on iOS while looking correct in
   * Chromium. Lifting the card as a unit sidesteps the whole question, and it
   * is conditional so that when nothing is open the card still scrolls
   * underneath the tab bar as it should.
   */
  const elevated = listOpen || settingsOpen;

  return (
    <div className={`wx-card p-3 sm:p-4 ${elevated ? "wx-elevated" : ""}`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div ref={boxRef} className="relative min-w-0">
          <label htmlFor="wx-search" className="sr-only">
            Search for a place
          </label>
          <span className="wx-search-icon" aria-hidden>
            <SearchIcon size={18} />
          </span>
          <input
            id="wx-search"
            ref={inputRef}
            className="wx-field wx-field-search w-full"
            placeholder="City, postcode, airport code or lat,lon…"
            value={query}
            autoComplete="off"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              highlight >= 0 && options[highlight] ? `${listId}-${highlight}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (showRecents && highlight >= 0) pick(recents[highlight]);
                else submitRaw();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setHighlight((h) => Math.min(h + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (event.key === "Escape") {
                setOpen(false);
                setHighlight(-1);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="wx-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <CloseIcon size={16} />
            </button>
          )}

          {listOpen && (
            <ul className="wx-combo" id={listId} role="listbox" aria-label="Places">
              {showRecents && <li className="wx-combo-heading">Recent</li>}
              {options.map((option, index) => (
                <li key={`${option.query}-${index}`} role="none">
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={highlight === index}
                    className={`wx-combo-option ${highlight === index ? "is-active" : ""}`}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
              {!showRecents && options.length === 0 && (
                <li className="wx-combo-empty">
                  {searching ? "Searching…" : "No matches — press Enter to try it anyway."}
                </li>
              )}
            </ul>
          )}
        </div>

        {/* relative here, not on the gear: a 240px panel anchored to a 44px
            button runs off the left edge of a 390px screen. */}
        <div className="relative flex items-center gap-1.5">
          <IconButton label="Use my location" onClick={useMyLocation}>
            <PinIcon size={18} />
          </IconButton>
          <IconButton
            label={isFavorite ? "Remove saved location" : "Save this location"}
            onClick={onToggleFavorite}
            pressed={isFavorite}
          >
            <StarIcon size={18} filled={isFavorite} />
          </IconButton>
          <IconButton label="Refresh" onClick={onRefresh} disabled={loading}>
            <span className={loading ? "wx-spin" : undefined} style={{ display: "inline-flex" }}>
              <RefreshIcon size={18} />
            </span>
          </IconButton>

          <IconButton
            label="Settings"
            onClick={() => setSettingsOpen((o) => !o)}
            pressed={settingsOpen}
            expanded={settingsOpen}
          >
            <GearIcon size={18} />
          </IconButton>

          {settingsOpen && (
            <SettingsPopover
              units={units}
              hour12={hour12}
              theme={theme}
              onUnitsChange={onUnitsChange}
              onHour12Change={onHour12Change}
              onThemeChange={onThemeChange}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </div>

      {favorites.length > 0 && (
        <div className="wx-scroll mt-3 flex gap-1.5 pb-0.5">
          {favorites.map((place) => (
            <button
              key={place.query}
              type="button"
              onClick={() => onSelect(place)}
              className={`wx-chip-btn ${current?.query === place.query ? "is-active" : ""}`}
            >
              {place.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {geoError ? (
          <span className="text-xs" style={{ color: "var(--wx-warn)" }} role="alert">
            {geoError}
          </span>
        ) : (
          <span />
        )}
        {/*
          Polite, not assertive: the freshness of the data is worth announcing
          after a refresh but must never interrupt what is being read.
        */}
        <span className="wx-dim text-xs" aria-live="polite">
          {loading ? "Updating…" : lastUpdated ? `Updated ${lastUpdated}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IconButton({
  label,
  onClick,
  children,
  disabled,
  pressed,
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="wx-icon-btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
    >
      {children}
    </button>
  );
}

/**
 * Settings, in a popover rather than in the bar.
 *
 * Closes on Escape and on click-away, and returns focus to the trigger, so a
 * keyboard user is never stranded inside it.
 */
function SettingsPopover({
  units,
  hour12,
  theme,
  onUnitsChange,
  onHour12Change,
  onThemeChange,
  onClose,
}: {
  units: UnitSystem;
  hour12: boolean;
  theme: ThemeName;
  onUnitsChange: (units: UnitSystem) => void;
  onHour12Change: (hour12: boolean) => void;
  onThemeChange: (theme: ThemeName) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        trigger?.focus();
      }
    }
    function onAway(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    // Deferred: the click that opened the popover is still propagating.
    const timer = setTimeout(() => document.addEventListener("mousedown", onAway), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onAway);
      clearTimeout(timer);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="wx-popover" role="dialog" aria-label="Display settings">
      <Segment
        label="Units"
        options={[
          { id: "metric", label: "°C" },
          { id: "imperial", label: "°F" },
        ]}
        value={units}
        onChange={(id) => onUnitsChange(id as UnitSystem)}
      />
      <Segment
        label="Clock"
        options={[
          { id: "24", label: "24h" },
          { id: "12", label: "12h" },
        ]}
        value={hour12 ? "12" : "24"}
        onChange={(id) => onHour12Change(id === "12")}
      />
      <Segment
        label="Theme"
        options={[
          { id: "light", label: "Light", icon: <SunIcon size={14} /> },
          { id: "dark", label: "Dark", icon: <MoonIcon size={14} /> },
        ]}
        value={theme}
        onChange={(id) => onThemeChange(id as ThemeName)}
      />
    </div>
  );
}

function Segment({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="wx-seg-row">
      <span className="wx-seg-label">{label}</span>
      <div className="wx-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`wx-seg-btn ${value === option.id ? "is-active" : ""}`}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
