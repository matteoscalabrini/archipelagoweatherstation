"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deriveWeatherInsights } from "@/lib/insights";
import type { WeatherStationTelemetry } from "@/lib/telemetry";

/* ==========================================================================
   DASHBOARD FILE LEGEND
   --------------------------------------------------------------------------
   1) API/telemetry types
   2) Mock telemetry generators (fallback when station is offline)
   3) Display formatting helpers
   4) Signal scaling helpers (value -> percentage bars)
   5) Trend + forecast driver math
   6) Weather emoji selector
   7) Sparkline matrix renderer
   8) Main Dashboard component and UI sections
   ========================================================================== */

/* 1) API/telemetry types used by fetch responses and sparkline points. */
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

/* 2) Mock history stream for local/dev fallback rendering. */
function generateMockHistory(count: number): WeatherStationTelemetry[] {
  const now = Date.now();
  const history: WeatherStationTelemetry[] = [];
  for (let i = 0; i < count; i++) {
    const t = new Date(now - (count - i) * 60000 * 5).toISOString();
    const temp = 16.7 + Math.sin(i * 0.1) * 0.5 + Math.random() * 0.3;
    const humidity = 23 + Math.sin(i * 0.08) * 2 + Math.random() * 1;
    const pressure = 980.6 + Math.sin(i * 0.05) * 0.5 + Math.random() * 0.2;
    const windSpeed = 1.2 + Math.sin(i * 0.09) * 0.3 + Math.random() * 0.2;
    const windDir = 134 + Math.sin(i * 0.07) * 10 + Math.random() * 5;
    const solar = 1.09 + Math.sin(i * 0.15) * 0.2 + Math.random() * 0.1;
    const batteryW = 0.36 + Math.sin(i * 0.03) * 0.05;
    const batteryLvl = 89 + Math.sin(i * 0.02) * 2;
    history.push({
      board: "Archipelago WS-1",
      firmwareVersion: "1.2.3",
      uptimeMs: 86400000 + i * 300000,
      solarMode: i % 3 === 0 ? "sun" : i % 3 === 1 ? "shadow" : "dark",
      wifi: { enabled: true, sta: true, ip: "192.168.1.42", lastPostCode: 200, lastPostMessage: "OK" },
      sensors: { BME280: true, BH1750: true, SHT31: true },
      displays: [
        { label: "ENV TEMP", primary: Math.round(temp * 10) / 10, primaryUnit: "C", secondary: Math.round(temp * 10) / 10, secondaryUnit: "", secondaryLabel: "FEELS LIKE", online: true },
        { label: "ENV HUM", primary: Math.round(humidity * 10) / 10, primaryUnit: "%", secondary: null, secondaryUnit: "", secondaryLabel: "", online: true },
        { label: "ENV PRES", primary: Math.round(pressure * 10) / 10, primaryUnit: "hPa", secondary: null, secondaryUnit: "", secondaryLabel: "", online: true },
        { label: "FORECAST", primary: "BETTER", primaryUnit: "", secondary: Math.round(pressure * 0.0024 * 100) / 100, secondaryUnit: "hPa", secondaryLabel: "no trend", online: true },
        { label: "WIND SPD", primary: Math.round(windSpeed * 10) / 10, primaryUnit: "m/s", secondary: Math.round(windSpeed * 1.94384), secondaryUnit: "", secondaryLabel: "BFT", online: true },
        { label: "WIND DIR", primary: Math.round(windDir * 10) / 10, primaryUnit: "deg", secondary: null, secondaryUnit: "", secondaryLabel: "FRONT-L", online: true },
        { label: "SOLAR", primary: Math.round(solar * 100) / 100, primaryUnit: "W", secondary: 16.72, secondaryUnit: "V", secondaryLabel: "", online: true },
        { label: "BATTERY", primary: Math.round(batteryW * 100) / 100, primaryUnit: "W", secondary: 16.2, secondaryUnit: "V", secondaryLabel: "", online: true },
        { label: "BAT LVL", primary: Math.round(batteryLvl * 10) / 10, primaryUnit: "%", secondary: 16.2, secondaryUnit: "V", secondaryLabel: "", online: true }
      ],
      receivedAt: t
    });
  }
  return history;
}

/* Single-snapshot mock payload for latest telemetry fallback. */
function generateMockTelemetry(): WeatherStationTelemetry {
  const now = new Date().toISOString();
  return {
    board: "Archipelago WS-1",
    firmwareVersion: "1.2.3",
    uptimeMs: 86400000,
    solarMode: "sun",
    wifi: { enabled: true, sta: true, ip: "192.168.1.42", lastPostCode: 200, lastPostMessage: "OK" },
    sensors: { BME280: true, BH1750: true, SHT31: true },
    displays: [
      { label: "ENV TEMP", primary: 16.7, primaryUnit: "C", secondary: 16.7, secondaryUnit: "", secondaryLabel: "FEELS LIKE", online: true },
      { label: "ENV HUM", primary: 23, primaryUnit: "%", secondary: null, secondaryUnit: "", secondaryLabel: "", online: true },
      { label: "ENV PRES", primary: 980.6, primaryUnit: "hPa", secondary: null, secondaryUnit: "", secondaryLabel: "", online: true },
      { label: "FORECAST", primary: "BETTER", primaryUnit: "", secondary: 2.4, secondaryUnit: "hPa", secondaryLabel: "no trend", online: true },
      { label: "WIND SPD", primary: 1.2, primaryUnit: "m/s", secondary: 1, secondaryUnit: "", secondaryLabel: "BFT", online: true },
      { label: "WIND DIR", primary: 134, primaryUnit: "deg", secondary: null, secondaryUnit: "", secondaryLabel: "FRONT-L", online: true },
      { label: "SOLAR", primary: 1.09, primaryUnit: "W", secondary: 16.72, secondaryUnit: "V", secondaryLabel: "", online: true },
      { label: "BATTERY", primary: 0.36, primaryUnit: "W", secondary: 16.2, secondaryUnit: "V", secondaryLabel: "", online: true },
      { label: "BAT LVL", primary: 89, primaryUnit: "%", secondary: 16.2, secondaryUnit: "V", secondaryLabel: "", online: true }
    ],
    receivedAt: now
  };
}

/* 3) Formatting helpers for readable UI text values. */
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
    case "sun":
      return "SUN / CHARGING";
    case "shadow":
      return "SHADED";
    case "dark":
      return "DARK / BATTERY";
    default:
      return "UNKNOWN";
  }
}

/* 4) Numeric parsing + scaling helpers for progress bars and normalization. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function scaleToPercent(value: number, min: number, max: number) {
  if (max <= min) return null;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function signalPercent(
  label: string | undefined,
  value: number | string | null | undefined,
  unit?: string
): number | null {
  const n = toNumber(value);
  if (n === null) return null;

  const channel = (label ?? "").toUpperCase();
  const normalized = (unit ?? "").toLowerCase();

  // Channel-specific expected ranges.
  if (channel.includes("TEMP")) {
    if (normalized.includes("f")) return scaleToPercent((n - 32) * (5 / 9), -10, 40);
    return scaleToPercent(n, -10, 40);
  }

  if (channel.includes("HUM") || channel.includes("BAT LVL") || normalized.includes("%")) {
    return scaleToPercent(n, 0, 100);
  }

  // Assumption: wind speed full scale is 30 m/s (easy to tweak).
  if (channel.includes("WIND SPD") || normalized.includes("m/s")) {
    return scaleToPercent(n, 0, 30);
  }

  if ((channel.includes("SOLAR") || channel.includes("BATTERY")) && normalized.includes("w")) {
    return scaleToPercent(n, 0, 25);
  }

  if (normalized.includes("hpa")) return scaleToPercent(n, 960, 1040);
  if (normalized.includes("deg")) return scaleToPercent(n, 0, 360);
  if (normalized.includes("v")) return scaleToPercent(n, 10, 18);
  if (n >= 0 && n <= 100) return n;

  return null;
}

/* 5) Series extraction + trend deltas used by panel sparkline + forecast logic. */
function extractSeries(history: WeatherStationTelemetry[], label: string): Point[] {
  const points: Point[] = [];
  for (const snap of history) {
    const display = snap.displays?.find((d) => d?.label === label);
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

type ForecastDrivers = {
  pressureDelta: number | null;
  humidityDelta: number | null;
  windDelta: number | null;
  confidencePct: number | null;
};

/* Forecast confidence score from pressure/humidity/wind trend alignment. */
function forecastConfidence(
  forecastState: string,
  pressureDelta: number | null,
  humidityDelta: number | null,
  windDelta: number | null
) {
  if (pressureDelta === null || humidityDelta === null || windDelta === null) return null;

  const state = forecastState.toUpperCase();
  let score = 50;

  if (state.includes("BETTER") || state.includes("IMPROV") || state.includes("CLEAR")) {
    score += clamp(pressureDelta / 2.5, -1, 1) * 24;
    score += clamp(-humidityDelta / 8, -1, 1) * 14;
    score += clamp(-windDelta / 2.5, -1, 1) * 12;
  } else if (state.includes("WORSE") || state.includes("RAIN") || state.includes("STORM")) {
    score += clamp(-pressureDelta / 2.5, -1, 1) * 24;
    score += clamp(humidityDelta / 8, -1, 1) * 14;
    score += clamp(windDelta / 2.5, -1, 1) * 12;
  } else {
    score += clamp(1 - Math.abs(pressureDelta) / 1.5, 0, 1) * 18;
    score += clamp(1 - Math.abs(humidityDelta) / 6, 0, 1) * 16;
    score += clamp(1 - Math.abs(windDelta) / 2, 0, 1) * 16;
  }

  return clamp(Math.round(score), 5, 99);
}

/* Collects the three trend drivers rendered inside the forecast tile. */
function buildForecastDrivers(
  forecastState: string,
  history: WeatherStationTelemetry[]
): ForecastDrivers {
  const pressureSeries = extractSeries(history, "ENV PRES");
  const humiditySeries = extractSeries(history, "ENV HUM");
  const windSeries = extractSeries(history, "WIND SPD");

  const pressureDelta = trendDelta(pressureSeries, 3 * 60 * 60 * 1000);
  const humidityDelta = trendDelta(humiditySeries, 60 * 60 * 1000);
  const windDelta = trendDelta(windSeries, 60 * 60 * 1000);

  return {
    pressureDelta,
    humidityDelta,
    windDelta,
    confidencePct: forecastConfidence(forecastState, pressureDelta, humidityDelta, windDelta)
  };
}

function signed(value: number | null, digits = 2) {
  if (value === null) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

/* 6) Lightweight weather icon from current conditions + pressure trend. */
function weatherEmoji(tempC: number | null, humidity: number | null, pressureDelta: number | null) {
  if (tempC === null) return "🌡️";
  if (pressureDelta !== null && pressureDelta <= -1.5 && (humidity ?? 0) > 80) return "⛈️";
  if (humidity !== null && humidity > 85) return "🌧️";
  if (tempC <= 2) return "❄️";
  if (tempC >= 30) return "🔥";
  if (pressureDelta !== null && pressureDelta > 1) return "☀️";
  return "⛅";
}

/* 7) Matrix sparkline renderer used by non-forecast panels. */
function Sparkline({ points, live }: { points: Point[]; live?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [grid, setGrid] = useState({ columns: 24, rows: 8 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const element = host;

    function updateGrid(width: number, height: number) {
      // Keep graph density tied to CSS square size/gap for visual consistency.
      const style = getComputedStyle(element);
      const square = parseFloat(style.getPropertyValue("--matrix-square-size")) || 3;
      const gap = parseFloat(style.getPropertyValue("--matrix-square-gap")) || 2;
      const step = Math.max(1, square + gap);

      const columns = Math.max(12, Math.floor((width + gap) / step));
      const rows = Math.max(6, Math.floor((height + gap) / step));

      setGrid((prev) => (prev.columns === columns && prev.rows === rows ? prev : { columns, rows }));
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateGrid(entry.contentRect.width, entry.contentRect.height);
    });

    observer.observe(element);
    const rect = element.getBoundingClientRect();
    updateGrid(rect.width, rect.height);

    return () => observer.disconnect();
  }, []);

  const dots = useMemo(() => {
    const { columns, rows } = grid;
    const lit = new Set<string>();

    const addCell = (col: number, row: number) => {
      lit.add(`${col}:${row}`);
    };

    if (points.length >= 2) {
      const xs = points.map((p) => p.t);
      const ys = points.map((p) => p.v);
      const xMin = xs[0];
      const xMax = xs[xs.length - 1];
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      const xRange = xMax - xMin || 1;
      const yRange = yMax - yMin || 1;
      const bucketed: Array<number | null> = Array.from({ length: columns }, () => null);

      for (const p of points) {
        const col = clamp(Math.round(((p.t - xMin) / xRange) * (columns - 1)), 0, columns - 1);
        bucketed[col] = p.v;
      }

      let firstDefined = points[0].v;
      for (const v of bucketed) {
        if (v !== null) {
          firstDefined = v;
          break;
        }
      }

      let previous = firstDefined;
      for (let col = 0; col < columns; col += 1) {
        const current = bucketed[col];
        if (current === null) bucketed[col] = previous;
        else previous = current;
      }

      for (let col = 0; col < columns; col += 1) {
        const v = bucketed[col] ?? firstDefined;
        const normalized = yRange === 0 ? 0.5 : clamp((v - yMin) / yRange, 0, 1);
        const row = clamp(Math.round((1 - normalized) * (rows - 1)), 0, rows - 1);

        if (col === 0) {
          addCell(col, row);
          continue;
        }

        const previousValue = bucketed[col - 1] ?? firstDefined;
        const previousNormalized = yRange === 0 ? 0.5 : clamp((previousValue - yMin) / yRange, 0, 1);
        const previousRow = clamp(Math.round((1 - previousNormalized) * (rows - 1)), 0, rows - 1);

        // Draw a connected step: horizontal bridge, then vertical bridge.
        addCell(col, previousRow);
        if (previousRow !== row) {
          const step = row > previousRow ? 1 : -1;
          for (let r = previousRow; r !== row; r += step) addCell(col, r);
        }
        addCell(col, row);
      }
    }

    return Array.from(lit).map((key) => {
      const [col, row] = key.split(":").map((part) => parseInt(part, 10));
      return { key, col, row };
    });
  }, [points, grid]);

  return (
    <div
      ref={hostRef}
      className={`trend-matrix-graph ${live ? "live" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${grid.columns}, var(--matrix-square-size))`,
        gridTemplateRows: `repeat(${grid.rows}, var(--matrix-square-size))`
      }}
    >
      {dots.map((dot) => (
        <span
          key={dot.key}
          className="matrix-square on"
          style={{ gridColumnStart: dot.col + 1, gridRowStart: dot.row + 1 }}
        />
      ))}
    </div>
  );
}

/* 8) Main dashboard: data polling + derived values + display rendering. */
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

        if (!latest.telemetry || !latest.telemetry.displays || latest.telemetry.displays.length === 0) {
          setTelemetry(generateMockTelemetry());
          setConnected(true);
          setHistory(generateMockHistory(200));
        } else {
          setTelemetry(latest.telemetry);
          setConnected(latest.connected);
          setHistory(hist.history ?? []);
        }
        setError("");
      } catch {
        if (!cancelled) setError("connection lost");
      }
    }

    load();
    // Poll station APIs every 10s for near-live dashboard updates.
    const t = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const displays = telemetry?.displays ?? [];
  const status = error ? "error" : connected ? "online" : "waiting";

  const orderedHistory = useMemo(() => [...history].reverse(), [history]);
  const insights = useMemo(() => deriveWeatherInsights(telemetry, history), [telemetry, history]);

  const sensorEntries = telemetry?.sensors ? Object.entries(telemetry.sensors) : [];
  const wxIcon = weatherEmoji(insights.temperatureC, insights.humidityPct, insights.pressureDeltaHpa);

  return (
    <main className="station-dashboard">
      {/* Header: brand, navigation, and online/error state */}
      <nav className="station-header">
        <div className="station-brand-stack">
          <span className="brand station-brand-word">Archipelago</span>
          <h1>
            <em>Weather Station</em>
          </h1>
        </div>
        <div className="station-header-actions">
          <a className="station-nav-link" href="/history">
            History
          </a>
          <a className="station-nav-link" href="/admin">
            Admin
          </a>
          <span className={`station-status ${status}`}>{error || (connected ? "Online" : "Waiting")}</span>
        </div>
      </nav>

      {/* Meta strip: compact station context row */}
      <div className="station-meta-strip">
        <span>
          Mode <strong>{solarLabel(telemetry?.solarMode)}</strong>
        </span>
        <span>
          Last <strong>{age(telemetry?.receivedAt)}</strong>
        </span>
        <span>
          Board <strong>{telemetry?.board ?? "--"}</strong>
        </span>
        <span>
          Firmware <strong>{telemetry?.firmwareVersion ?? "--"}</strong>
        </span>
        <span>
          Active <strong>{displays.filter((d) => d?.online).length} / {displays.length || "--"}</strong>
        </span>
      </div>

      {/* Forecast banner: emoji + sentence summary */}
      <section className="forecast-banner" aria-label="Weather forecast">
        <div className="forecast-banner-display">
          <span className="forecast-banner-emoji" aria-hidden>{wxIcon}</span>
          <p className="forecast-banner-text">{insights.summary}</p>
        </div>
      </section>

      {/* Core telemetry: 3x3 OLED-inspired panel grid */}
      <section className="oled-grid-frame" aria-label="OLED matrix frame">
        <div className="oled-grid-3x3" aria-label="Sensor readings">
          {Array.from({ length: 9 }).map((_, i) => {
            const d = displays[i];
            const series = d?.label ? extractSeries(orderedHistory, d.label) : [];
            const isForecastTile = (d?.label ?? "").toUpperCase().includes("FORECAST");
            const delta = trendDelta(series);
            const secondary = d?.secondaryLabel
              ? `${d.secondaryLabel} ${fmt(d.secondary, d.secondaryUnit)}`
              : fmt(d?.secondary, d?.secondaryUnit);
            const deltaState = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
            const deltaDirection = delta === null ? "NA" : delta > 0 ? "UP" : delta < 0 ? "DOWN" : "FLAT";
            const deltaText =
              delta === null
                ? "TREND N/A"
                : `${deltaDirection} ${Math.abs(delta).toFixed(2)}${d?.primaryUnit ? ` ${d.primaryUnit}` : ""} /1H`;
            const signal = signalPercent(d?.label, d?.primary, d?.primaryUnit);
            const forecastDrivers = isForecastTile ? buildForecastDrivers(String(d?.primary ?? ""), orderedHistory) : null;

            return (
              <article className={`oled-panel ${d?.online ? "live" : "offline"}`} key={i}>
                <div className="oled-panel-head">
                  <span className="oled-channel-id">CH-{String(i + 1).padStart(2, "0")}</span>
                  <span className="oled-panel-label">{d?.label ?? `CHANNEL ${i + 1}`}</span>
                  <div className={`oled-status-pixel ${d?.online ? "live" : ""}`} />
                </div>

                <div className={`oled-main-value ${d?.online ? "" : "dim"}`}>{fmt(d?.primary, d?.primaryUnit)}</div>

                {signal !== null && (
                  <div className="oled-progress-bar" aria-label="Signal level">
                    <span style={{ width: `${signal.toFixed(0)}%` }} />
                  </div>
                )}

                {isForecastTile ? (
                  // Forecast panel is driver-based, not sparkline-based.
                  <div className="oled-trend-stack forecast-trend-stack">
                    <div className="forecast-confidence-row">
                      <span className="trend-readout">CONF</span>
                      <span className="trend-readout">
                        {forecastDrivers?.confidencePct !== null ? `${forecastDrivers?.confidencePct}%` : "--"}
                      </span>
                    </div>
                    <div className="oled-progress-bar forecast-confidence-bar" aria-label="Forecast confidence">
                      <span style={{ width: `${forecastDrivers?.confidencePct ?? 0}%` }} />
                    </div>
                    <div className="forecast-driver-list">
                      <span className="trend-readout">PRES {signed(forecastDrivers?.pressureDelta ?? null)} hPa /3H</span>
                      <span className="trend-readout">HUM {signed(forecastDrivers?.humidityDelta ?? null)} % /1H</span>
                      <span className="trend-readout">WIND {signed(forecastDrivers?.windDelta ?? null)} m/s /1H</span>
                    </div>
                  </div>
                ) : (
                  // Standard panels show 1h trend text + matrix sparkline.
                  <div className="oled-trend-stack">
                    <span className={`trend-readout ${deltaState}`}>{deltaText}</span>
                    <div className="trend-graph-wrap">
                      <Sparkline points={series} live={d?.online} />
                    </div>
                  </div>
                )}

                <div className="oled-secondary-line">{secondary === "--" ? "AUX --" : secondary}</div>
              </article>
            );
          })}
        </div>
      </section>

      {/* System diagnostics: mode, uptime, network, posting + sensor status chips */}
      <section className="system-diagnostics" aria-label="System health">
        <div className="system-diagnostics-title">System Diagnostics</div>
        <div className="system-diagnostics-grid">
          <div className="system-diagnostics-box">
            <div className="system-diagnostics-label">Solar Mode</div>
            <div className="system-diagnostics-value">{solarLabel(telemetry?.solarMode)}</div>
          </div>
          <div className="system-diagnostics-box">
            <div className="system-diagnostics-label">Uptime</div>
            <div className="system-diagnostics-value">{uptime(telemetry?.uptimeMs)}</div>
          </div>
          <div className="system-diagnostics-box">
            <div className="system-diagnostics-label">Network</div>
            <div className="system-diagnostics-value">
              {telemetry?.wifi?.sta
                ? "Station"
                : telemetry?.wifi?.recoveryAp
                  ? "Recovery AP"
                  : telemetry?.wifi?.ap
                    ? "Access Point"
                    : "Offline"}
              {telemetry?.wifi?.ip && <span className="system-diagnostics-subvalue"> | {telemetry.wifi.ip}</span>}
            </div>
          </div>
          <div className="system-diagnostics-box">
            <div className="system-diagnostics-label">Last Post</div>
            <div className="system-diagnostics-value">
              <span className={telemetry?.wifi?.lastPostCode === 200 ? "status-ok-text" : "status-dim-text"}>
                {telemetry?.wifi?.lastPostCode ?? "--"}
              </span>
              {telemetry?.wifi?.lastPostMessage && (
                <span className="system-diagnostics-subvalue"> | {telemetry.wifi.lastPostMessage}</span>
              )}
            </div>
          </div>
        </div>

        {sensorEntries.length > 0 && (
          <div className="sensor-status-row">
            {sensorEntries.map(([name, ok]) => (
              <span key={name} className={`sensor-status-chip ${ok ? "ok" : "bad"}`}>
                <span className={`oled-status-pixel ${ok ? "live" : ""}`} />
                {name}
              </span>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
