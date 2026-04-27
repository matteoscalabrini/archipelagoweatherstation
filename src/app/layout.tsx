import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archipelago Weather Station",
  description: "Live telemetry dashboard for the ESP32 weather station"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
