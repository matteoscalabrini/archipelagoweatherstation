"use client";

import { useEffect, useState } from "react";
import type { WeatherStationTelemetry } from "@/lib/telemetry";

type ApiResponse = {
  success: boolean;
  connected: boolean;
  telemetry: WeatherStationTelemetry;
};

function formatValue(value: number | string | null | undefined, unit?: string) {
  if (value === null || value === undefined || value === "") return "--";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function ageLabel(receivedAt?: string) {
  if (!receivedAt) return "NO DATA";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(receivedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s AGO`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m AGO`;
  return `${Math.floor(minutes / 60)}h AGO`;
}

export default function Dashboard() {
  const [telemetry, setTelemetry] = useState<WeatherStationTelemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/latest", { cache: "no-store" });
        const data = (await response.json()) as ApiResponse;
        if (cancelled) return;
        setTelemetry(data.telemetry);
        setConnected(data.connected);
        setError("");
      } catch {
        if (!cancelled) setError("LINK LOST");
      }
    }

    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const displays = telemetry?.displays ?? [];

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">REMOTE LIVE</p>
          <h1>Weather Station</h1>
        </div>
        <div className="link-state">{error || (connected ? "ONLINE" : "WAITING")}</div>
      </header>

      <section className="status">
        <span>MODE {(telemetry?.solarMode ?? "--").toString().toUpperCase()}</span>
        <span>LAST {ageLabel(telemetry?.receivedAt)}</span>
        <span>BOARD {telemetry?.board ?? "--"}</span>
      </section>

      <section className="grid" aria-label="Weather station displays">
        {Array.from({ length: 9 }).map((_, index) => {
          const display = displays[index];
          const secondary = display?.secondaryLabel
            ? `${display.secondaryLabel} ${formatValue(display.secondary, display.secondaryUnit)}`
            : formatValue(display?.secondary, display?.secondaryUnit);

          return (
            <article className="tile" key={index}>
              <header>
                <span>{display?.label ?? `DISPLAY ${index}`}</span>
                <span className={display?.online ? "online" : "offline"}>
                  {display?.online ? "LIVE" : "OFF"}
                </span>
              </header>
              <div className="value">{formatValue(display?.primary, display?.primaryUnit)}</div>
              <div className="secondary">{secondary !== "--" ? secondary : ""}</div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
