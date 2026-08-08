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
  themeColor: "#070d1b",
  // viewportFit: cover lets the dark background run under the notch and home
  // indicator when launched from the iOS home screen.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* .wx carries the whole theme — see globals.css */}
      <body className="wx">{children}</body>
    </html>
  );
}
