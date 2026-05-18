"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deriveWeatherInsights } from "@/lib/insights";
import type { DisplayReading, WeatherStationTelemetry } from "@/lib/telemetry";

/* ==========================================================================
   HISTORY FILE LEGEND
   --------------------------------------------------------------------------
   1) API and chart data types
   2) Formatting helpers
   3) Series/stat builders
   4) History chart renderer
   5) Main History component (fetch, derive, render)
   ========================================================================== */

/* 1) API and chart data types. */
type HistoryResponse = {
  success: boolean;
  history: WeatherStationTelemetry[];
};

type Point = {
  t: number;
  v: number;
};

type Series = {
  key: string;
  label: string;
  unit: string;
  online: boolean;
  points: Point[];
};

type RangeKey = "6h" | "24h" | "7d" | "all";

const ranges: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "6h", label: "6H", ms: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "24H", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: null }
];

/* 2) Formatting helpers. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function displayKey(display: DisplayReading, index: number) {
  return `${display.label || `Channel ${index + 1}`}::${display.primaryUnit ?? ""}`;
}

function displayLabel(display: DisplayReading, index: number) {
  return display.label || `Channel ${index + 1}`;
}

function fmt(value: number | null | undefined, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function fmtDelta(value: number | null | undefined, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${fmt(Math.abs(value), unit)}`;
}

function age(receivedAt?: string) {
  if (!receivedAt) return "--";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(receivedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeLabel(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateTimeLabel(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function spanLabel(points: Point[]) {
  if (points.length < 2) return "--";
  return `${dateTimeLabel(points[0].t)} - ${dateTimeLabel(points[points.length - 1].t)}`;
}

function stats(points: Point[]) {
  if (points.length === 0) {
    return { latest: null, min: null, max: null, avg: null, delta: null };
  }
  const values = points.map(point => point.v);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    latest: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: total / values.length,
    delta: values.length > 1 ? values[values.length - 1] - values[0] : null
  };
}

function buildSeries(history: WeatherStationTelemetry[]): Series[] {
  const ordered = [...history].reverse();
  const map = new Map<string, Series>();

  for (const snapshot of ordered) {
    const t = snapshot.receivedAt ? new Date(snapshot.receivedAt).getTime() : NaN;
    if (!Number.isFinite(t)) continue;

    snapshot.displays?.forEach((display, index) => {
      const value = toNumber(display.primary);
      if (value === null) return;

      const key = displayKey(display, index);
      const current = map.get(key) ?? {
        key,
        label: displayLabel(display, index),
        unit: display.primaryUnit ?? "",
        online: Boolean(display.online),
        points: []
      };
      current.online = Boolean(display.online);
      current.points.push({ t, v: value });
      map.set(key, current);
    });
  }

  return [...map.values()].filter(series => series.points.length > 0);
}

function filterHistory(history: WeatherStationTelemetry[], range: RangeKey) {
  const rangeMs = ranges.find(item => item.key === range)?.ms;
  if (!rangeMs) return history;
  const since = Date.now() - rangeMs;
  return history.filter(snapshot => {
    const t = snapshot.receivedAt ? new Date(snapshot.receivedAt).getTime() : NaN;
    return Number.isFinite(t) && t >= since;
  });
}

function filterPoints(points: Point[], range: RangeKey) {
  const rangeMs = ranges.find(item => item.key === range)?.ms;
  if (!rangeMs) return points;
  const since = Date.now() - rangeMs;
  return points.filter(point => point.t >= since);
}

function solarLabel(mode?: string) {
  switch ((mode ?? "unknown").toLowerCase()) {
    case "sun": return "Sun";
    case "shadow": return "Shadow";
    case "dark": return "Dark";
    default: return "Unknown";
  }
}

function healthTone(latest?: WeatherStationTelemetry) {
  if (!latest?.receivedAt) return "waiting";
  const ageMs = Date.now() - new Date(latest.receivedAt).getTime();
  if (ageMs > 15 * 60 * 1000) return "error";
  if (ageMs > 3 * 60 * 1000) return "waiting";
  return "online";
}

/* 3) Series/stat builders. */
function buildReport(series: Series | undefined, points: Point[], sampleCount: number) {
  if (!series || points.length < 2) return "Waiting for enough numeric telemetry to describe this window.";
  const s = stats(points);
  const direction = s.delta === null || Math.abs(s.delta) < 0.001
    ? "held steady"
    : s.delta > 0
      ? "rose"
      : "fell";
  return `${series.label} ${direction} ${fmt(Math.abs(s.delta ?? 0), series.unit)} across ${sampleCount} samples. Range ${fmt(s.min, series.unit)} to ${fmt(s.max, series.unit)}.`;
}

/* 4) History chart renderer (display-inspired chart panel) with cursor tracking. */
function HistoryChart({ points, unit }: { points: Point[]; unit: string }) {
  const width = 760;
  const height = 300;
  const pad = { top: 18, right: 18, bottom: 34, left: 52 };
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<{ svgX: number; svgY: number; point: Point; nearestIndex: number } | null>(null);

  if (points.length < 2) {
    return (
      <div className="history-series-empty">
        Waiting for enough samples.
      </div>
    );
  }

  const xs = points.map(point => point.t);
  const ys = points.map(point => point.v);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const yPad = (yMaxRaw - yMinRaw || Math.max(1, Math.abs(yMaxRaw))) * 0.12;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;

  const x = (value: number) => pad.left + ((value - xMin) / xRange) * innerWidth;
  const y = (value: number) => pad.top + (1 - (value - yMin) / yRange) * innerHeight;
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.t).toFixed(1)},${y(point.v).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${x(points[points.length - 1].t).toFixed(1)},${height - pad.bottom} L${x(points[0].t).toFixed(1)},${height - pad.bottom} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => yMin + (yMax - yMin) * ratio);
  const xTicks = [0, 0.5, 1].map(ratio => xMin + (xMax - xMin) * ratio);
  const last = points[points.length - 1];

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    // Clamp to chart area
    const clampedX = Math.max(pad.left, Math.min(width - pad.right, svgX));
    // Convert SVG X back to data time
    const dataTime = xMin + ((clampedX - pad.left) / innerWidth) * xRange;
    // Find nearest point
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].t - dataTime);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const nearest = points[nearestIdx];
    setCursor({
      svgX: x(nearest.t),
      svgY: y(nearest.v),
      point: nearest,
      nearestIndex: nearestIdx
    });
  }

  function handlePointerLeave() {
    setCursor(null);
  }

  return (
    <div className="history-chart-container">
      <svg
        ref={svgRef}
        className="history-series-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Selected sensor history chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{ touchAction: "none" }}
      >
        {yTicks.map(value => (
          <g key={value}>
            <line className="history-series-grid-line" x1={pad.left} y1={y(value)} x2={width - pad.right} y2={y(value)} />
            <text className="history-series-axis-label" x={pad.left - 10} y={y(value) + 4} textAnchor="end">
              {fmt(value, unit)}
            </text>
          </g>
        ))}
        {xTicks.map(value => (
          <text className="history-series-axis-label" key={value} x={x(value)} y={height - 10} textAnchor="middle">
            {timeLabel(value)}
          </text>
        ))}
        <path className="history-series-area" d={area} />
        <path className="history-series-line" d={path} />
        <rect className="history-series-last-dot" x={x(last.t) - 2.5} y={y(last.v) - 2.5} width="5" height="5" />

        {/* Cursor crosshair + tooltip */}
        {cursor && (
          <>
            {/* Vertical crosshair line */}
            <line
              className="history-chart-crosshair"
              x1={cursor.svgX}
              y1={pad.top}
              x2={cursor.svgX}
              y2={height - pad.bottom}
            />
            {/* Horizontal crosshair line */}
            <line
              className="history-chart-crosshair"
              x1={pad.left}
              y1={cursor.svgY}
              x2={width - pad.right}
              y2={cursor.svgY}
            />
            {/* Dot on the data point */}
            <circle
              className="history-chart-cursor-dot"
              cx={cursor.svgX}
              cy={cursor.svgY}
              r={4}
            />
            {/* Tooltip background */}
            <rect
              className="history-chart-tooltip-bg"
              x={cursor.svgX + 8 > width - pad.right - 120 ? cursor.svgX - 128 : cursor.svgX + 8}
              y={Math.max(pad.top, cursor.svgY - 32)}
              width={120}
              height={28}
              rx={3}
            />
            {/* Tooltip text: value */}
            <text
              className="history-chart-tooltip-text"
              x={cursor.svgX + 8 > width - pad.right - 120 ? cursor.svgX - 120 : cursor.svgX + 16}
              y={Math.max(pad.top + 12, cursor.svgY - 14)}
            >
              {fmt(cursor.point.v, unit)}
            </text>
            {/* Tooltip text: time */}
            <text
              className="history-chart-tooltip-time"
              x={cursor.svgX + 8 > width - pad.right - 120 ? cursor.svgX - 120 : cursor.svgX + 16}
              y={Math.max(pad.top + 24, cursor.svgY - 2)}
            >
              {dateTimeLabel(cursor.point.t)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/* 5) Main history page component. */
export default function HistoryClient() {
  const [history, setHistory] = useState<WeatherStationTelemetry[]>([]);
  const [range, setRange] = useState<RangeKey>("24h");
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/history?limit=10080", { cache: "no-store" });
        const json = await res.json() as HistoryResponse;
        if (cancelled) return;
        setHistory(json.history ?? []);
        setError("");
      } catch {
        if (!cancelled) setError("history unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    // Refresh history every 30 seconds to keep trend context up to date.
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const series = useMemo(() => buildSeries(history), [history]);
  const selected = series.find(item => item.key === selectedKey) ?? series[0];
  const points = selected ? filterPoints(selected.points, range) : [];
  const windowHistory = useMemo(() => filterHistory(history, range), [history, range]);
  const latest = history[0];
  const selectedStats = stats(points);
  const insights = useMemo(() => deriveWeatherInsights(latest, windowHistory), [latest, windowHistory]);
  const activeDisplays = latest?.displays?.filter(display => display.online).length ?? 0;
  const totalDisplays = latest?.displays?.length ?? 0;
  const sensorEntries = latest?.sensors ? Object.entries(latest.sensors) : [];
  const failedSensors = sensorEntries.filter(([, ok]) => !ok).length;
  const status = error ? "error" : loading ? "waiting" : healthTone(latest);
  const statusText = error || (
    loading ? "Loading" :
    status === "online" ? "Live" :
    status === "error" ? "Stale" :
    "Waiting"
  );

  useEffect(() => {
    if (!selectedKey && series[0]) setSelectedKey(series[0].key);
  }, [selectedKey, series]);

  return (
    <main className="history-lab-page station-dashboard">
      {/* Header: same language as dashboard, with history-specific title. */}
      <nav className="station-header history-lab-header">
        <div className="station-brand-stack">
          <a className="brand station-brand-word" href="/">Archipelago</a>
          <h1>
            <em>History Lab</em>
          </h1>
        </div>
        <div className="station-header-actions">
          <a className="station-nav-link" href="/">Dashboard</a>
          <a className="station-nav-link" href="/admin">Admin</a>
          <span className={`station-status ${status}`}>
            {statusText}
          </span>
        </div>
      </nav>

      {/* Toolbar: time window selector. */}
      <div className="history-lab-toolbar">
        <div className="history-range-selector" aria-label="History range">
          {ranges.map(item => (
            <button
              className={item.key === range ? "active" : ""}
              key={item.key}
              type="button"
              onClick={() => setRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Meta strip: context for selected time window and payload size. */}
      <div className="station-meta-strip history-meta-strip">
        <span>Last <strong>{age(latest?.receivedAt)}</strong></span>
        <span>Window <strong>{spanLabel(points)}</strong></span>
        <span>Samples <strong>{windowHistory.length}</strong></span>
        <span>Series <strong>{series.length || "--"}</strong></span>
      </div>

      {/* Main board: chart panel + station insight panel. */}
      <section className="history-lab-board">
        <div className="history-lab-panel history-chart-panel">
          <div className="history-panel-header">
            <div>
              <h2>{selected?.label ?? "No numeric series"}</h2>
              <p>{selected ? `${points.length} plotted samples` : "Waiting for display telemetry"}</p>
            </div>
            <span className={`history-series-status ${selected?.online ? "online" : ""}`}>
              {selected?.online ? "Online" : "Idle"}
            </span>
          </div>

          <div className="history-series-tabs" aria-label="Sensor series">
            {series.map(item => (
              <button
                className={item.key === selected?.key ? "active" : ""}
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <HistoryChart points={points} unit={selected?.unit ?? ""} />
        </div>

        <aside className="history-lab-panel history-insight-panel">
          <div className="history-panel-header">
            <div>
              <h2>Station</h2>
              <p>{latest?.board ?? "Weather Station"}</p>
            </div>
          </div>
          <div className="history-station-list">
            <div>
              <span>Mode</span>
              <strong>{solarLabel(latest?.solarMode)}</strong>
            </div>
            <div>
              <span>Displays</span>
              <strong>{activeDisplays} / {totalDisplays || "--"}</strong>
            </div>
            <div>
              <span>Sensors</span>
              <strong>{failedSensors === 0 ? "Clear" : `${failedSensors} flagged`}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>{latest?.wifi?.sta ? "Station" : latest?.wifi?.ap ? "Access Point" : "Offline"}</strong>
            </div>
          </div>
          <div className="history-derived-grid">
            {insights.values.slice(0, 4).map(item => (
              <div className={item.tone ?? ""} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p className="history-lab-report">{insights.summary} {buildReport(selected, points, windowHistory.length)}</p>
        </aside>
      </section>

      {/* Focus stats: selected series key numbers. */}
      <section className="history-selected-stat-grid" aria-label="Selected series statistics">
        <article className="history-selected-stat">
          <span>Latest</span>
          <strong>{fmt(selectedStats.latest, selected?.unit)}</strong>
        </article>
        <article className="history-selected-stat">
          <span>Minimum</span>
          <strong>{fmt(selectedStats.min, selected?.unit)}</strong>
        </article>
        <article className="history-selected-stat">
          <span>Average</span>
          <strong>{fmt(selectedStats.avg, selected?.unit)}</strong>
        </article>
        <article className="history-selected-stat">
          <span>Maximum</span>
          <strong>{fmt(selectedStats.max, selected?.unit)}</strong>
        </article>
        <article className={`history-selected-stat ${selectedStats.delta && selectedStats.delta < 0 ? "down" : selectedStats.delta && selectedStats.delta > 0 ? "up" : ""}`}>
          <span>Delta</span>
          <strong>{fmtDelta(selectedStats.delta, selected?.unit)}</strong>
        </article>
      </section>

      {/* All-series matrix: quick compare cards for each channel. */}
      <section className="history-series-summary-grid" aria-label="All series summary">
        {series.map(item => {
          const itemPoints = filterPoints(item.points, range);
          const itemStats = stats(itemPoints);
          return (
            <article className="history-series-card" key={item.key}>
              <div className="oled-panel-head">
                <span className={`oled-status-pixel ${item.online ? "live" : ""}`} />
                <span className="oled-panel-label">{item.label}</span>
              </div>
              <div className="history-series-card-value">{fmt(itemStats.latest, item.unit)}</div>
              <div className="history-series-card-meta">
                <span>{fmt(itemStats.min, item.unit)}</span>
                <span>{fmtDelta(itemStats.delta, item.unit)}</span>
                <span>{fmt(itemStats.max, item.unit)}</span>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
