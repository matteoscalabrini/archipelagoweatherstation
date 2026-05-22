import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archipelago Weather Station",
  description: "Live telemetry dashboard for the ESP32 weather station"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <span className="site-footer-brand">Archipelago Weather Station</span>
            <span className="site-footer-meta">Open source</span>
            <nav className="site-footer-links" aria-label="Project links">
              <a
                href="https://github.com/matteoscalabrini/archipelagoweatherstation"
                target="_blank"
                rel="noopener noreferrer"
              >
                Website code
              </a>
              <a
                href="https://github.com/matteoscalabrini/Wheather_station_01"
                target="_blank"
                rel="noopener noreferrer"
              >
                Firmware
              </a>
            </nav>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
