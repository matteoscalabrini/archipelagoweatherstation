import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARCHIPELAGO · FIELD STATION",
  description: "Autonomous meteorological unit — live field telemetry"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
