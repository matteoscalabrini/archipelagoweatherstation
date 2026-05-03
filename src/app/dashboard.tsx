"use client";

import { useEffect, useMemo, useState } from "react";
import type { WeatherStationTelemetry } from "@/lib/telemetry";

type LatestResponse = {
  success: boolean;
  connected: boolean;
  telemetry: WeatherStationTelemetry;
};

type HistoryResponse = {
  success: boolean;
  history: WeatherStationTelemetry[];
};

type Point = { t: number; v: number };

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

function uptime(ms?: number) {
  if (!ms || ms <= 0) return "--";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function solarLabel(mode?: string) {
  switch ((mode ?? "unknown").toLowerCase()) {
    case "sun":    return "Sun · charging";
    case "shadow": return "Shaded";
    case "dark":   return "Dark · battery";
    default:       return "Unknown";
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractSeries(history: WeatherStationTelemetry[], label: string): Point[] {
  const points: Point[] = [];
  for (const snap of history) {
    const display = snap.displays?.find(d => d?.label === label);
    const v = toNumber(display?.primary);
    if (v !== null && snap.receivedAt) {
      points.push({ t: new Date(snap.receivedAt).getTime(), v });
    }
  }
  return points;
}

function trendDelta(points: Point[], windowMs = 3_600_000): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = last.t - windowMs;
  let earlier: Point = points[0];
  for (const p of points) {
    if (p.t <= target) earlier = p;
    else break;
  }
  if (earlier === last) return null;
  return last.v - earlier.v;
}

function Sparkline({ points, live }: { points: Point[]; live?: boolean }) {
  if (points.length < 2) return <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" />;
  const W = 100;
  const H = 24;
  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const path = points
    .map((p, i) => {
      const x = ((p.t - xMin) / xRange) * W;
      const y = H - ((p.v - yMin) / yRange) * (H - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={`spark ${live ? "live" : ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Dashboard() {
  const [telemetry, setTelemetry] = useState<WeatherStationTelemetry | null>(null);
  const [history, setHistory] = useState<WeatherStationTelemetry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [latestRes, historyRes] = await Promise.all([
          fetch("/api/latest", { cache: "no-store" }),
          fetch("/api/history?limit=200", { cache: "no-store" })
        ]);
        const latest = (await latestRes.json()) as LatestResponse;
        const hist = (await historyRes.json()) as HistoryResponse;
        if (cancelled) return;
        setTelemetry(latest.telemetry);
        setConnected(latest.connected);
        setHistory(hist.history ?? []);
        setError("");
      } catch {
        if (!cancelled) setError("connection lost");
      }
    }

    load();
    const t = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const displays = telemetry?.displays ?? [];
  const status = error ? "error" : connected ? "online" : "waiting";

  // History is stored newest-first; reverse for chronological left-to-right plotting.
  const orderedHistory = useMemo(() => [...history].reverse(), [history]);

  const sensorEntries = telemetry?.sensors ? Object.entries(telemetry.sensors) : [];

  return (
    <main>
      <nav className="topbar">
        <span className="brand">Archipelago</span>
        <div className="admin-top-actions">
          <a className="toplink" href="/admin">Admin</a>
          <span className={`status-pill ${status}`}>
            {error || (connected ? "Online" : "Waiting")}
          </span>
        </div>
      </nav>

      <div className="page-title">
        <h1>Weather <em>Station</em></h1>
      </div>

      <div className="meta-row">
        <span>Mode &nbsp;<strong>{solarLabel(telemetry?.solarMode)}</strong></span>
        <span>Last &nbsp;<strong>{age(telemetry?.receivedAt)}</strong></span>
        <span>Board &nbsp;<strong>{telemetry?.board ?? "--"}</strong></span>
        <span>Active &nbsp;<strong>{displays.filter(d => d?.online).length} / {displays.length || "--"}</strong></span>
        <span>Samples &nbsp;<strong>{history.length}</strong></span>
      </div>

      <section className="grid" aria-label="Sensor readings">
        {Array.from({ length: 9 }).map((_, i) => {
          const d = displays[i];
          const series = d?.label ? extractSeries(orderedHistory, d.label) : [];
          const delta = trendDelta(series);
          const secondary = d?.secondaryLabel
            ? `${d.secondaryLabel} ${fmt(d.secondary, d.secondaryUnit)}`
            : fmt(d?.secondary, d?.secondaryUnit);
          const arrow = delta === null ? "—" : delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
          const deltaClass = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
          const deltaText =
            delta === null
              ? "no trend"
              : `${arrow} ${Math.abs(delta).toFixed(2)}${d?.primaryUnit ? " " + d.primaryUnit : ""} /1h`;

          return (
            <article className="tile" key={i}>
              <div className="tile-top">
                <div className={`tile-dot ${d?.online ? "live" : ""}`} />
                <span className="tile-label">{d?.label ?? `Channel ${i + 1}`}</span>
              </div>
              <div className={`tile-value ${d?.online ? "" : "dim"}`}>
                {fmt(d?.primary, d?.primaryUnit)}
              </div>
              <div className="tile-trend">
                <span className={`delta ${deltaClass}`}>{deltaText}</span>
                <Sparkline points={series} live={d?.online} />
              </div>
              {secondary !== "--" && <div className="tile-secondary">{secondary}</div>}
            </article>
          );
        })}
      </section>

      <section className="health" aria-label="System health">
        <div className="health-title">System Health</div>
        <div className="health-grid">
          <div className="health-cell">
            <div className="health-label">Solar Mode</div>
            <div className="health-value">{solarLabel(telemetry?.solarMode)}</div>
          </div>
          <div className="health-cell">
            <div className="health-label">Uptime</div>
            <div className="health-value">{uptime(telemetry?.uptimeMs)}</div>
          </div>
          <div className="health-cell">
            <div className="health-label">Network</div>
            <div className="health-value">
              {telemetry?.wifi?.sta ? "Station" : telemetry?.wifi?.ap ? "Access Point" : "Offline"}
              {telemetry?.wifi?.ip && <span className="health-sub"> · {telemetry.wifi.ip}</span>}
            </div>
          </div>
          <div className="health-cell">
            <div className="health-label">Last Post</div>
            <div className="health-value">
              <span className={telemetry?.wifi?.lastPostCode === 200 ? "ok-text" : "dim-text"}>
                {telemetry?.wifi?.lastPostCode ?? "--"}
              </span>
              {telemetry?.wifi?.lastPostMessage && (
                <span className="health-sub"> · {telemetry.wifi.lastPostMessage}</span>
              )}
            </div>
          </div>
        </div>

        {sensorEntries.length > 0 && (
          <div className="sensor-row">
            {sensorEntries.map(([name, ok]) => (
              <span key={name} className={`sensor-chip ${ok ? "ok" : "bad"}`}>
                <span className={`tile-dot ${ok ? "live" : ""}`} />
                {name}
              </span>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
