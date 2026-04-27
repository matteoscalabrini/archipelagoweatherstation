"use client";

import { useEffect, useState } from "react";
import type { WeatherStationTelemetry } from "@/lib/telemetry";

type ApiResponse = {
  success: boolean;
  connected: boolean;
  telemetry: WeatherStationTelemetry;
};

function fmt(value: number | string | null | undefined, unit?: string) {
  if (value === null || value === undefined || value === "") return "--";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function age(receivedAt?: string) {
  if (!receivedAt) return "no data";
  const s = Math.max(0, Math.floor((Date.now() - new Date(receivedAt).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function Dashboard() {
  const [telemetry, setTelemetry] = useState<WeatherStationTelemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/latest", { cache: "no-store" });
        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setTelemetry(data.telemetry);
        setConnected(data.connected);
        setError("");
      } catch {
        if (!cancelled) setError("connection lost");
      }
    }

    load();
    const t = window.setInterval(load, 10000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

  const displays = telemetry?.displays ?? [];
  const status = error ? "error" : connected ? "online" : "waiting";

  return (
    <main>
      <header className="top">
        <h1>Archipelago Weather Station</h1>
        <span className={`tag ${status === "online" ? "online" : status === "error" ? "error" : ""}`}>
          {error || status}
        </span>
      </header>

      <div className="bar">
        <span>MODE&nbsp; <strong>{(telemetry?.solarMode ?? "--").toString().toUpperCase()}</strong></span>
        <span>LAST&nbsp; <strong>{age(telemetry?.receivedAt)}</strong></span>
        <span>BOARD&nbsp;<strong>{telemetry?.board ?? "--"}</strong></span>
      </div>

      <section className="grid" aria-label="Sensor readings">
        {Array.from({ length: 9 }).map((_, i) => {
          const d = displays[i];
          const secondary = d?.secondaryLabel
            ? `${d.secondaryLabel} ${fmt(d.secondary, d.secondaryUnit)}`
            : fmt(d?.secondary, d?.secondaryUnit);

          return (
            <article className={`tile ${d?.online ? "live" : ""}`} key={i}>
              <div className="tile-label">{d?.label ?? `Channel ${i + 1}`}</div>
              <div className={`tile-value ${d?.online ? "" : "dim"}`}>
                {fmt(d?.primary, d?.primaryUnit)}
              </div>
              {secondary !== "--" && (
                <div className="tile-secondary">{secondary}</div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
