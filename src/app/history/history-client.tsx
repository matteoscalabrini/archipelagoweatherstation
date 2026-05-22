"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { weatherEmoji } from "@/lib/insights";
import type { DisplayReading, WeatherStationTelemetry } from "@/lib/telemetry";

/* ==========================================================================
   HISTORY CLIENT — technical chart over short-term telemetry
   ========================================================================== */

type HistoryResponse = {
  success: boolean;
  history: WeatherStationTelemetry[];
};

type Point = { t: number; v: number };
type Series = { key: string; label: string; unit: string; online: boolean; points: Point[] };
type RangeKey = "6h" | "24h" | "7d" | "all";

const ranges: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "6h", label: "6H", ms: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "24H", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: null }
];

/* ──────────────────────── Helpers ──────────────────────── */

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  if (points.length === 0) return { latest: null, min: null, max: null, avg: null, delta: null };
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

function trendDelta(points: Point[], windowMs: number): number | null {
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

function displayKey(display: DisplayReading, index: number) {
  return `display-${index}::${display.primaryUnit ?? ""}`;
}

function displayLabel(display: DisplayReading, index: number) {
  return display.label || `Channel ${index + 1}`;
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
      current.label = displayLabel(display, index);
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

function healthTone(latest?: WeatherStationTelemetry) {
  if (!latest?.receivedAt) return "waiting";
  const ageMs = Date.now() - new Date(latest.receivedAt).getTime();
  if (ageMs > 15 * 60 * 1000) return "error";
  if (ageMs > 3 * 60 * 1000) return "waiting";
  return "online";
}

/* ─────────── Daily emoji-strip computation (history) ─────────── */

type DayBucket = {
  date: string;
  midpointT: number;
  emoji: string;
  tooltip: string;
};

function findDisplayValue(snapshot: WeatherStationTelemetry, labelTokens: string[], unitTokens: string[]): number | null {
  if (!snapshot.displays) return null;
  for (const display of snapshot.displays) {
    const label = (display.label ?? "").toLowerCase();
    const unit = (display.primaryUnit ?? "").toLowerCase();
    const labelMatch = labelTokens.some(token => label.includes(token));
    const unitMatch = unitTokens.some(token => unit.includes(token));
    if (labelMatch || unitMatch) {
      const v = toNumber(display.primary);
      if (v !== null) return v;
    }
  }
  return null;
}

function dateKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateNoonMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

function buildDayBuckets(windowHistory: WeatherStationTelemetry[]): DayBucket[] {
  type Accum = {
    date: string;
    tempSum: number;
    tempCount: number;
    humSum: number;
    humCount: number;
    pressFirst: number | null;
    pressLast: number | null;
  };

  const map = new Map<string, Accum>();

  for (const snap of windowHistory) {
    const t = snap.receivedAt ? new Date(snap.receivedAt).getTime() : NaN;
    if (!Number.isFinite(t)) continue;

    const date = dateKey(t);
    let acc = map.get(date);
    if (!acc) {
      acc = { date, tempSum: 0, tempCount: 0, humSum: 0, humCount: 0, pressFirst: null, pressLast: null };
      map.set(date, acc);
    }

    const temp = findDisplayValue(snap, ["temp", "temperature"], ["°c", "c", "°f", "f"]);
    if (temp !== null) {
      let t2 = temp;
      const t2Unit = (snap.displays?.find(d => /temp|temperature/i.test(d.label ?? ""))?.primaryUnit ?? "").toLowerCase();
      if (t2Unit.includes("f") && !t2Unit.includes("c")) t2 = (t2 - 32) * 5 / 9;
      acc.tempSum += t2;
      acc.tempCount++;
    }

    const hum = findDisplayValue(snap, ["humid", "rh"], ["%"]);
    if (hum !== null) {
      acc.humSum += hum;
      acc.humCount++;
    }

    const press = findDisplayValue(snap, ["pres", "baro"], ["hpa", "mbar"]);
    if (press !== null) {
      if (acc.pressFirst === null) acc.pressFirst = press;
      acc.pressLast = press;
    }
  }

  const buckets: DayBucket[] = [];
  for (const acc of map.values()) {
    const tempAvg = acc.tempCount > 0 ? acc.tempSum / acc.tempCount : null;
    const humAvg = acc.humCount > 0 ? acc.humSum / acc.humCount : null;
    const pressDelta = acc.pressFirst !== null && acc.pressLast !== null ? acc.pressLast - acc.pressFirst : null;
    buckets.push({
      date: acc.date,
      midpointT: dateNoonMs(acc.date),
      emoji: weatherEmoji(tempAvg, humAvg, pressDelta),
      tooltip: `${acc.date} · ${fmt(tempAvg, "°C")} · ${fmt(humAvg, "%")}`
    });
  }

  buckets.sort((a, b) => a.midpointT - b.midpointT);
  return buckets;
}

/* ─────────── Technical chart component ─────────── */

type TechnicalChartProps = {
  points: Point[];
  unit: string;
  emojiStrip?: DayBucket[];
};

function TechnicalChart({ points, unit, emojiStrip }: TechnicalChartProps) {
  const width = 760;
  const height = 280;
  const pad = { top: 16, right: 36, bottom: 32, left: 52 };
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<{ svgX: number; svgY: number; point: Point } | null>(null);

  if (points.length < 2) {
    return <div className="chart-empty">Waiting for enough samples.</div>;
  }

  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);
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
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${x(points[points.length - 1].t).toFixed(1)},${height - pad.bottom} L${x(points[0].t).toFixed(1)},${height - pad.bottom} Z`;

  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(r => yMin + yRange * r);
  // 7 x-axis ticks; lean to actual data range
  const xTicks = Array.from({ length: 7 }, (_, i) => xMin + (xRange * i) / 6);

  // Reference lines: min / avg / max of the visible points
  const s = stats(points);
  const refLines: Array<{ label: string; value: number }> = [];
  if (s.min !== null) refLines.push({ label: "MIN", value: s.min });
  if (s.avg !== null) refLines.push({ label: "AVG", value: s.avg });
  if (s.max !== null) refLines.push({ label: "MAX", value: s.max });

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    const clampedX = Math.max(pad.left, Math.min(width - pad.right, svgX));
    const dataTime = xMin + ((clampedX - pad.left) / innerWidth) * xRange;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].t - dataTime);
      if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
    }
    const nearest = points[nearestIdx];
    setCursor({ svgX: x(nearest.t), svgY: y(nearest.v), point: nearest });
  }

  function handlePointerLeave() { setCursor(null); }

  return (
    <div className="chart-wrap">
      {/* Daily emoji strip (only when caller passes data) */}
      {emojiStrip && emojiStrip.length > 0 && (
        <div
          className="chart-emoji-strip"
          style={{
            position: "relative",
            paddingLeft: `${(pad.left / width) * 100}%`,
            paddingRight: `${(pad.right / width) * 100}%`
          }}
        >
          {emojiStrip
            .filter(b => b.midpointT >= xMin && b.midpointT <= xMax)
            .map((bucket, i) => {
              const fraction = (bucket.midpointT - xMin) / xRange;
              return (
                <div
                  key={i}
                  className="chart-emoji-cell"
                  title={bucket.tooltip}
                  style={{
                    position: "absolute",
                    left: `calc(${(pad.left / width) * 100}% + ${fraction * 100}% - ${((pad.left + pad.right) / width) * fraction * 100}%)`,
                    top: 0,
                    bottom: 0,
                    transform: "translateX(-50%)"
                  }}
                >
                  {bucket.emoji}
                </div>
              );
            })}
        </div>
      )}

      <svg
        ref={svgRef}
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Selected series technical chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{ touchAction: "none" }}
      >
        {/* Horizontal grid lines */}
        {yTicks.map((value, i) => (
          <line key={`g-${i}`} className="chart-grid-line" x1={pad.left} y1={y(value)} x2={width - pad.right} y2={y(value)} />
        ))}

        {/* Reference lines (min/avg/max) */}
        {refLines.map((ref, i) => (
          <g key={`ref-${i}`}>
            <line className="chart-reference-line" x1={pad.left} y1={y(ref.value)} x2={width - pad.right} y2={y(ref.value)} />
            <text className="chart-reference-label" x={width - pad.right + 3} y={y(ref.value) + 3} textAnchor="start">
              {ref.label} {fmt(ref.value, unit)}
            </text>
          </g>
        ))}

        {/* Area + line */}
        <path className="chart-area" d={area} />
        <path className="chart-line" d={path} />

        {/* Axes */}
        <line className="chart-axis" x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} />
        <line className="chart-axis" x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} />

        {/* Y-axis ticks + labels */}
        {yTicks.map((value, i) => (
          <g key={`yt-${i}`}>
            <line className="chart-axis-tick" x1={pad.left - 3} y1={y(value)} x2={pad.left} y2={y(value)} />
            <text className="chart-axis-label" x={pad.left - 6} y={y(value) + 3} textAnchor="end">
              {fmt(value, unit)}
            </text>
          </g>
        ))}

        {/* X-axis ticks + labels */}
        {xTicks.map((value, i) => (
          <g key={`xt-${i}`}>
            <line className="chart-axis-tick" x1={x(value)} y1={height - pad.bottom} x2={x(value)} y2={height - pad.bottom + 3} />
            <text className="chart-axis-label" x={x(value)} y={height - pad.bottom + 14} textAnchor="middle">
              {timeLabel(value)}
            </text>
          </g>
        ))}

        {/* Cursor */}
        {cursor && (
          <>
            <line className="chart-crosshair" x1={cursor.svgX} y1={pad.top} x2={cursor.svgX} y2={height - pad.bottom} />
            <line className="chart-crosshair" x1={pad.left} y1={cursor.svgY} x2={width - pad.right} y2={cursor.svgY} />
            <circle className="chart-cursor-dot" cx={cursor.svgX} cy={cursor.svgY} r={3.5} />
            <rect
              className="chart-tooltip-bg"
              x={cursor.svgX + 8 > width - pad.right - 120 ? cursor.svgX - 128 : cursor.svgX + 8}
              y={Math.max(pad.top, cursor.svgY - 34)}
              width={120}
              height={30}
              rx={3}
            />
            <text
              className="chart-tooltip-text"
              x={cursor.svgX + 8 > width - pad.right - 120 ? cursor.svgX - 120 : cursor.svgX + 16}
              y={Math.max(pad.top + 13, cursor.svgY - 19)}
            >
              {fmt(cursor.point.v, unit)}
            </text>
            <text
              className="chart-tooltip-time"
              x={cursor.svgX + 8 > width - pad.right - 120 ? cursor.svgX - 120 : cursor.svgX + 16}
              y={Math.max(pad.top + 24, cursor.svgY - 8)}
            >
              {dateTimeLabel(cursor.point.t)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/* ─────────── Main History component ─────────── */

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
        // cache: "no-cache" lets the browser do conditional GETs (If-None-Match)
        // and serve the cached body when the server returns 304.
        const res = await fetch("/api/history?limit=10080", { cache: "no-cache" });
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
    // 2-min interval; ETag/304 makes idle refreshes essentially free.
    const timer = window.setInterval(load, 120000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const series = useMemo(() => buildSeries(history), [history]);
  const selected = series.find(item => item.key === selectedKey) ?? series[0];
  const points = useMemo(() => selected ? filterPoints(selected.points, range) : [], [selected, range]);
  const windowHistory = useMemo(() => filterHistory(history, range), [history, range]);
  const latest = history[0];
  const selectedStats = stats(points);
  const delta1h = trendDelta(points, 60 * 60 * 1000);

  const showEmoji = range !== "6h";
  const dayBuckets = useMemo(() => showEmoji ? buildDayBuckets(windowHistory) : [], [showEmoji, windowHistory]);

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

  const deltaToneClass =
    delta1h === null ? "" : delta1h > 0 ? "delta-up" : delta1h < 0 ? "delta-down" : "";

  return (
    <main className="station-dashboard data-page">
      {/* Header: same shape as dashboard with all 4 nav links */}
      <nav className="station-header">
        <div className="station-brand-stack">
          <a className="brand station-brand-word" href="/">Archipelago</a>
          <h1><em>History</em></h1>
        </div>
        <div className="station-header-actions">
          <a className="station-nav-link" href="/">Dashboard</a>
          <a className="station-nav-link" href="/archive">Archive</a>
          <a className="station-nav-link" href="/history" aria-current="page">History</a>
          <a className="station-nav-link" href="/admin">Admin</a>
          <span className={`station-status ${status}`}>{statusText}</span>
        </div>
      </nav>

      {/* Meta strip — same Doto language as dashboard */}
      <div className="station-meta-strip">
        <span>Last <strong>{age(latest?.receivedAt)}</strong></span>
        <span>Window <strong>{spanLabel(points)}</strong></span>
        <span>Samples <strong>{windowHistory.length}</strong></span>
        <span>Series <strong>{series.length || "--"}</strong></span>
      </div>

      {/* Toolbar: time-range chips */}
      <div className="data-toolbar">
        <label>Range</label>
        <div className="chip-button-row" role="group" aria-label="History range">
          {ranges.map(item => (
            <button
              key={item.key}
              type="button"
              className={item.key === range ? "active" : ""}
              onClick={() => setRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart panel */}
      <section className="chart-panel">
        <div className="chart-panel-head">
          <div className="chart-panel-label">
            <span className={`oled-status-pixel ${selected?.online ? "live" : ""}`} />
            {selected?.label ?? "No numeric series"}
          </div>
          {selected && points.length >= 2 && (
            <div className="chart-readout-strip">
              <span>LATEST<strong>{fmt(selectedStats.latest, selected.unit)}</strong></span>
              <span className={deltaToneClass}>Δ1H<strong>{fmtDelta(delta1h, selected.unit)}</strong></span>
              <span>MIN<strong>{fmt(selectedStats.min, selected.unit)}</strong></span>
              <span>MAX<strong>{fmt(selectedStats.max, selected.unit)}</strong></span>
            </div>
          )}
        </div>

        <TechnicalChart
          points={points}
          unit={selected?.unit ?? ""}
          emojiStrip={showEmoji ? dayBuckets : undefined}
        />
      </section>

      {/* Focus stats */}
      <section className="stat-grid" aria-label="Selected series statistics">
        <article className="stat-card">
          <span className="stat-card-label">Latest</span>
          <span className="stat-card-value">{fmt(selectedStats.latest, selected?.unit)}</span>
        </article>
        <article className="stat-card">
          <span className="stat-card-label">Minimum</span>
          <span className="stat-card-value">{fmt(selectedStats.min, selected?.unit)}</span>
        </article>
        <article className="stat-card">
          <span className="stat-card-label">Average</span>
          <span className="stat-card-value">{fmt(selectedStats.avg, selected?.unit)}</span>
        </article>
        <article className="stat-card">
          <span className="stat-card-label">Maximum</span>
          <span className="stat-card-value">{fmt(selectedStats.max, selected?.unit)}</span>
        </article>
        <article className={`stat-card ${selectedStats.delta && selectedStats.delta < 0 ? "down" : selectedStats.delta && selectedStats.delta > 0 ? "up" : ""}`}>
          <span className="stat-card-label">Delta</span>
          <span className="stat-card-value">{fmtDelta(selectedStats.delta, selected?.unit)}</span>
        </article>
      </section>

      {/* Per-series matrix (clickable to switch selected series) */}
      <section className="series-grid" aria-label="All series summary">
        {series.map(item => {
          const itemPoints = filterPoints(item.points, range);
          const itemStats = stats(itemPoints);
          const isActive = item.key === selected?.key;
          return (
            <article
              key={item.key}
              className={`series-grid-card ${isActive ? "active" : ""}`}
              onClick={() => setSelectedKey(item.key)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedKey(item.key); } }}
            >
              <div className="oled-panel-head">
                <span className={`oled-status-pixel ${item.online ? "live" : ""}`} />
                <span className="oled-panel-label">{item.label}</span>
              </div>
              <div className="series-grid-card-value">{fmt(itemStats.latest, item.unit)}</div>
              <div className="series-grid-card-meta">
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
