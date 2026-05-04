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

export type AlertRules = {
  offlineAfterMinutes: number;
  batteryWarnPercent: number;
  batteryBadPercent: number;
  pressureDropHpa: number;
  eventLimit: number;
  batteryAlerts: boolean;
  sensorAlerts: boolean;
  postFailureAlerts: boolean;
  pressureAlerts: boolean;
};

export type AlertRulesRecord = {
  rules: AlertRules;
  updatedAt: string | null;
};

export const defaultAlertRules: AlertRules = {
  offlineAfterMinutes: 15,
  batteryWarnPercent: 45,
  batteryBadPercent: 20,
  pressureDropHpa: 3,
  eventLimit: 18,
  batteryAlerts: true,
  sensorAlerts: true,
  postFailureAlerts: true,
  pressureAlerts: true
};

function optionalNumber(value: unknown, fallback: number, min: number, max: number, integer = false) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(clamped) : clamped;
}

function optionalBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeAlertRules(value: unknown): AlertRules {
  const source = typeof value === "object" && value !== null ? value as Partial<AlertRules> : {};
  const batteryBadPercent = optionalNumber(source.batteryBadPercent, defaultAlertRules.batteryBadPercent, 0, 100, true);
  const batteryWarnPercent = Math.max(
    batteryBadPercent,
    optionalNumber(source.batteryWarnPercent, defaultAlertRules.batteryWarnPercent, 0, 100, true)
  );

  return {
    offlineAfterMinutes: optionalNumber(source.offlineAfterMinutes, defaultAlertRules.offlineAfterMinutes, 1, 1440, true),
    batteryWarnPercent,
    batteryBadPercent,
    pressureDropHpa: optionalNumber(source.pressureDropHpa, defaultAlertRules.pressureDropHpa, 0.1, 50),
    eventLimit: optionalNumber(source.eventLimit, defaultAlertRules.eventLimit, 1, 100, true),
    batteryAlerts: optionalBoolean(source.batteryAlerts, defaultAlertRules.batteryAlerts),
    sensorAlerts: optionalBoolean(source.sensorAlerts, defaultAlertRules.sensorAlerts),
    postFailureAlerts: optionalBoolean(source.postFailureAlerts, defaultAlertRules.postFailureAlerts),
    pressureAlerts: optionalBoolean(source.pressureAlerts, defaultAlertRules.pressureAlerts)
  };
}

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
  if (snapshot.wifi?.recoveryAp) return "Recovery AP";
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

export function deriveActiveAlerts(
  latest: WeatherStationTelemetry | null | undefined,
  history: WeatherStationTelemetry[],
  alertRules: Partial<AlertRules> = defaultAlertRules
): ActiveAlert[] {
  const rules = sanitizeAlertRules(alertRules);
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
  if (ageMs > rules.offlineAfterMinutes * 60 * 1000) {
    alerts.push({
      id: "offline",
      severity: "bad",
      title: "Station offline",
      detail: `No telemetry has arrived for ${elapsedLabel(ageMs)}.`
    });
  }

  if (rules.batteryAlerts && insights.batteryPercent !== null && insights.batteryPercent < rules.batteryBadPercent) {
    alerts.push({
      id: "battery-low",
      severity: "bad",
      title: "Battery low",
      detail: `Battery is estimated at ${Math.round(insights.batteryPercent)}%.`
    });
  } else if (rules.batteryAlerts && insights.batteryPercent !== null && insights.batteryPercent < rules.batteryWarnPercent) {
    alerts.push({
      id: "battery-watch",
      severity: "warn",
      title: "Battery watch",
      detail: `Battery is estimated at ${Math.round(insights.batteryPercent)}%.`
    });
  }

  const failedSensors = sensorEntries(latest).filter(([, ok]) => !ok).map(([name]) => name);
  if (rules.sensorAlerts && failedSensors.length > 0) {
    alerts.push({
      id: "sensor-failure",
      severity: "bad",
      title: "Sensor failure",
      detail: failedSensors.join(", ")
    });
  }

  if (rules.postFailureAlerts && latest.wifi?.lastPostCode !== undefined && latest.wifi.lastPostCode !== 200) {
    alerts.push({
      id: "post-failure",
      severity: "warn",
      title: "Post failure",
      detail: `${latest.wifi.lastPostCode}${latest.wifi.lastPostMessage ? ` · ${latest.wifi.lastPostMessage}` : ""}`
    });
  }

  if (rules.pressureAlerts && insights.pressureDeltaHpa !== null && insights.pressureDeltaHpa <= -rules.pressureDropHpa) {
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

export function deriveStationEvents(history: WeatherStationTelemetry[], alertRules: Partial<AlertRules> = defaultAlertRules): StationEvent[] {
  const rules = sanitizeAlertRules(alertRules);
  const offlineAfterMs = rules.offlineAfterMinutes * 60 * 1000;
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

    if (rules.postFailureAlerts && postOk(previous) !== postOk(current)) {
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
    if (rules.sensorAlerts) {
      for (const [name, ok] of sensorEntries(current)) {
        const before = previousSensors.get(name);
        if (before === undefined || before === ok) continue;
        pushEvent(events, current, ok ? "ok" : "bad", "Sensors", ok ? "Sensor recovered" : "Sensor flagged", name);
      }
    }

    const previousBattery = deriveWeatherInsights(previous).batteryPercent;
    const currentBattery = deriveWeatherInsights(current).batteryPercent;
    if (rules.batteryAlerts && previousBattery !== null && currentBattery !== null) {
      if (previousBattery >= rules.batteryBadPercent && currentBattery < rules.batteryBadPercent) {
        pushEvent(events, current, "bad", "Power", "Battery low", `Battery crossed below ${rules.batteryBadPercent}% to ${Math.round(currentBattery)}%.`);
      }
      if (previousBattery < rules.batteryWarnPercent && currentBattery >= rules.batteryWarnPercent) {
        pushEvent(events, current, "ok", "Power", "Battery recovered", `Battery recovered to ${Math.round(currentBattery)}%.`);
      }
    }

    const currentPressure = deriveWeatherInsights(current).pressureHpa;
    if (rules.pressureAlerts && currentPressure !== null && currentTime - lastPressureEventAt > 3 * 60 * 60 * 1000) {
      const earlier = ordered
        .slice(0, index)
        .map(snapshot => ({ snapshot, delta: Math.abs(timeOf(snapshot) - (currentTime - 3 * 60 * 60 * 1000)) }))
        .sort((a, b) => a.delta - b.delta)[0]?.snapshot;
      const earlierPressure = deriveWeatherInsights(earlier).pressureHpa;
      if (earlierPressure !== null) {
        const delta = currentPressure - earlierPressure;
        if (delta <= -rules.pressureDropHpa) {
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

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, rules.eventLimit);
}
