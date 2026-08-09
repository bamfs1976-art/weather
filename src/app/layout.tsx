import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weather — powered by Vaisala Xweather",
  description:
    "Personal weather dashboard: current conditions, minute-by-minute nowcast, 48-hour and 10-day forecasts, the last 24 hours, historical archives, air quality and radar maps.",
  applicationName: "Weather",
  // Makes "Add to Home Screen" on iOS open without Safari chrome.
  appleWebApp: {
    capable: true,
    title: "Weather",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#141a26" },
  ],
  // viewportFit: cover lets the dark background run under the notch and home
  // indicator when launched from the iOS home screen.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

/*
 * Runs before first paint: applies a stored dark-mode choice to <html> so the
 * page never flashes light before React hydrates. Light is the default, so
 * doing nothing is the correct behaviour for a first-time visitor.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("wx:theme");if(t==="dark")document.documentElement.dataset.theme="dark";}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/*
          Inter for body, Inter Tight for headings and every numeric readout.
          Loaded by <link> rather than next/font because next/font fetches at
          build time, which fails on a build host with no route to Google; a
          link tag fetches in the visitor's browser instead. preconnect first so
          the two round trips overlap, and the CSS stack in globals.css falls
          back to the system face if the request never lands.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router head applies to every route; the rule targets pages/_document. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Inter+Tight:wght@300;400;500;600;700&display=swap"
        />
      </head>
      {/* .wx carries the whole theme — see globals.css */}
      <body className="wx">{children}</body>
    </html>
  );
}
