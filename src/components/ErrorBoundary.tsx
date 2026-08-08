"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Notice } from "./ui";

interface Props {
  /** Shown in the message so the user knows which card failed. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one bad panel from taking down the app.
 *
 * Without this, any render-time throw — an upstream returning a shape the
 * panel didn't expect, say — unmounts the entire tree and leaves a blank
 * page. Here it degrades to a message naming the panel and the error, which
 * is both survivable and diagnosable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the detail in the console for anyone actually debugging it.
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Notice tone="warn">
          <span className="font-medium">
            The {this.props.label} view hit an error and could not be shown.
          </span>{" "}
          The rest of the app is unaffected — try another tab, or reload.
          <span className="wx-dim mt-1 block font-mono text-xs">
            {this.state.error.message}
          </span>
        </Notice>
      );
    }
    return this.props.children;
  }
}
