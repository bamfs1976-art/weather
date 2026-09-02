"use client";

import { useEffect, useRef, useState } from "react";
import {
  HOTSPOT_WINDOW_MS,
  LIGHTNING_HOSTS,
  LIGHTNING_SUBSCRIBE,
  parseStoredStrikes,
  parseStrike,
  pruneStrikes,
  type Strike,
} from "@/lib/lightning";

/**
 * The Blitzortung socket, as a hook.
 *
 * The feed is worldwide and unfiltered — tens of strikes a second in a busy
 * hour — so the message handler does the cheapest possible thing: decode,
 * measure the distance, and either drop the strike or push it onto a ref.
 * A one-second timer flushes the ref into React state. Setting state per
 * message would re-render a map of several hundred dots up to fifty times a
 * second, which is what makes phones warm.
 *
 * Nothing here runs on the server. The first render has no strikes and a
 * status of "connecting", which is what the browser also shows for its first
 * few hundred milliseconds, so there is nothing to mismatch.
 *
 * Strikes inside the keep radius are persisted to localStorage — the hotspot
 * view is only worth having if a page reopened after a storm still knows the
 * storm happened. Everything is keyed on the place, so a change of location
 * starts from an empty sky rather than plotting Swansea's strikes over Leeds.
 */

export type FeedStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface FeedStats {
  /** Raw socket messages received since the tab opened. */
  messages: number;
  /** Messages that decoded to a strike anywhere on Earth. */
  decoded: number;
  /** Messages neither JSON nor LZW-JSON — a wrong assumption about the shape. */
  undecodable: number;
  /** Strikes kept because they were inside the keep radius. */
  kept: number;
  /** Strikes worldwide in the last full minute, so a quiet sky is provably quiet. */
  worldPerMinute: number;
  /** Epoch ms of the last message of any kind, 0 if none yet. */
  lastMessageAt: number;
  /** Which host is connected or being tried. */
  host: string | null;
  attempts: number;
}

const STORAGE_KEY = "wx:lightning";
const FLUSH_MS = 1000;
const PERSIST_MS = 15_000;
/** Give a host this long to send *anything* before trying the next. */
const SILENCE_MS = 45_000;

export function useLightningFeed(lat: number, lon: number, enabled = true) {
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [stats, setStats] = useState<FeedStats>({
    messages: 0,
    decoded: 0,
    undecodable: 0,
    kept: 0,
    worldPerMinute: 0,
    lastMessageAt: 0,
    host: null,
    attempts: 0,
  });
  /**
   * Strikes that arrived in the last flush — what the alarm should consider.
   * Stamped with the place they belong to, so a batch from the previous
   * location cannot ring the alarm for the next one in the render between
   * the place changing and the socket reconnecting.
   */
  const pending = useRef<Strike[]>([]);
  const [fresh, setFresh] = useState<{ key: string; strikes: Strike[] }>({
    key: "",
    strikes: EMPTY,
  });
  const key = keyFor(lat, lon);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let hostIndex = Math.floor(Math.random() * LIGHTNING_HOSTS.length);
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const counters = {
      messages: 0,
      decoded: 0,
      undecodable: 0,
      kept: 0,
      lastMessageAt: 0,
      worldThisMinute: 0,
      worldLastMinute: 0,
      minuteStart: Date.now(),
    };

    /*
     * Restore what the last visit saw, pruned to the hotspot window. It
     * reaches React state through the flush timer below rather than being set
     * here, so a restore is one render on the next tick rather than a
     * cascading one inside the effect.
     */
    let all: Strike[] = [];
    try {
      all = pruneStrikes(parseStoredStrikes(localStorage.getItem(key)), Date.now());
    } catch {
      all = [];
    }
    let dirty = true;
    pending.current = [];

    const armSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        /* A socket that opened but never speaks is as dead as one that refused. */
        socket?.close();
      }, SILENCE_MS);
    };

    const connect = () => {
      if (cancelled) return;
      const host = LIGHTNING_HOSTS[hostIndex % LIGHTNING_HOSTS.length];
      attempts += 1;
      setStatus(attempts === 1 ? "connecting" : "reconnecting");
      setStats((s) => ({ ...s, host, attempts }));

      let ws: WebSocket;
      try {
        /* A browser with no WebSocket lands here too, and ends up "offline". */
        ws = new WebSocket(host);
      } catch {
        hostIndex += 1;
        scheduleReconnect();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (cancelled) return;
        try {
          ws.send(LIGHTNING_SUBSCRIBE);
        } catch {
          /* the close handler will reconnect */
        }
        setStatus("live");
        armSilence();
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        const now = Date.now();
        counters.messages += 1;
        counters.lastMessageAt = now;
        armSilence();
        const text = typeof event.data === "string" ? event.data : "";
        const { strike, decoded } = parseStrike(text, lat, lon);
        if (!decoded) {
          counters.undecodable += 1;
          return;
        }
        counters.decoded += 1;
        counters.worldThisMinute += 1;
        if (strike) {
          counters.kept += 1;
          pending.current.push(strike);
        }
      };

      ws.onerror = () => {
        /* onclose follows; nothing to do that it will not do. */
      };

      ws.onclose = () => {
        if (cancelled) return;
        socket = null;
        hostIndex += 1;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      setStatus(attempts >= LIGHTNING_HOSTS.length * 2 ? "offline" : "reconnecting");
      /* Back off up to a minute; every host having refused is not a reason to hammer them. */
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(6, attempts));
      reconnectTimer = setTimeout(connect, delay);
    };

    const flush = setInterval(() => {
      const now = Date.now();
      if (now - counters.minuteStart >= 60_000) {
        counters.worldLastMinute = counters.worldThisMinute;
        counters.worldThisMinute = 0;
        counters.minuteStart = now;
      }
      setStats((s) => ({
        ...s,
        messages: counters.messages,
        decoded: counters.decoded,
        undecodable: counters.undecodable,
        kept: counters.kept,
        worldPerMinute: counters.worldLastMinute,
        lastMessageAt: counters.lastMessageAt,
      }));
      if (pending.current.length === 0) {
        /* Still prune, so a dot ages off the map on time. */
        if (dirty || (all.length && now - all[0].time > HOTSPOT_WINDOW_MS)) {
          all = pruneStrikes(all, now);
          setStrikes(all);
          dirty = false;
        }
        return;
      }
      const batch = pending.current;
      pending.current = [];
      all = pruneStrikes(all.concat(batch), now);
      setStrikes(all);
      setFresh({ key, strikes: batch });
      dirty = false;
    }, FLUSH_MS);

    const persist = setInterval(() => {
      try {
        localStorage.setItem(key, JSON.stringify(all));
      } catch {
        /* storage full or unavailable — the live view still works */
      }
    }, PERSIST_MS);

    connect();

    return () => {
      cancelled = true;
      clearInterval(flush);
      clearInterval(persist);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      try {
        localStorage.setItem(key, JSON.stringify(all));
      } catch {
        /* non-fatal */
      }
      socket?.close();
    };
  }, [key, lat, lon, enabled]);

  return {
    strikes,
    status,
    stats,
    fresh: fresh.key === key ? fresh.strikes : EMPTY,
  };
}

const EMPTY: Strike[] = [];

function keyFor(lat: number, lon: number): string {
  return `${STORAGE_KEY}:${lat.toFixed(3)},${lon.toFixed(3)}`;
}
