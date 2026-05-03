import { deriveWeatherInsights } from "./insights";
import type { WeatherStationTelemetry } from "./telemetry";

export type EventSeverity = "ok" | "info" | "warn" | "bad";

export type StationEvent = {
  id: string;
  at: string;
  severity: EventSeverity;
  category: string;
  title: string;
  detail: string;
};

export type ActiveAlert = {
  id: string;
  severity: EventSeverity;
  title: string;
  detail: string;
};

const offlineAfterMs = 15 * 60 * 1000;
const pressureDropHpa = -3;

function timeOf(snapshot: WeatherStationTelemetry) {
  return snapshot.receivedAt ? new Date(snapshot.receivedAt).getTime() : NaN;
}

function eventId(at: string, category: string, title: string, detail: string) {
  return `${at}:${category}:${title}:${detail}`;
}

function elapsedLabel(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function modeLabel(mode: string | undefined) {
  return mode ? mode.slice(0, 1).toUpperCase() + mode.slice(1).toLowerCase() : "Unknown";
}

function postOk(snapshot: WeatherStationTelemetry) {
  const code = snapshot.wifi?.lastPostCode;
  return code === undefined || code === 200;
}

function networkLabel(snapshot: WeatherStationTelemetry) {
  if (snapshot.wifi?.sta) return "Station";
  if (snapshot.wifi?.ap) return "Access Point";
  return "Offline";
}

function sensorEntries(snapshot: WeatherStationTelemetry) {
  return snapshot.sensors ? Object.entries(snapshot.sensors) : [];
}

function pushEvent(events: StationEvent[], snapshot: WeatherStationTelemetry, severity: EventSeverity, category: string, title: string, detail: string) {
  if (!snapshot.receivedAt) return;
  events.push({
    id: eventId(snapshot.receivedAt, category, title, detail),
    at: snapshot.receivedAt,
    severity,
    category,
    title,
    detail
  });
}

export function deriveActiveAlerts(latest: WeatherStationTelemetry | null | undefined, history: WeatherStationTelemetry[]): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];
  const insights = deriveWeatherInsights(latest, history);

  if (!latest?.receivedAt) {
    alerts.push({
      id: "no-telemetry",
      severity: "warn",
      title: "No telemetry yet",
      detail: "The website has not received a station payload."
    });
    return alerts;
  }

  const ageMs = Date.now() - new Date(latest.receivedAt).getTime();
  if (ageMs > offlineAfterMs) {
    alerts.push({
      id: "offline",
      severity: "bad",
      title: "Station offline",
      detail: `No telemetry has arrived for ${elapsedLabel(ageMs)}.`
    });
  }

  if (insights.batteryPercent !== null && insights.batteryPercent < 20) {
    alerts.push({
      id: "battery-low",
      severity: "bad",
      title: "Battery low",
      detail: `Battery is estimated at ${Math.round(insights.batteryPercent)}%.`
    });
  } else if (insights.batteryPercent !== null && insights.batteryPercent < 45) {
    alerts.push({
      id: "battery-watch",
      severity: "warn",
      title: "Battery watch",
      detail: `Battery is estimated at ${Math.round(insights.batteryPercent)}%.`
    });
  }

  const failedSensors = sensorEntries(latest).filter(([, ok]) => !ok).map(([name]) => name);
  if (failedSensors.length > 0) {
    alerts.push({
      id: "sensor-failure",
      severity: "bad",
      title: "Sensor failure",
      detail: failedSensors.join(", ")
    });
  }

  if (latest.wifi?.lastPostCode !== undefined && latest.wifi.lastPostCode !== 200) {
    alerts.push({
      id: "post-failure",
      severity: "warn",
      title: "Post failure",
      detail: `${latest.wifi.lastPostCode}${latest.wifi.lastPostMessage ? ` · ${latest.wifi.lastPostMessage}` : ""}`
    });
  }

  if (insights.pressureDeltaHpa !== null && insights.pressureDeltaHpa <= pressureDropHpa) {
    alerts.push({
      id: "pressure-drop",
      severity: "warn",
      title: "Pressure falling",
      detail: `Pressure changed ${insights.pressureDeltaHpa.toFixed(1)} hPa over roughly three hours.`
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "all-clear",
      severity: "ok",
      title: "All clear",
      detail: "No active station alerts from the latest telemetry."
    });
  }

  return alerts;
}

export function deriveStationEvents(history: WeatherStationTelemetry[], limit = 18): StationEvent[] {
  const ordered = [...history]
    .filter(snapshot => Number.isFinite(timeOf(snapshot)))
    .sort((a, b) => timeOf(a) - timeOf(b));
  const events: StationEvent[] = [];
  let lastPressureEventAt = 0;

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const previousTime = timeOf(previous);
    const currentTime = timeOf(current);
    const gap = currentTime - previousTime;

    if (gap > offlineAfterMs) {
      pushEvent(events, current, "ok", "Connectivity", "Station returned", `Telemetry resumed after a ${elapsedLabel(gap)} silence.`);
    }

    if (previous.solarMode !== current.solarMode) {
      pushEvent(events, current, "info", "Power", "Solar mode changed", `${modeLabel(previous.solarMode)} to ${modeLabel(current.solarMode)}.`);
    }

    if (networkLabel(previous) !== networkLabel(current)) {
      pushEvent(events, current, current.wifi?.sta ? "ok" : "warn", "Network", "Network mode changed", `${networkLabel(previous)} to ${networkLabel(current)}.`);
    }

    if (previous.displaysForcedOff !== current.displaysForcedOff) {
      pushEvent(events, current, current.displaysForcedOff ? "warn" : "ok", "Display", current.displaysForcedOff ? "Displays forced off" : "Displays restored", "Display power state changed.");
    }

    if (previous.firmwareVersion && current.firmwareVersion && previous.firmwareVersion !== current.firmwareVersion) {
      pushEvent(events, current, "ok", "Firmware", "Firmware changed", `${previous.firmwareVersion} to ${current.firmwareVersion}.`);
    }

    if (previous.spiffsVersion && current.spiffsVersion && previous.spiffsVersion !== current.spiffsVersion) {
      pushEvent(events, current, "ok", "Firmware", "SPIFFS changed", `${previous.spiffsVersion} to ${current.spiffsVersion}.`);
    }

    if (postOk(previous) !== postOk(current)) {
      pushEvent(
        events,
        current,
        postOk(current) ? "ok" : "warn",
        "Posting",
        postOk(current) ? "Posting recovered" : "Post failure",
        current.wifi?.lastPostCode ? `${current.wifi.lastPostCode}${current.wifi.lastPostMessage ? ` · ${current.wifi.lastPostMessage}` : ""}` : "Post state changed."
      );
    }

    const previousSensors = new Map(sensorEntries(previous));
    for (const [name, ok] of sensorEntries(current)) {
      const before = previousSensors.get(name);
      if (before === undefined || before === ok) continue;
      pushEvent(events, current, ok ? "ok" : "bad", "Sensors", ok ? "Sensor recovered" : "Sensor flagged", name);
    }

    const previousBattery = deriveWeatherInsights(previous).batteryPercent;
    const currentBattery = deriveWeatherInsights(current).batteryPercent;
    if (previousBattery !== null && currentBattery !== null) {
      if (previousBattery >= 20 && currentBattery < 20) {
        pushEvent(events, current, "bad", "Power", "Battery low", `Battery crossed below 20% to ${Math.round(currentBattery)}%.`);
      }
      if (previousBattery < 30 && currentBattery >= 30) {
        pushEvent(events, current, "ok", "Power", "Battery recovered", `Battery recovered to ${Math.round(currentBattery)}%.`);
      }
    }

    const currentPressure = deriveWeatherInsights(current).pressureHpa;
    if (currentPressure !== null && currentTime - lastPressureEventAt > 3 * 60 * 60 * 1000) {
      const earlier = ordered
        .slice(0, index)
        .map(snapshot => ({ snapshot, delta: Math.abs(timeOf(snapshot) - (currentTime - 3 * 60 * 60 * 1000)) }))
        .sort((a, b) => a.delta - b.delta)[0]?.snapshot;
      const earlierPressure = deriveWeatherInsights(earlier).pressureHpa;
      if (earlierPressure !== null) {
        const delta = currentPressure - earlierPressure;
        if (delta <= pressureDropHpa) {
          pushEvent(events, current, "warn", "Weather", "Pressure dropped", `${delta.toFixed(1)} hPa over roughly three hours.`);
          lastPressureEventAt = currentTime;
        }
      }
    }
  }

  const latest = ordered[ordered.length - 1];
  if (latest?.receivedAt) {
    const ageMs = Date.now() - new Date(latest.receivedAt).getTime();
    if (ageMs > offlineAfterMs) {
      events.push({
        id: "current-offline",
        at: new Date().toISOString(),
        severity: "bad",
        category: "Connectivity",
        title: "Station offline",
        detail: `No telemetry has arrived for ${elapsedLabel(ageMs)}.`
      });
    }
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}
