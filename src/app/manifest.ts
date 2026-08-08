import type { MetadataRoute } from "next";

/**
 * Web app manifest. Android/Chrome reads this for "Install app"; iOS Safari
 * ignores most of it and uses the <meta name="apple-mobile-web-app-*"> tags and
 * apple-icon.png that layout.tsx and the app directory provide instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Weather — Vaisala Xweather",
    short_name: "Weather",
    description:
      "Current conditions, nowcast, forecasts, history, air quality and radar.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#070d1b",
    theme_color: "#070d1b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
