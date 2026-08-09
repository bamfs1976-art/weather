import type { MetadataRoute } from "next";

/**
 * Web app manifest. Android/Chrome reads this for "Install app"; iOS Safari
 * ignores most of it and uses the <meta name="apple-mobile-web-app-*"> tags and
 * apple-icon.png that layout.tsx and the app directory provide instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Swansea Weather",
    short_name: "Swansea Wx",
    description:
      "Weather, tides, rivers, air quality and radar for Swansea Bay — and anywhere else you search.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f2057",
    theme_color: "#0f2057",
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
