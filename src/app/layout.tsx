import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weather Station",
  description: "High-contrast live telemetry dashboard for the ESP32 weather station"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
