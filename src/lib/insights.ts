import type { DisplayReading, WeatherStationTelemetry } from "./telemetry";

type Reading = {
  label: string;
  unit: string;
  value: number;
};

type BatterySocPoint = {
  voltagePerCell: number;
  percent: number;
};

export type InsightValue = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
};

export type WeatherInsights = {
  temperatureC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  batteryVoltage: number | null;
  batteryPercent: number | null;
  dewPointC: number | null;
  heatIndexC: number | null;
  pressureDeltaHpa: number | null;
  sampleCadenceMinutes: number | null;
  sunSharePct: number | null;
  summary: string;
  values: InsightValue[];
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readings(snapshot: WeatherStationTelemetry | null | undefined): Reading[] {
  const result: Reading[] = [];
  snapshot?.displays?.forEach((display: DisplayReading) => {
    const primary = toNumber(display.primary);
    if (primary !== null) {
      result.push({
        label: display.label ?? "",
        unit: display.primaryUnit ?? "",
        value: primary
      });
    }

    const secondary = toNumber(display.secondary);
    if (secondary !== null) {
      result.push({
        label: `${display.label ?? ""} ${display.secondaryLabel ?? ""}`.trim(),
        unit: display.secondaryUnit ?? "",
        value: secondary
      });
    }
  });
  return result;
}

function labelIncludes(reading: Reading, words: string[]) {
  const label = reading.label.toLowerCase();
  return words.some(word => label.includes(word));
}

function unitIncludes(reading: Reading, words: string[]) {
  const unit = reading.unit.toLowerCase();
  return words.some(word => unit.includes(word));
}

function firstReading(snapshot: WeatherStationTelemetry | null | undefined, predicate: (reading: Reading) => boolean) {
  return readings(snapshot).find(predicate);
}

function temperatureC(snapshot: WeatherStationTelemetry | null | undefined) {
  const reading = firstReading(snapshot, item =>
    labelIncludes(item, ["temp", "temperature"]) || unitIncludes(item, ["°c", "c", "°f", "f"])
  );
  if (!reading) return null;
  const unit = reading.unit.toLowerCase();
  if (unit.includes("f") && !unit.includes("c")) return (reading.value - 32) * 5 / 9;
  return reading.value;
}

function humidityPct(snapshot: WeatherStationTelemetry | null | undefined) {
  const reading = firstReading(snapshot, item =>
    labelIncludes(item, ["humid", "rh"]) || unitIncludes(item, ["%"])
  );
  if (!reading) return null;
  return Math.max(0, Math.min(100, reading.value));
}

function pressureHpa(snapshot: WeatherStationTelemetry | null | undefined) {
  const reading = firstReading(snapshot, item =>
    labelIncludes(item, ["press", "baro"]) || unitIncludes(item, ["hpa", "mbar", "kpa", "pa", "inhg"])
  );
  if (!reading) return null;
  const unit = reading.unit.toLowerCase();
  if (unit.includes("inhg")) return reading.value * 33.8639;
  if (unit.includes("kpa")) return reading.value * 10;
  if (unit === "pa") return reading.value / 100;
  return reading.value;
}

function batteryVoltage(snapshot: WeatherStationTelemetry | null | undefined) {
  const reading = firstReading(snapshot, item =>
    labelIncludes(item, ["bat", "batt", "battery", "vbat"]) && unitIncludes(item, ["v"])
  );
  return reading?.value ?? null;
}

const liIonSocCurve4s: BatterySocPoint[] = [
  { voltagePerCell: 3.00, percent: 0 },
  { voltagePerCell: 3.30, percent: 5 },
  { voltagePerCell: 3.35, percent: 10 },
  { voltagePerCell: 3.42, percent: 15 },
  { voltagePerCell: 3.48, percent: 20 },
  { voltagePerCell: 3.53, percent: 25 },
  { voltagePerCell: 3.56, percent: 30 },
  { voltagePerCell: 3.59, percent: 35 },
  { voltagePerCell: 3.61, percent: 40 },
  { voltagePerCell: 3.64, percent: 45 },
  { voltagePerCell: 3.68, percent: 50 },
  { voltagePerCell: 3.73, percent: 55 },
  { voltagePerCell: 3.78, percent: 60 },
  { voltagePerCell: 3.83, percent: 65 },
  { voltagePerCell: 3.87, percent: 70 },
  { voltagePerCell: 3.91, percent: 75 },
  { voltagePerCell: 3.95, percent: 80 },
  { voltagePerCell: 4.01, percent: 85 },
  { voltagePerCell: 4.06, percent: 90 },
  { voltagePerCell: 4.11, percent: 95 },
  { voltagePerCell: 4.20, percent: 100 }
];

function inferSeriesCells(fullVoltage: number) {
  const inferred = Math.round(fullVoltage / 4.2);
  return Math.max(1, Math.min(8, inferred));
}

function curveBatteryPercentFromVoltage(voltage: number, seriesCells: number) {
  const vCell = voltage / seriesCells;
  const first = liIonSocCurve4s[0];
  const last = liIonSocCurve4s[liIonSocCurve4s.length - 1];
  if (vCell <= first.voltagePerCell) return first.percent;
  if (vCell >= last.voltagePerCell) return last.percent;

  for (let i = 1; i < liIonSocCurve4s.length; i += 1) {
    const lower = liIonSocCurve4s[i - 1];
    const upper = liIonSocCurve4s[i];
    if (vCell > upper.voltagePerCell) continue;
    const span = upper.voltagePerCell - lower.voltagePerCell;
    if (span <= 0) return lower.percent;
    const t = (vCell - lower.voltagePerCell) / span;
    return lower.percent + (upper.percent - lower.percent) * t;
  }

  return last.percent;
}

function batteryPercent(snapshot: WeatherStationTelemetry | null | undefined, voltage: number | null) {
  const direct = firstReading(snapshot, item =>
    labelIncludes(item, ["bat", "batt", "battery"]) && unitIncludes(item, ["%"])
  );
  if (direct) return Math.max(0, Math.min(100, direct.value));

  const empty = snapshot?.config?.batteryPercentEmptyVoltageV;
  const full = snapshot?.config?.batteryPercentFullVoltageV;
  if (voltage === null || empty === undefined || full === undefined || full <= empty) return null;
  if (voltage <= empty) return 0;
  if (voltage >= full) return 100;
  const cells = inferSeriesCells(full);
  return Math.max(0, Math.min(100, curveBatteryPercentFromVoltage(voltage, cells)));
}

function dewPointC(tempC: number | null, humidity: number | null) {
  if (tempC === null || humidity === null || humidity <= 0) return null;
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(humidity / 100) + (a * tempC) / (b + tempC);
  return (b * gamma) / (a - gamma);
}

function heatIndexC(tempC: number | null, humidity: number | null) {
  if (tempC === null || humidity === null || tempC < 26.7 || humidity < 40) return null;
  const t = tempC * 9 / 5 + 32;
  const r = humidity;
  const hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * r -
    0.22475541 * t * r -
    0.00683783 * t * t -
    0.05481717 * r * r +
    0.00122874 * t * t * r +
    0.00085282 * t * r * r -
    0.00000199 * t * t * r * r;
  return (hi - 32) * 5 / 9;
}

function pressureDeltaHpa(history: WeatherStationTelemetry[]) {
  const ordered = [...history].reverse();
  const points = ordered
    .map(snapshot => ({
      t: snapshot.receivedAt ? new Date(snapshot.receivedAt).getTime() : NaN,
      v: pressureHpa(snapshot)
    }))
    .filter((point): point is { t: number; v: number } => Number.isFinite(point.t) && point.v !== null);

  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = last.t - 3 * 60 * 60 * 1000;
  let earlier = points[0];
  for (const point of points) {
    if (point.t <= target) earlier = point;
    else break;
  }
  if (earlier === last) return null;
  return last.v - earlier.v;
}

function sampleCadenceMinutes(history: WeatherStationTelemetry[]) {
  const times = history
    .map(snapshot => snapshot.receivedAt ? new Date(snapshot.receivedAt).getTime() : NaN)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .slice(-12);
  if (times.length < 2) return null;

  const gaps = times.slice(1).map((time, index) => time - times[index]).filter(gap => gap > 0);
  if (gaps.length === 0) return null;
  return gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length / 60000;
}

function sunSharePct(history: WeatherStationTelemetry[]) {
  const withMode = history.filter(snapshot => snapshot.solarMode);
  if (withMode.length === 0) return null;
  const sun = withMode.filter(snapshot => snapshot.solarMode?.toLowerCase() === "sun").length;
  return sun / withMode.length * 100;
}

function formatC(value: number | null) {
  return value === null ? "--" : `${value.toFixed(1)} °C`;
}

function formatPct(value: number | null) {
  return value === null ? "--" : `${Math.round(value)}%`;
}

function formatPressureDelta(value: number | null) {
  if (value === null) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} hPa`;
}

function formatCadence(value: number | null) {
  if (value === null) return "--";
  if (value < 1) return `${Math.round(value * 60)}s`;
  return `${value.toFixed(value >= 10 ? 0 : 1)}m`;
}

function pressureTone(delta: number | null): InsightValue["tone"] {
  if (delta === null) return undefined;
  if (delta > 1.5) return "ok";
  if (delta < -1.5) return "warn";
  return undefined;
}

function batteryTone(percent: number | null): InsightValue["tone"] {
  if (percent === null) return undefined;
  if (percent < 20) return "bad";
  if (percent < 45) return "warn";
  return "ok";
}

function tempDescription(tempC: number | null): string {
  if (tempC === null) return "";
  if (tempC < 5) return "It's quite cold outside";
  if (tempC < 12) return "It's a bit chilly";
  if (tempC < 18) return "It's cool out";
  if (tempC < 24) return "It's pleasant outside";
  if (tempC < 30) return "It's warm out";
  if (tempC < 35) return "It's getting hot";
  return "It's very hot outside";
}

function humidityDescription(humidity: number | null): string {
  if (humidity === null) return "";
  if (humidity < 30) return "the air is dry";
  if (humidity < 50) return "humidity is comfortable";
  if (humidity < 70) return "it's a bit humid";
  if (humidity < 85) return "the air feels muggy";
  return "it's very humid";
}

function pressureNarrative(delta: number | null): string {
  if (delta === null) return "";
  if (delta > 2) return "The pressure is rising steadily, suggesting clearing skies and calmer weather ahead.";
  if (delta > 1.5) return "The pressure is rising, which often means improving conditions.";
  if (delta < -2) return "The pressure is dropping, which could bring unsettled weather.";
  if (delta < -1.5) return "The pressure is falling, suggesting the weather may turn.";
  return "The pressure has been steady, indicating stable conditions.";
}

function batteryNarrative(percent: number | null): string {
  if (percent === null) return "";
  if (percent < 15) return "The station battery is critically low and needs attention.";
  if (percent < 30) return "The station battery is getting low.";
  if (percent < 50) return "The station battery is at a moderate level.";
  return "The station battery is healthy.";
}

function buildSummary(insights: Omit<WeatherInsights, "summary" | "values">) {
  const sentences: string[] = [];

  // Sentence 1: Temperature and comfort
  if (insights.temperatureC !== null) {
    const temp = tempDescription(insights.temperatureC);
    const humidity = humidityDescription(insights.humidityPct);
    if (temp && humidity) {
      sentences.push(`${temp}, and ${humidity}.`);
    } else if (temp) {
      sentences.push(`${temp}.`);
    }
  }

  // Sentence 2: Pressure trend
  if (insights.pressureDeltaHpa !== null) {
    sentences.push(pressureNarrative(insights.pressureDeltaHpa));
  }

  if (sentences.length === 0) {
    return "Waiting for more data to build a weather report.";
  }

  return sentences.join(" ");
}

export function deriveWeatherInsights(latest: WeatherStationTelemetry | null | undefined, history: WeatherStationTelemetry[] = []): WeatherInsights {
  const temp = temperatureC(latest);
  const humidity = humidityPct(latest);
  const pressure = pressureHpa(latest);
  const voltage = batteryVoltage(latest);
  const battery = batteryPercent(latest, voltage);
  const dewPoint = dewPointC(temp, humidity);
  const heatIndex = heatIndexC(temp, humidity);
  const pressureDelta = pressureDeltaHpa(history);
  const cadence = sampleCadenceMinutes(history);
  const sunShare = sunSharePct(history);
  const base = {
    temperatureC: temp,
    humidityPct: humidity,
    pressureHpa: pressure,
    batteryVoltage: voltage,
    batteryPercent: battery,
    dewPointC: dewPoint,
    heatIndexC: heatIndex,
    pressureDeltaHpa: pressureDelta,
    sampleCadenceMinutes: cadence,
    sunSharePct: sunShare
  };

  return {
    ...base,
    summary: buildSummary(base),
    values: [
      { label: "Dew Point", value: formatC(dewPoint) },
      { label: "Feels Like", value: heatIndex === null ? "N/A" : formatC(heatIndex), tone: heatIndex !== null && heatIndex > 32 ? "warn" : undefined },
      { label: "Pressure Trend", value: formatPressureDelta(pressureDelta), tone: pressureTone(pressureDelta) },
      { label: "Battery", value: battery !== null ? formatPct(battery) : voltage !== null ? `${voltage.toFixed(2)} V` : "--", tone: batteryTone(battery) },
      { label: "Update Rate", value: formatCadence(cadence) },
      { label: "Sun Exposure", value: formatPct(sunShare) }
    ]
  };
}
