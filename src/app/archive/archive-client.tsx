"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { weatherEmoji } from "@/lib/insights";
import type { DailyAggregate } from "@/lib/archive";

/* ==========================================================================
   ARCHIVE CLIENT — daily aggregates, technical chart with min-max bars
   ========================================================================== */

type ArchiveResponse = {
  success: boolean;
  data: DailyAggregate[];
};

type YearsResponse = {
  success: boolean;
  years: number[];
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

type ChartFieldKey =
  | "tempAvg" | "humidityAvg" | "pressureAvg" | "windSpeedMax" | "solarMax";

type ChartFieldSpec = {
  key: ChartFieldKey;
  label: string;
  unit: string;
  avgField: keyof DailyAggregate;
  minField: keyof DailyAggregate | null;
  maxField: keyof DailyAggregate | null;
};

const CHART_FIELDS: ChartFieldSpec[] = [
  { key: "tempAvg", label: "Temperature", unit: "°C", avgField: "tempAvg", minField: "tempMin", maxField: "tempMax" },
  { key: "humidityAvg", label: "Humidity", unit: "%", avgField: "humidityAvg", minField: "humidityMin", maxField: "humidityMax" },
  { key: "pressureAvg", label: "Pressure", unit: "hPa", avgField: "pressureAvg", minField: "pressureMin", maxField: "pressureMax" },
  { key: "windSpeedMax", label: "Wind Speed", unit: "m/s", avgField: "windSpeedAvg", minField: "windSpeedMin", maxField: "windSpeedMax" },
  { key: "solarMax", label: "Solar", unit: "W", avgField: "solarAvg", minField: null, maxField: "solarMax" }
];

/* ─────────── Helpers ─────────── */

function fmt(value: number | null | undefined, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function dateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  return `${MONTHS[monthIdx]} ${parseInt(parts[2], 10)}`;
}

function dateMidpointMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

function getField(row: DailyAggregate, field: keyof DailyAggregate): number | null {
  const v = row[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ─────────── Archive technical chart ─────────── */

type ArchivePoint = {
  t: number;
  dateStr: string;
  avg: number;
  min: number | null;
  max: number | null;
};

type ArchiveEmojiBucket = {
  t: number;
  emoji: string;
  tooltip: string;
};

type ArchiveChartProps = {
  data: ArchivePoint[];
  unit: string;
  refMin: number | null;
  refAvg: number | null;
  refMax: number | null;
  emojiStrip: ArchiveEmojiBucket[];
};

function ArchiveChart({ data, unit, refMin, refAvg, refMax, emojiStrip }: ArchiveChartProps) {
  const width = 760;
  const height = 280;
  const pad = { top: 16, right: 36, bottom: 38, left: 52 };
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<{ svgX: number; svgY: number; point: ArchivePoint } | null>(null);

  if (data.length === 0) {
    return <div className="chart-empty">No data for this period.</div>;
  }

  // Y range considers both the avg line AND min/max bars
  const yValues: number[] = [];
  for (const p of data) {
    yValues.push(p.avg);
    if (p.min !== null) yValues.push(p.min);
    if (p.max !== null) yValues.push(p.max);
  }
  const yMinRaw = Math.min(...yValues);
  const yMaxRaw = Math.max(...yValues);
  const yPad = (yMaxRaw - yMinRaw || Math.max(1, Math.abs(yMaxRaw))) * 0.1;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const yRange = yMax - yMin || 1;

  // X range: use first/last day midpoints
  const xMin = data[0].t;
  const xMax = data[data.length - 1].t;
  const xRange = xMax - xMin || 1;

  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;

  const x = (value: number) => pad.left + ((value - xMin) / xRange) * innerWidth;
  const y = (value: number) => pad.top + (1 - (value - yMin) / yRange) * innerHeight;

  // Avg line path through every day's avg point
  const linePath = data
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(r => yMin + yRange * r);

  // X-axis: daily labels when ≤14 days, weekly stride otherwise
  const xLabelStride = data.length <= 14 ? 1 : Math.max(1, Math.ceil(data.length / 8));
  const xTicks = data.filter((_, i) => i % xLabelStride === 0);

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
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(data[i].t - dataTime);
      if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
    }
    const nearest = data[nearestIdx];
    setCursor({ svgX: x(nearest.t), svgY: y(nearest.avg), point: nearest });
  }

  function handlePointerLeave() { setCursor(null); }

  const refs: Array<{ label: string; value: number }> = [];
  if (refMin !== null) refs.push({ label: "MIN", value: refMin });
  if (refAvg !== null) refs.push({ label: "AVG", value: refAvg });
  if (refMax !== null) refs.push({ label: "MAX", value: refMax });

  return (
    <div className="chart-wrap">
      {/* Daily emoji strip */}
      {emojiStrip.length > 0 && (
        <div
          className="chart-emoji-strip"
          style={{
            position: "relative",
            paddingLeft: `${(pad.left / width) * 100}%`,
            paddingRight: `${(pad.right / width) * 100}%`
          }}
        >
          {emojiStrip.map((bucket, i) => {
            const fraction = (bucket.t - xMin) / xRange;
            return (
              <div
                key={i}
                className={bucket.emoji === "·" ? "chart-emoji-cell chart-emoji-empty" : "chart-emoji-cell"}
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
        aria-label="Daily aggregates chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{ touchAction: "none" }}
      >
        {/* Horizontal grid */}
        {yTicks.map((value, i) => (
          <line key={`g-${i}`} className="chart-grid-line" x1={pad.left} y1={y(value)} x2={width - pad.right} y2={y(value)} />
        ))}

        {/* Reference lines */}
        {refs.map((r, i) => (
          <g key={`ref-${i}`}>
            <line className="chart-reference-line" x1={pad.left} y1={y(r.value)} x2={width - pad.right} y2={y(r.value)} />
            <text className="chart-reference-label" x={width - pad.right + 3} y={y(r.value) + 3} textAnchor="start">
              {r.label} {fmt(r.value, unit)}
            </text>
          </g>
        ))}

        {/* Daily min-max range bars (behind the line) */}
        {data.map((p, i) => {
          if (p.min === null || p.max === null) return null;
          return (
            <line
              key={`bar-${i}`}
              className="chart-day-bar"
              x1={x(p.t)}
              y1={y(p.min)}
              x2={x(p.t)}
              y2={y(p.max)}
            />
          );
        })}

        {/* Avg line */}
        <path className="chart-line" d={linePath} />

        {/* Avg dots */}
        {data.map((p, i) => (
          <circle key={`dot-${i}`} className="chart-day-dot" cx={x(p.t)} cy={y(p.avg)} r={2} />
        ))}

        {/* Axes */}
        <line className="chart-axis" x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} />
        <line className="chart-axis" x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} />

        {/* Y axis ticks */}
        {yTicks.map((value, i) => (
          <g key={`yt-${i}`}>
            <line className="chart-axis-tick" x1={pad.left - 3} y1={y(value)} x2={pad.left} y2={y(value)} />
            <text className="chart-axis-label" x={pad.left - 6} y={y(value) + 3} textAnchor="end">
              {fmt(value, unit)}
            </text>
          </g>
        ))}

        {/* X axis ticks */}
        {xTicks.map((p) => (
          <g key={`xt-${p.dateStr}`}>
            <line className="chart-axis-tick" x1={x(p.t)} y1={height - pad.bottom} x2={x(p.t)} y2={height - pad.bottom + 3} />
            <text
              className="chart-axis-label"
              x={x(p.t)}
              y={height - pad.bottom + 18}
              textAnchor="middle"
            >
              {dateLabel(p.dateStr)}
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
              x={cursor.svgX + 8 > width - pad.right - 140 ? cursor.svgX - 148 : cursor.svgX + 8}
              y={Math.max(pad.top, cursor.svgY - 46)}
              width={140}
              height={42}
              rx={3}
            />
            <text
              className="chart-tooltip-text"
              x={cursor.svgX + 8 > width - pad.right - 140 ? cursor.svgX - 140 : cursor.svgX + 16}
              y={Math.max(pad.top + 13, cursor.svgY - 31)}
            >
              {fmt(cursor.point.avg, unit)}
            </text>
            <text
              className="chart-tooltip-time"
              x={cursor.svgX + 8 > width - pad.right - 140 ? cursor.svgX - 140 : cursor.svgX + 16}
              y={Math.max(pad.top + 24, cursor.svgY - 20)}
            >
              {dateLabel(cursor.point.dateStr)}
            </text>
            {(cursor.point.min !== null && cursor.point.max !== null) && (
              <text
                className="chart-tooltip-time"
                x={cursor.svgX + 8 > width - pad.right - 140 ? cursor.svgX - 140 : cursor.svgX + 16}
                y={Math.max(pad.top + 36, cursor.svgY - 8)}
              >
                {fmt(cursor.point.min, "")} - {fmt(cursor.point.max, "")}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}

/* ─────────── Main Archive component ─────────── */

export default function ArchiveClient() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [data, setData] = useState<DailyAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartFieldKey, setChartFieldKey] = useState<ChartFieldKey>("tempAvg");

  // Load available years
  useEffect(() => {
    let cancelled = false;
    async function loadYears() {
      try {
        const res = await fetch("/api/archive/years", { cache: "no-cache" });
        const json = (await res.json()) as YearsResponse;
        if (!cancelled) setYears(json.years ?? []);
      } catch {}
    }
    loadYears();
    return () => { cancelled = true; };
  }, []);

  // Load daily aggregates
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const params: string[] = [];
        if (selectedYear) params.push(`year=${selectedYear}`);
        if (selectedMonth) params.push(`month=${selectedMonth}`);
        const url = `/api/archive/daily?${params.join("&")}`;
        const res = await fetch(url, { cache: "no-cache" });
        const json = (await res.json()) as ArchiveResponse;
        if (!cancelled) setData(json.data ?? []);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [selectedYear, selectedMonth]);

  // Auto-select latest year
  useEffect(() => {
    if (years.length > 0 && !selectedYear) setSelectedYear(years[years.length - 1]);
  }, [years, selectedYear]);

  const chartField = CHART_FIELDS.find(f => f.key === chartFieldKey) ?? CHART_FIELDS[0];

  // Build chart data from daily aggregates for the active field
  const chartData: ArchivePoint[] = useMemo(() => {
    const rows: ArchivePoint[] = [];
    for (const row of data) {
      const avg = getField(row, chartField.avgField);
      if (avg === null) continue;
      rows.push({
        t: dateMidpointMs(row.date),
        dateStr: row.date,
        avg,
        min: chartField.minField ? getField(row, chartField.minField) : null,
        max: chartField.maxField ? getField(row, chartField.maxField) : null
      });
    }
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }, [data, chartField]);

  // Period-wide reference values (min of dailyMin, mean of dailyAvg, max of dailyMax)
  const { refMin, refAvg, refMax } = useMemo(() => {
    let minSeen: number | null = null;
    let maxSeen: number | null = null;
    let avgSum = 0;
    let avgCount = 0;
    for (const row of chartData) {
      if (row.min !== null) minSeen = minSeen === null ? row.min : Math.min(minSeen, row.min);
      if (row.max !== null) maxSeen = maxSeen === null ? row.max : Math.max(maxSeen, row.max);
      avgSum += row.avg;
      avgCount++;
    }
    return {
      refMin: minSeen,
      refAvg: avgCount > 0 ? avgSum / avgCount : null,
      refMax: maxSeen
    };
  }, [chartData]);

  // Daily emoji strip — uses the daily aggregate values directly
  const emojiStrip: ArchiveEmojiBucket[] = useMemo(() => {
    return data.map(row => {
      const temp = row.tempAvg;
      const hum = row.humidityAvg;
      const pressDelta = row.pressureMax !== null && row.pressureMin !== null
        ? row.pressureMax - row.pressureMin
        : null;
      const hasAny = temp !== null || hum !== null;
      const emoji = hasAny ? weatherEmoji(temp, hum, pressDelta) : "·";
      return {
        t: dateMidpointMs(row.date),
        emoji,
        tooltip: `${row.date} · ${fmt(temp, "°C")} · ${fmt(hum, "%")}`
      };
    });
  }, [data]);

  // Summary stats for the stat grid
  const summaryStats = useMemo(() => {
    if (data.length === 0) return null;
    let tempMin = Infinity, tempMax = -Infinity, tempSum = 0, tempCount = 0;
    for (const d of data) {
      if (d.tempMin !== null && d.tempMin < tempMin) tempMin = d.tempMin;
      if (d.tempMax !== null && d.tempMax > tempMax) tempMax = d.tempMax;
      if (d.tempAvg !== null) { tempSum += d.tempAvg; tempCount++; }
    }
    return {
      days: data.length,
      samples: data.reduce((sum, d) => sum + d.sampleCount, 0),
      tempMin: Number.isFinite(tempMin) ? tempMin : null,
      tempMax: Number.isFinite(tempMax) ? tempMax : null,
      tempAvg: tempCount > 0 ? Math.round((tempSum / tempCount) * 10) / 10 : null
    };
  }, [data]);

  const status: "online" | "waiting" | "error" = loading ? "waiting" : data.length > 0 ? "online" : "error";
  const statusText = loading ? "Loading" : data.length > 0 ? `${data.length} days` : "No data";

  return (
    <main className="station-dashboard data-page archive-page">
      {/* Header */}
      <nav className="station-header">
        <div className="station-brand-stack">
          <a className="brand station-brand-word" href="/">Archipelago</a>
          <h1><em>Archive</em></h1>
        </div>
        <div className="station-header-actions">
          <a className="station-nav-link" href="/">Dashboard</a>
          <a className="station-nav-link" href="/archive" aria-current="page">Archive</a>
          <a className="station-nav-link" href="/history">History</a>
          <a className="station-nav-link" href="/admin">Admin</a>
          <span className={`station-status ${status}`}>{statusText}</span>
        </div>
      </nav>

      {/* Meta strip */}
      <div className="station-meta-strip">
        <span>Year <strong>{selectedYear ?? "--"}</strong></span>
        <span>Month <strong>{selectedMonth === null ? "All" : MONTHS[selectedMonth - 1]}</strong></span>
        <span>Days <strong>{summaryStats?.days ?? 0}</strong></span>
        <span>Samples <strong>{summaryStats?.samples.toLocaleString() ?? "--"}</strong></span>
      </div>

      {/* Toolbar */}
      <div className="data-toolbar">
        <label>Year</label>
        <select
          value={selectedYear ?? ""}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setSelectedYear(Number.isFinite(val) ? val : null);
            setSelectedMonth(null);
          }}
        >
          {years.length === 0 && <option value="">No data</option>}
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <label>Month</label>
        <div className="chip-button-row" role="group" aria-label="Month">
          {[null, ...Array.from({ length: 12 }, (_, i) => i + 1)].map(m => (
            <button
              key={`m-${m}`}
              type="button"
              className={selectedMonth === m ? "active" : ""}
              onClick={() => setSelectedMonth(m)}
            >
              {m === null ? "All" : MONTHS[m - 1]}
            </button>
          ))}
        </div>

        <label>Series</label>
        <select
          value={chartFieldKey}
          onChange={(e) => setChartFieldKey(e.target.value as ChartFieldKey)}
        >
          {CHART_FIELDS.map(f => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Chart panel */}
      <section className="chart-panel">
        <div className="chart-panel-head">
          <div className="chart-panel-label">
            <span className={`oled-status-pixel ${chartData.length > 0 ? "live" : ""}`} />
            {chartField.label} ({chartField.unit || "—"})
          </div>
          {chartData.length > 0 && (
            <div className="chart-readout-strip">
              <span>AVG<strong>{fmt(refAvg, chartField.unit)}</strong></span>
              <span>MIN<strong>{fmt(refMin, chartField.unit)}</strong></span>
              <span>MAX<strong>{fmt(refMax, chartField.unit)}</strong></span>
            </div>
          )}
        </div>

        {chartData.length > 0 ? (
          <ArchiveChart
            data={chartData}
            unit={chartField.unit}
            refMin={refMin}
            refAvg={refAvg}
            refMax={refMax}
            emojiStrip={emojiStrip}
          />
        ) : !loading && selectedYear ? (
          <div className="chart-empty">
            No daily aggregates for {selectedYear}{selectedMonth ? ` / ${MONTHS[selectedMonth - 1]}` : ""}.
          </div>
        ) : (
          <div className="chart-empty">Loading…</div>
        )}
      </section>

      {/* Stat grid */}
      {summaryStats && (
        <section className="stat-grid" aria-label="Period summary">
          <article className="stat-card">
            <span className="stat-card-label">Days</span>
            <span className="stat-card-value">{summaryStats.days}</span>
          </article>
          <article className="stat-card">
            <span className="stat-card-label">Samples</span>
            <span className="stat-card-value">{summaryStats.samples.toLocaleString()}</span>
          </article>
          <article className="stat-card">
            <span className="stat-card-label">Avg Temp</span>
            <span className="stat-card-value">{fmt(summaryStats.tempAvg, "°C")}</span>
          </article>
          <article className="stat-card">
            <span className="stat-card-label">Min Temp</span>
            <span className="stat-card-value">{fmt(summaryStats.tempMin, "°C")}</span>
          </article>
          <article className="stat-card">
            <span className="stat-card-label">Max Temp</span>
            <span className="stat-card-value">{fmt(summaryStats.tempMax, "°C")}</span>
          </article>
        </section>
      )}

      {/* Daily records table */}
      {data.length > 0 && (
        <section className="archive-table-section" aria-label="Daily aggregates">
          <h2>Daily Records</h2>
          <table className="archive-daily-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Samples</th>
                <th>Temp Min/Max/Avg</th>
                <th>Humidity Avg</th>
                <th>Pressure Avg</th>
                <th>Wind Max</th>
                <th>Solar Max</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.date}>
                  <td>{dateLabel(d.date)}</td>
                  <td>{d.sampleCount}</td>
                  <td>{fmt(d.tempMin, "°")} / {fmt(d.tempMax, "°")} / {fmt(d.tempAvg, "°")}</td>
                  <td>{fmt(d.humidityAvg, "%")}</td>
                  <td>{fmt(d.pressureAvg, "")}</td>
                  <td>{fmt(d.windSpeedMax, "m/s")}</td>
                  <td>{fmt(d.solarMax, "W")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
