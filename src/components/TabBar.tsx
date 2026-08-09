"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TabOption {
  id: string;
  label: string;
}

/**
 * The tab strip: horizontally scrollable, sticky under the header, with a pill
 * that slides to the active tab.
 *
 * The pill is measured from the DOM rather than computed from index and width,
 * because the tabs are text-sized and so are all different widths — and because
 * the label font can load after first paint, which changes those widths under
 * us. A ResizeObserver on the row re-measures whenever that happens.
 */
export function TabBar({
  tabs,
  value,
  onChange,
  ariaLabel = "Sections",
}: {
  tabs: TabOption[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [stuck, setStuck] = useState(false);

  const measure = useCallback(() => {
    const active = buttons.current.get(value);
    const scroller = scrollRef.current;
    if (!active || !scroller) return;
    setPill({ x: active.offsetLeft, w: active.offsetWidth });
  }, [value]);

  // Layout effect so the pill is in place on the frame the tab changes, not one
  // frame later — otherwise it visibly jumps from the origin on first render.
  useLayoutEffect(measure, [measure, tabs]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const node of buttons.current.values()) observer.observe(node);
    // Fonts can land after first paint and change every tab's width.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [measure]);

  // Keep the selected tab in view when it changes from outside the bar.
  useEffect(() => {
    buttons.current.get(value)?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    });
  }, [value]);

  // A one-pixel sentinel above the bar tells us when it has stuck, which is
  // cheaper and steadier than watching scroll position.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;top:-1px;height:1px;width:1px;";
    wrap.parentElement?.insertBefore(sentinel, wrap);
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, []);

  /** Left/Right move between tabs, Home/End jump to the ends — the ARIA pattern. */
  function onKeyDown(event: React.KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === value);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    buttons.current.get(tabs[next].id)?.focus();
  }

  return (
    <div ref={wrapRef} className="wx-tabs-wrap" data-stuck={stuck}>
      <div
        ref={scrollRef}
        className="wx-tabs-scroll"
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
      >
        {pill && (
          <span
            className="wx-tab-pill"
            aria-hidden
            style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
          />
        )}
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) buttons.current.set(tab.id, node);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`wx-tab-${tab.id}`}
            aria-selected={value === tab.id}
            aria-controls={`wx-panel-${tab.id}`}
            tabIndex={value === tab.id ? 0 : -1}
            className="wx-tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
