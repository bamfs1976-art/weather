import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weather — powered by Vaisala Xweather",
  description:
    "Personal weather dashboard: current conditions, minute-by-minute nowcast, 48-hour and 10-day forecasts, the last 24 hours, historical archives, air quality and radar maps.",
};

export const viewport: Viewport = {
  themeColor: "#070d1b",
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
