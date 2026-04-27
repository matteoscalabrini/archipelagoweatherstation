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

function MissionClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const update = () =>
      setTime(new Date().toISOString().replace("T", " · ").slice(0, 22) + "Z");
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="mission-clock">{time}</span>;
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
  const status = error ? "error" : connected ? "online" : "standby";
  const activeSensors = displays.filter((d) => d?.online).length;

  return (
    <main>
      {/* HEADER */}
      <header className="mission-header">
        <div className="mission-id">
          <div className="mission-badge">
            <span className="badge-icon">◈</span>
          </div>
          <div>
            <div className="mission-eyebrow">AUTONOMOUS METEOROLOGICAL UNIT</div>
            <h1 className="mission-name">ARCHIPELAGO</h1>
            <div className="mission-sub">FIELD TELEMETRY · WEATHER ARRAY · UNIT-01</div>
          </div>
        </div>

        <div className="mission-status-panel">
          <MissionClock />
          <div className={`link-state ${status}`}>
            <span className={`status-dot ${status}`} />
            {error || (connected ? "ONLINE" : "STANDBY")}
          </div>
        </div>
      </header>

      {/* SCAN DIVIDER */}
      <div className="scan-line">
        <span className="scan-tick">◄</span>
        <div className="scan-bar" />
        <span className="scan-tick">►</span>
      </div>

      {/* TELEMETRY STATUS BAR */}
      <section className="telemetry-bar">
        <div className="tbar-item">
          <span className="tbar-label">SOLAR MODE</span>
          <span className="tbar-value">{(telemetry?.solarMode ?? "--").toString().toUpperCase()}</span>
        </div>
        <div className="tbar-item">
          <span className="tbar-label">LAST READING</span>
          <span className="tbar-value">{ageLabel(telemetry?.receivedAt)}</span>
        </div>
        <div className="tbar-item">
          <span className="tbar-label">BOARD ID</span>
          <span className="tbar-value">{telemetry?.board ?? "--"}</span>
        </div>
        <div className="tbar-item">
          <span className="tbar-label">ACTIVE SENSORS</span>
          <span className="tbar-value">{activeSensors} / {displays.length || "--"}</span>
        </div>
      </section>

      {/* SENSOR GRID */}
      <section className="sensor-grid" aria-label="Sensor telemetry">
        {Array.from({ length: 9 }).map((_, index) => {
          const display = displays[index];
          const secondary = display?.secondaryLabel
            ? `${display.secondaryLabel} ${formatValue(display.secondary, display.secondaryUnit)}`
            : formatValue(display?.secondary, display?.secondaryUnit);

          return (
            <article
              className={`sensor-tile ${display?.online ? "is-online" : "is-offline"}`}
              key={index}
            >
              <div className="tile-corner tl" />
              <div className="tile-corner tr" />
              <div className="tile-corner bl" />
              <div className="tile-corner br" />

              <header className="tile-header">
                <span className="tile-label">{display?.label ?? `CHANNEL ${index + 1}`}</span>
                <span className={`tile-status ${display?.online ? "online" : "offline"}`}>
                  <span className={`status-dot ${display?.online ? "online" : "offline"}`} />
                  {display?.online ? "LIVE" : "OFFLINE"}
                </span>
              </header>

              <div className="tile-value">{formatValue(display?.primary, display?.primaryUnit)}</div>
              <div className="tile-secondary">
                {secondary !== "--" ? secondary : <span className="no-data">NO DATA</span>}
              </div>

              <div className="tile-index">CH{String(index + 1).padStart(2, "0")}</div>
            </article>
          );
        })}
      </section>

      <footer className="mission-footer">
        <span>ARCHIPELAGO METEOROLOGICAL ARRAY · ALL SYSTEMS NOMINAL</span>
        <span>TELEMETRY v1.0 · ESP32 · VERCEL EDGE</span>
      </footer>
    </main>
  );
}
