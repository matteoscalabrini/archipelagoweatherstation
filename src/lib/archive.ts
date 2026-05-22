import type { DisplayReading, WeatherStationTelemetry } from "./telemetry";

/* ==========================================================================
   ARCHIVE — Daily Aggregation Types & Extraction Logic
   ========================================================================== */

/** A single day's aggregated weather summary. */
export type DailyAggregate = {
  date: string;              // "2026-05-22"
  year: number;
  month: number;
  day: number;
  sampleCount: number;

  tempMin: number | null;
  tempMax: number | null;
  tempAvg: number | null;

  humidityMin: number | null;
  humidityMax: number | null;
  humidityAvg: number | null;

  pressureMin: number | null;
  pressureMax: number | null;
  pressureAvg: number | null;

  windSpeedMin: number | null;
  windSpeedMax: number | null;
  windSpeedAvg: number | null;

  windDirAvg: number | null;

  solarMax: number | null;
  solarAvg: number | null;
  solarTotalWh: number | null;

  batteryVoltageMin: number | null;
  batteryVoltageMax: number | null;
  batteryVoltageAvg: number | null;
  batteryPercentMin: number | null;
  batteryPercentMax: number | null;
  batteryPercentAvg: number | null;

  firstSampleAt: string;     // ISO timestamp
  lastSampleAt: string;      // ISO timestamp
};

/** Running accumulator for a single day — used to build DailyAggregate. */
export type DailyAccumulator = {
  date: string;
  year: number;
  month: number;
  day: number;

  count: number;

  tempSum: number | null;
  tempMin: number | null;
  tempMax: number | null;

  humiditySum: number | null;
  humidityMin: number | null;
  humidityMax: number | null;

  pressureSum: number | null;
  pressureMin: number | null;
  pressureMax: number | null;

  windSpeedSum: number | null;
  windSpeedMin: number | null;
  windSpeedMax: number | null;

  windDirSinSum: number;     // for circular mean
  windDirCosSum: number;
  windDirCount: number;

  solarSum: number | null;
  solarMax: number | null;
  solarTotalWh: number | null;

  batteryVoltageSum: number | null;
  batteryVoltageMin: number | null;
  batteryVoltageMax: number | null;
  batteryPercentSum: number | null;
  batteryPercentMin: number | null;
  batteryPercentMax: number | null;

  firstSampleAt: string;     // ISO timestamp
  lastSampleAt: string;      // ISO timestamp
};

/** Compact raw telemetry line for blob storage. */
export type RawTelemetryLine = {
  t: string;       // receivedAt (ISO)
  temp?: number;
  hum?: number;
  pres?: number;
  ws?: number;
  wd?: number;
  sol?: number;
  batV?: number;
  batPct?: number;
};

/* ==========================================================================
   Sensor Value Extraction
   ========================================================================== */

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function labelIncludes(reading: DisplayReading, words: string[]) {
  const label = (reading.label ?? "").toLowerCase();
  return words.some(w => label.includes(w));
}

function unitIncludes(reading: DisplayReading, words: string[]) {
  const unit = (reading.primaryUnit ?? "").toLowerCase();
  return words.some(w => unit.includes(w));
}

/** Extract a single sensor value from displays[] by label/unit match. */
export function extractSensorValue(
  snapshot: WeatherStationTelemetry,
  labels: string[],
  units: string[]
): number | null {
  const display = snapshot.displays?.find(d =>
    (labelIncludes as any)(d, labels) || unitIncludes(d, units)
  );
  if (!display) return null;
  let val = toNumber(display.primary);
  // Convert Fahrenheit to Celsius for temperature
  if ((units.includes("°f") || units.includes("f")) && !units.includes("c")) {
    if (val !== null) val = (val - 32) * 5 / 9;
  }
  return val;
}

/** Extract all sensor values from a telemetry payload. */
export function extractSensorValues(snapshot: WeatherStationTelemetry): {
  tempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  solarW: number | null;
  batteryVoltageV: number | null;
  batteryPercent: number | null;
} {
  return {
    tempC: extractSensorValue(snapshot, ["temp", "temperature"], ["°c", "c"]),
    humidityPct: extractSensorValue(snapshot, ["humid", "rh"], ["%"]),
    pressureHpa: extractSensorValue(snapshot, ["pres", "pressure"], ["hpa", "mb"]),
    windSpeedMs: extractSensorValue(snapshot, ["wind spd", "wind speed", "wind"], ["m/s", "km/h"]),
    windDirDeg: extractSensorValue(snapshot, ["wind dir", "direction"], ["deg"]),
    solarW: extractSensorValue(snapshot, ["solar"], ["w"]),
    batteryVoltageV: extractSensorValue(snapshot, ["battery", "bat"], ["v"]),
    batteryPercent: extractSensorValue(snapshot, ["bat lvl", "battery level", "battery"], ["%"])
  };
}

/* ==========================================================================
   Accumulator Logic
   ========================================================================== */

/** Create a fresh accumulator for the given date. */
export function createAccumulator(dateStr: string): DailyAccumulator {
  const [y, m, d] = dateStr.split("-").map(Number);
  return {
    date: dateStr,
    year: y,
    month: m,
    day: d,

    count: 0,

    tempSum: null,
    tempMin: null,
    tempMax: null,

    humiditySum: null,
    humidityMin: null,
    humidityMax: null,

    pressureSum: null,
    pressureMin: null,
    pressureMax: null,

    windSpeedSum: null,
    windSpeedMin: null,
    windSpeedMax: null,

    windDirSinSum: 0,
    windDirCosSum: 0,
    windDirCount: 0,

    solarSum: null,
    solarMax: null,
    solarTotalWh: null,

    batteryVoltageSum: null,
    batteryVoltageMin: null,
    batteryVoltageMax: null,
    batteryPercentSum: null,
    batteryPercentMin: null,
    batteryPercentMax: null,

    firstSampleAt: "",
    lastSampleAt: ""
  };
}

/** Update an accumulator with a new telemetry sample. */
export function updateAccumulator(
  acc: DailyAccumulator,
  snapshot: WeatherStationTelemetry
): void {
  const v = extractSensorValues(snapshot);
  const receivedAt = snapshot.receivedAt ?? "";

  if (acc.count === 0) {
    acc.firstSampleAt = receivedAt;
  }
  acc.lastSampleAt = receivedAt;

  // Temperature
  updateMinMaxSum(acc, "temp", v.tempC);

  // Humidity
  updateMinMaxSum(acc, "humidity", v.humidityPct);

  // Pressure
  updateMinMaxSum(acc, "pressure", v.pressureHpa);

  // Wind Speed
  updateMinMaxSum(acc, "windSpeed", v.windSpeedMs);

  // Wind Direction (circular mean)
  if (v.windDirDeg !== null) {
    const rad = (v.windDirDeg * Math.PI) / 180;
    acc.windDirSinSum += Math.sin(rad);
    acc.windDirCosSum += Math.cos(rad);
    acc.windDirCount++;
  }

  // Solar
  updateMinMaxSum(acc, "solar", v.solarW);

  // Battery Voltage
  updateMinMaxSum(acc, "batteryVoltage", v.batteryVoltageV);

  // Battery Percent
  updateMinMaxSum(acc, "batteryPercent", v.batteryPercent);

  acc.count++;
}

/** Helper to update min/max/sum for a sensor field. */
function updateMinMaxSum(
  acc: DailyAccumulator,
  prefix: string,
  value: number | null
): void {
  if (value === null) return;

  const sumKey = `${prefix}Sum` as keyof DailyAccumulator;
  const minKey = `${prefix}Min` as keyof DailyAccumulator;
  const maxKey = `${prefix}Max` as keyof DailyAccumulator;

  // Update sum
  if (acc[sumKey] === null) {
    (acc as any)[sumKey] = value;
  } else {
    (acc as any)[sumKey] += value;
  }

  // Update min
  const currentMin = acc[minKey];
  if (currentMin === null || value < (currentMin as number)) {
    (acc as any)[minKey] = value;
  }

  // Update max
  const currentMax = acc[maxKey];
  if (currentMax === null || value > (currentMax as number)) {
    (acc as any)[maxKey] = value;
  }
}

/** Convert a running accumulator into the final DailyAggregate record. */
export function finalizeAccumulator(acc: DailyAccumulator): DailyAggregate {
  const n = Math.max(1, acc.count);

  // Wind direction circular mean
  let windDirAvg: number | null = null;
  if (acc.windDirCount > 0) {
    const avgSin = acc.windDirSinSum / acc.windDirCount;
    const avgCos = acc.windDirCosSum / acc.windDirCount;
    windDirAvg = ((Math.atan2(avgSin, avgCos) * 180) / Math.PI + 360) % 360;
  }

  return {
    date: acc.date,
    year: acc.year,
    month: acc.month,
    day: acc.day,
    sampleCount: acc.count,

    tempMin: acc.tempMin,
    tempMax: acc.tempMax,
    tempAvg: acc.tempSum !== null ? Math.round((acc.tempSum / n) * 100) / 100 : null,

    humidityMin: acc.humidityMin,
    humidityMax: acc.humidityMax,
    humidityAvg: acc.humiditySum !== null ? Math.round((acc.humiditySum / n) * 100) / 100 : null,

    pressureMin: acc.pressureMin,
    pressureMax: acc.pressureMax,
    pressureAvg: acc.pressureSum !== null ? Math.round((acc.pressureSum / n) * 100) / 100 : null,

    windSpeedMin: acc.windSpeedMin,
    windSpeedMax: acc.windSpeedMax,
    windSpeedAvg: acc.windSpeedSum !== null ? Math.round((acc.windSpeedSum / n) * 100) / 100 : null,

    windDirAvg: windDirAvg !== null ? Math.round(windDirAvg * 10) / 10 : null,

    solarMax: acc.solarMax,
    solarAvg: acc.solarSum !== null ? Math.round((acc.solarSum / n) * 100) / 100 : null,
    solarTotalWh: acc.solarTotalWh,

    batteryVoltageMin: acc.batteryVoltageMin,
    batteryVoltageMax: acc.batteryVoltageMax,
    batteryVoltageAvg: acc.batteryVoltageSum !== null ? Math.round((acc.batteryVoltageSum / n) * 100) / 100 : null,
    batteryPercentMin: acc.batteryPercentMin,
    batteryPercentMax: acc.batteryPercentMax,
    batteryPercentAvg: acc.batteryPercentSum !== null ? Math.round((acc.batteryPercentSum / n) * 100) / 100 : null,

    firstSampleAt: acc.firstSampleAt,
    lastSampleAt: acc.lastSampleAt
  };
}

/* ==========================================================================
   Raw Telemetry Line Extraction (for Blob storage)
   ========================================================================== */

/** Extract a compact raw telemetry line from a full payload. */
export function extractRawTelemetryLine(snapshot: WeatherStationTelemetry): RawTelemetryLine {
  const v = extractSensorValues(snapshot);
  return {
    t: snapshot.receivedAt ?? "",
    ...(v.tempC !== null ? { temp: Math.round(v.tempC * 10) / 10 } : {}),
    ...(v.humidityPct !== null ? { hum: Math.round(v.humidityPct * 10) / 10 } : {}),
    ...(v.pressureHpa !== null ? { pres: Math.round(v.pressureHpa * 10) / 10 } : {}),
    ...(v.windSpeedMs !== null ? { ws: Math.round(v.windSpeedMs * 10) / 10 } : {}),
    ...(v.windDirDeg !== null ? { wd: Math.round(v.windDirDeg) } : {}),
    ...(v.solarW !== null ? { sol: Math.round(v.solarW * 10) / 10 } : {}),
    ...(v.batteryVoltageV !== null ? { batV: Math.round(v.batteryVoltageV * 100) / 100 } : {}),
    ...(v.batteryPercent !== null ? { batPct: Math.round(v.batteryPercent * 10) / 10 } : {})
  };
}

/* ==========================================================================
   Date Helpers
   ========================================================================== */

/** Get the date string (YYYY-MM-DD) from an ISO timestamp. */
export function getDateStr(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}