"use client";

import { useSyncExternalStore } from "react";

/**
 * A once-a-minute clock, shared by everything on the page that needs "now".
 *
 * An external store rather than an interval in an effect, for two reasons. The
 * browser's clock is exactly the kind of outside-React system this hook exists
 * for — and, more to the point, it has a **server snapshot**. The server cannot
 * know what time it will be when the tree hydrates, so reading the real clock
 * during the first render produces markup that does not match what the server
 * sent. That is a hydration mismatch, and it lands on the two things here that
 * must not flicker: a severe weather warning, and how long until it rains.
 *
 * `0` is the server's answer and means "no clock yet". Every caller must treat
 * it as such rather than as the epoch: show the absolute time on the first
 * paint and add the relative phrase once the subscription is live. That way the
 * first render is never *wrong*, only less specific.
 *
 * One timer serves every subscriber, and it stops when the last one unmounts.
 */
const clock = {
  at: 0,
  listeners: new Set<() => void>(),
  timer: null as ReturnType<typeof setInterval> | null,

  subscribe(listener: () => void): () => void {
    clock.listeners.add(listener);
    if (clock.timer === null) {
      clock.at = Date.now();
      clock.timer = setInterval(() => {
        clock.at = Date.now();
        for (const l of clock.listeners) l();
      }, 60_000);
    }
    return () => {
      clock.listeners.delete(listener);
      if (clock.listeners.size === 0 && clock.timer !== null) {
        clearInterval(clock.timer);
        clock.timer = null;
      }
    };
  },
  snapshot: (): number => clock.at,
  serverSnapshot: (): number => 0,
};

/**
 * The current time in milliseconds, or **0 before the browser takes over**.
 * Callers must handle 0 — see the note above.
 */
export function useNow(): number {
  return useSyncExternalStore(clock.subscribe, clock.snapshot, clock.serverSnapshot);
}

/*
 * The same clock at one-second resolution, for the Lightning tab, where
 * "12 s ago" is the whole point. A separate store rather than a faster shared
 * one: a warning banner re-rendering sixty times a minute buys nothing, and
 * this timer only runs while something is subscribed to it. Same server
 * snapshot of 0, same rule for callers.
 */
const seconds = {
  at: 0,
  listeners: new Set<() => void>(),
  timer: null as ReturnType<typeof setInterval> | null,

  subscribe(listener: () => void): () => void {
    seconds.listeners.add(listener);
    if (seconds.timer === null) {
      seconds.at = Date.now();
      seconds.timer = setInterval(() => {
        seconds.at = Date.now();
        for (const l of seconds.listeners) l();
      }, 1000);
    }
    return () => {
      seconds.listeners.delete(listener);
      if (seconds.listeners.size === 0 && seconds.timer !== null) {
        clearInterval(seconds.timer);
        seconds.timer = null;
      }
    };
  },
  snapshot: (): number => seconds.at,
  serverSnapshot: (): number => 0,
};

/** The current time to the second, or **0 before the browser takes over**. */
export function useNowSeconds(): number {
  return useSyncExternalStore(seconds.subscribe, seconds.snapshot, seconds.serverSnapshot);
}
