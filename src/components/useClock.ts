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
