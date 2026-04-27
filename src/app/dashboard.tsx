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
  if (!receivedAt) return "--";
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
      <nav className="topbar">
        <span className="brand">Archipelago</span>
        <span className={`status-pill ${status}`}>
          {error || (connected ? "Online" : "Waiting")}
        </span>
      </nav>

      <div className="page-title">
        <h1>Weather <em>Station</em></h1>
      </div>

      <div className="meta-row">
        <span>Mode &nbsp;<strong>{(telemetry?.solarMode ?? "--").toString()}</strong></span>
        <span>Last &nbsp;<strong>{age(telemetry?.receivedAt)}</strong></span>
        <span>Board &nbsp;<strong>{telemetry?.board ?? "--"}</strong></span>
        <span>Active &nbsp;<strong>{displays.filter(d => d?.online).length} / {displays.length || "--"}</strong></span>
      </div>

      <section className="grid" aria-label="Sensor readings">
        {Array.from({ length: 9 }).map((_, i) => {
          const d = displays[i];
          const secondary = d?.secondaryLabel
            ? `${d.secondaryLabel} ${fmt(d.secondary, d.secondaryUnit)}`
            : fmt(d?.secondary, d?.secondaryUnit);

          return (
            <article className="tile" key={i}>
              <div className="tile-top">
                <div className={`tile-dot ${d?.online ? "live" : ""}`} />
                <span className="tile-label">{d?.label ?? `Channel ${i + 1}`}</span>
              </div>
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
