"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  defaultAlertRules,
  deriveActiveAlerts,
  deriveStationEvents,
  type AlertRules,
  type EventSeverity
} from "@/lib/events";
import {
  type DeviceCommand,
  type DeviceCommandType,
  emptyFirmwareManifest,
  type FirmwareArtifact,
  type FirmwareManifest,
  type StationRemoteConfig
} from "@/lib/management";
import {
  defaultNotificationSettings,
  type NotificationSettings
} from "@/lib/notification-settings";
import type { WeatherStationTelemetry } from "@/lib/telemetry";

type ConfigNumberKey = keyof Omit<StationRemoteConfig, "serverPostEnabled" | "wifiApAlways">;
type ConfigBoolKey = "serverPostEnabled" | "wifiApAlways";
type ConfigDraft = Partial<Record<ConfigNumberKey, string>> & Record<ConfigBoolKey, "" | "true" | "false">;
type ArtifactType = "firmware" | "spiffs";
type UploadStatus = Partial<Record<ArtifactType, { tone: "waiting" | "ok" | "bad"; text: string }>>;

type SessionResponse = {
  success: boolean;
  configured: boolean;
  authenticated: boolean;
};

type ConfigResponse = {
  success: boolean;
  config: StationRemoteConfig;
  updatedAt: string | null;
};

type FirmwareResponse = {
  success: boolean;
  manifest: FirmwareManifest;
  updatedAt: string | null;
};

type LatestResponse = {
  success: boolean;
  connected: boolean;
  telemetry: WeatherStationTelemetry;
};

type HistoryResponse = {
  success: boolean;
  history: WeatherStationTelemetry[];
};

type AlertRulesResponse = {
  success: boolean;
  rules: AlertRules;
  updatedAt: string | null;
};

type NotificationSettingsResponse = {
  success: boolean;
  settings: NotificationSettings;
  updatedAt: string | null;
};

type DeviceCommandResponse = {
  success: boolean;
  command: DeviceCommand | null;
  updatedAt: string | null;
  error?: string;
};

const configFields: Array<{ key: ConfigNumberKey; label: string; step: string; suffix: string }> = [
  { key: "solarSunEnterVoltageV", label: "Sun enter voltage", step: "0.1", suffix: "V" },
  { key: "solarSunExitVoltageV", label: "Sun exit voltage", step: "0.1", suffix: "V" },
  { key: "solarSunMinPowerW", label: "Sun minimum power", step: "0.1", suffix: "W" },
  { key: "solarDarkEnterVoltageV", label: "Dark enter voltage", step: "0.1", suffix: "V" },
  { key: "solarDarkExitVoltageV", label: "Dark exit voltage", step: "0.1", suffix: "V" },
  { key: "solarDarkDeepSleepDelayMs", label: "Dark sleep delay", step: "1000", suffix: "ms" },
  { key: "solarDeepSleepWakeMs", label: "Dark wake period", step: "1000", suffix: "ms" },
  { key: "serverPostSunMs", label: "Post interval in sun", step: "1000", suffix: "ms" },
  { key: "serverPostShadowMs", label: "Post interval in shadow", step: "1000", suffix: "ms" },
  { key: "serverPostDarkMs", label: "Post interval in dark", step: "1000", suffix: "ms" },
  { key: "batteryPercentEmptyVoltageV", label: "Battery empty voltage", step: "0.1", suffix: "V" },
  { key: "batteryPercentFullVoltageV", label: "Battery full voltage", step: "0.1", suffix: "V" },
  { key: "batteryLockoutEnterVoltageV", label: "Battery lockout enter", step: "0.01", suffix: "V" },
  { key: "batteryLockoutResumeVoltageV", label: "Battery lockout resume", step: "0.01", suffix: "V" },
  { key: "batteryLockoutWakeMs", label: "Battery lockout wake", step: "1000", suffix: "ms" },
  { key: "remoteConfigPullMs", label: "Remote config pull", step: "1000", suffix: "ms" },
  { key: "remoteFirmwareCheckMs", label: "Firmware check", step: "1000", suffix: "ms" }
];

const boolFields: Array<{ key: ConfigBoolKey; label: string; help: string }> = [
  {
    key: "serverPostEnabled",
    label: "Server posting",
    help: "Enables scheduled telemetry posts from the station to this website."
  },
  {
    key: "wifiApAlways",
    label: "Debug AP always",
    help: "Keeps the local setup access point visible while the station is awake."
  }
];

const emptyConfigDraft: ConfigDraft = {
  serverPostEnabled: "",
  wifiApAlways: ""
};

function asDraft(config: StationRemoteConfig): ConfigDraft {
  const draft: ConfigDraft = {
    serverPostEnabled: config.serverPostEnabled === undefined ? "" : String(config.serverPostEnabled) as "true" | "false",
    wifiApAlways: config.wifiApAlways === undefined ? "" : String(config.wifiApAlways) as "true" | "false"
  };
  for (const field of configFields) {
    const value = config[field.key];
    if (value !== undefined) draft[field.key] = String(value);
  }
  return draft;
}

function updatedLabel(value: string | null | undefined) {
  if (!value) return "not saved";
  return new Date(value).toLocaleString();
}

function buildConfigPayload(draft: ConfigDraft) {
  const payload: Record<string, number | boolean> = {};
  for (const field of configFields) {
    const raw = draft[field.key]?.trim() ?? "";
    const value = parseConfigNumber(raw);
    if (value !== undefined) payload[field.key] = value;
  }
  for (const field of boolFields) {
    if (draft[field.key] !== "") payload[field.key] = draft[field.key] === "true";
  }
  return payload;
}

function parseConfigNumber(raw: string) {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function formatConfigNumber(value: number | undefined, suffix: string) {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return `${value}${suffix ? ` ${suffix}` : ""}`;
}

function formatConfigBool(value: boolean | undefined) {
  if (value === undefined) return "--";
  return value ? "Enabled" : "Disabled";
}

function draftNumberValue(draft: ConfigDraft, key: ConfigNumberKey) {
  return parseConfigNumber(draft[key] ?? "");
}

function stationNumberValue(config: StationRemoteConfig | undefined, key: ConfigNumberKey) {
  const value = config?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function draftBoolValue(draft: ConfigDraft, key: ConfigBoolKey) {
  if (draft[key] === "") return undefined;
  return draft[key] === "true";
}

function pendingNumberState(current: number | undefined, desired: number | undefined, suffix: string) {
  if (desired === undefined) return { text: "No remote override", tone: "waiting" };
  if (current === undefined) return { text: `Will apply ${formatConfigNumber(desired, suffix)}`, tone: "pending" };
  if (current === desired) return { text: "Already applied", tone: "ok" };
  return { text: `Will apply ${formatConfigNumber(desired, suffix)}`, tone: "pending" };
}

function pendingBoolState(current: boolean | undefined, desired: boolean | undefined) {
  if (desired === undefined) return { text: "No remote override", tone: "waiting" };
  if (current === undefined) return { text: `Will apply ${formatConfigBool(desired)}`, tone: "pending" };
  if (current === desired) return { text: "Already applied", tone: "ok" };
  return { text: `Will apply ${formatConfigBool(desired)}`, tone: "pending" };
}

function artifactStatus(artifact: FirmwareArtifact, currentVersion: string | undefined) {
  if (!artifact.enabled || !artifact.version) return { text: "Disabled", tone: "muted" };
  if (currentVersion && currentVersion === artifact.version) return { text: "Version match", tone: "muted" };
  if (currentVersion) return { text: "Pending", tone: "warn" };
  return { text: "Waiting", tone: "muted" };
}

function artifactDelivery(artifact: FirmwareArtifact, currentVersion: string | undefined) {
  if (!artifact.enabled) return "Paused";
  if (!artifact.version) return "Missing target";
  if (currentVersion && currentVersion === artifact.version) return "No update offered";
  if (currentVersion) return "Offered on next firmware check";
  return "Waiting for telemetry";
}

function httpCodeLabel(code: number | undefined) {
  return typeof code === "number" && code !== 0 ? String(code) : "--";
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : "--";
}

function eventTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function severityText(severity: EventSeverity) {
  switch (severity) {
    case "bad": return "Critical";
    case "warn": return "Watch";
    case "ok": return "Clear";
    default: return "Info";
  }
}

function sensorLabel(name: string) {
  const labels: Record<string, string> = {
    bme280Online: "BME280",
    solarOnline: "Solar INA219",
    batteryOnline: "Battery INA219",
    windSpeedOnline: "Wind Speed",
    windDirOnline: "Wind Direction"
  };
  if (labels[name]) return labels[name];
  return name
    .replace(/Online$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bina\b/gi, "INA")
    .toUpperCase();
}

function commandLabel(command: DeviceCommand | null | undefined) {
  if (!command) return "None queued";
  return command.type === "deviceReboot" ? "Device reboot queued" : "Display restart queued";
}

function commandHelp(command: DeviceCommand | null | undefined) {
  if (!command) return "Remote actions run when the station next posts and pulls remote config.";
  return `${commandLabel(command)} at ${updatedLabel(command.requestedAt)}.`;
}

export default function AdminClient() {
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(emptyConfigDraft);
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string | null>(null);
  const [firmware, setFirmware] = useState<FirmwareManifest>(emptyFirmwareManifest);
  const [firmwareUpdatedAt, setFirmwareUpdatedAt] = useState<string | null>(null);
  const [latest, setLatest] = useState<WeatherStationTelemetry | null>(null);
  const [history, setHistory] = useState<WeatherStationTelemetry[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRules>(defaultAlertRules);
  const [alertRulesUpdatedAt, setAlertRulesUpdatedAt] = useState<string | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [notificationSettingsUpdatedAt, setNotificationSettingsUpdatedAt] = useState<string | null>(null);
  const [deviceCommand, setDeviceCommand] = useState<DeviceCommand | null>(null);
  const [deviceCommandUpdatedAt, setDeviceCommandUpdatedAt] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({});
  const [busy, setBusy] = useState(false);
  const alerts = useMemo(() => deriveActiveAlerts(latest, history, alertRules), [latest, history, alertRules]);
  const events = useMemo(() => deriveStationEvents(history, alertRules), [history, alertRules]);
  const activeAlertCount = alerts.filter(alert => alert.severity !== "ok").length;

  async function loadManagementData() {
    const [configRes, firmwareRes, alertRulesRes, notificationSettingsRes, commandRes, latestRes, historyRes] = await Promise.all([
      fetch("/api/admin/station-config", { cache: "no-store" }),
      fetch("/api/admin/firmware", { cache: "no-store" }),
      fetch("/api/admin/alert-rules", { cache: "no-store" }),
      fetch("/api/admin/notification-settings", { cache: "no-store" }),
      fetch("/api/admin/device-command", { cache: "no-store" }),
      fetch("/api/latest", { cache: "no-store" }),
      fetch("/api/history?limit=10080", { cache: "no-store" })
    ]);
    if (!configRes.ok || !firmwareRes.ok || !alertRulesRes.ok || !notificationSettingsRes.ok || !commandRes.ok) throw new Error("unauthorized");
    const configJson = await configRes.json() as ConfigResponse;
    const firmwareJson = await firmwareRes.json() as FirmwareResponse;
    const alertRulesJson = await alertRulesRes.json() as AlertRulesResponse;
    const notificationSettingsJson = await notificationSettingsRes.json() as NotificationSettingsResponse;
    const commandJson = await commandRes.json() as DeviceCommandResponse;
    const latestJson = latestRes.ok ? await latestRes.json() as LatestResponse : null;
    const historyJson = historyRes.ok ? await historyRes.json() as HistoryResponse : null;
    setConfigDraft(asDraft(configJson.config ?? {}));
    setConfigUpdatedAt(configJson.updatedAt ?? null);
    setFirmware(firmwareJson.manifest ?? emptyFirmwareManifest);
    setFirmwareUpdatedAt(firmwareJson.updatedAt ?? null);
    setAlertRules(alertRulesJson.rules ?? defaultAlertRules);
    setAlertRulesUpdatedAt(alertRulesJson.updatedAt ?? null);
    setNotificationSettings(notificationSettingsJson.settings ?? defaultNotificationSettings);
    setNotificationSettingsUpdatedAt(notificationSettingsJson.updatedAt ?? null);
    setDeviceCommand(commandJson.command ?? null);
    setDeviceCommandUpdatedAt(commandJson.updatedAt ?? null);
    setLatest(latestJson?.telemetry ?? null);
    setHistory(historyJson?.history ?? []);
    setConnected(Boolean(latestJson?.connected));
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = await res.json() as SessionResponse;
        if (cancelled) return;
        setConfigured(json.configured);
        setAuthenticated(json.authenticated);
        if (json.authenticated) await loadManagementData();
      } catch {
        if (!cancelled) setMessage("Admin API unavailable");
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!res.ok) throw new Error("login_failed");
      setAuthenticated(true);
      setPassword("");
      await loadManagementData();
      setMessage("Signed in");
    } catch {
      setMessage("Password rejected");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setMessage("Signed out");
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/station-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildConfigPayload(configDraft))
      });
      if (!res.ok) throw new Error("save_failed");
      const json = await res.json() as ConfigResponse;
      setConfigDraft(asDraft(json.config ?? {}));
      setConfigUpdatedAt(json.updatedAt ?? null);
      setMessage("Remote config saved");
    } catch {
      setMessage("Remote config save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAlertRuleSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/alert-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alertRules)
      });
      if (!res.ok) throw new Error("save_failed");
      const json = await res.json() as AlertRulesResponse;
      setAlertRules(json.rules ?? defaultAlertRules);
      setAlertRulesUpdatedAt(json.updatedAt ?? null);
      setMessage("Alert rules saved");
    } catch {
      setMessage("Alert rules save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveNotificationDeliverySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationSettings)
      });
      if (!res.ok) throw new Error("save_failed");
      const json = await res.json() as NotificationSettingsResponse;
      setNotificationSettings(json.settings ?? defaultNotificationSettings);
      setNotificationSettingsUpdatedAt(json.updatedAt ?? null);
      setMessage("Notification settings saved");
    } catch {
      setMessage("Notification settings save failed");
    } finally {
      setBusy(false);
    }
  }

  async function queueRemoteCommand(type: DeviceCommandType) {
    const action = type === "deviceReboot" ? "reboot the device" : "restart the displays";
    if (!window.confirm(`Queue a remote command to ${action} on the next station config pull?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/device-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      const json = await res.json() as DeviceCommandResponse;
      if (!res.ok) throw new Error(json.error || "command_failed");
      setDeviceCommand(json.command ?? null);
      setDeviceCommandUpdatedAt(json.updatedAt ?? null);
      setMessage(type === "deviceReboot" ? "Device reboot queued" : "Display restart queued");
    } catch {
      setMessage("Remote command queue failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearRemoteCommand() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/device-command", { method: "DELETE" });
      const json = await res.json() as DeviceCommandResponse;
      if (!res.ok) throw new Error(json.error || "clear_failed");
      setDeviceCommand(json.command ?? null);
      setDeviceCommandUpdatedAt(json.updatedAt ?? null);
      setMessage("Queued command cleared");
    } catch {
      setMessage("Command clear failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveFirmware(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/firmware", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(firmware)
      });
      if (!res.ok) throw new Error("save_failed");
      const json = await res.json() as FirmwareResponse;
      setFirmware(json.manifest ?? emptyFirmwareManifest);
      setFirmwareUpdatedAt(json.updatedAt ?? null);
      setMessage("Update settings saved");
    } catch {
      setMessage("Update settings save failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadArtifact(type: ArtifactType, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    setUploadStatus(current => ({
      ...current,
      [type]: { tone: "waiting", text: `Uploading ${type === "firmware" ? "firmware" : "SPIFFS"}...` }
    }));
    try {
      const form = new FormData(formElement);
      form.set("type", type);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const json = await res.json() as FirmwareResponse & { error?: string; detail?: string };
      if (!res.ok) {
        const reason = json.detail ? `${json.error || "upload_failed"}: ${json.detail}` :
          (json.error || "upload_failed");
        throw new Error(reason);
      }
      setFirmware(json.manifest ?? emptyFirmwareManifest);
      setFirmwareUpdatedAt(json.updatedAt ?? null);
      const artifact = json.manifest?.[type];
      formElement.reset();
      const label = type === "firmware" ? "Firmware" : "SPIFFS";
      const detail = artifact?.filename ?
        `${label} uploaded: ${artifact.filename} (${artifact.size} bytes)` :
        `${label} uploaded`;
      setUploadStatus(current => ({
        ...current,
        [type]: { tone: "ok", text: detail }
      }));
      setMessage(detail);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "upload_failed";
      const label = type === "firmware" ? "Firmware" : "SPIFFS";
      const text = `${label} upload failed: ${reason}`;
      setUploadStatus(current => ({
        ...current,
        [type]: { tone: "bad", text }
      }));
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  function setArtifact(type: ArtifactType, patch: Partial<FirmwareArtifact>) {
    setFirmware(current => ({
      ...current,
      [type]: { ...current[type], ...patch }
    }));
  }

  function setAlertRule<K extends keyof AlertRules>(key: K, value: AlertRules[K]) {
    setAlertRules(current => ({ ...current, [key]: value }));
  }

  function setNotificationSetting<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setNotificationSettings(current => ({ ...current, [key]: value }));
  }

  function renderUpload(type: ArtifactType, label: string) {
    const help = type === "firmware"
      ? "Upload the PlatformIO firmware.bin. A successful upload replaces the previous firmware blob."
      : "Upload the PlatformIO SPIFFS image. A successful upload replaces the previous SPIFFS blob.";
    const status = uploadStatus[type];
    const artifact = firmware[type];
    return (
      <form className="artifact-card" onSubmit={event => uploadArtifact(type, event)}>
        <div className="artifact-status-head">
          <h3>{label}</h3>
          <span className={`artifact-status ${artifact.enabled ? "ok" : ""}`}>
            {artifact.enabled ? "Uploaded" : "Empty"}
          </span>
        </div>
        <p className="admin-help">{help}</p>
        {status && <div className={`upload-feedback ${status.tone}`}>{status.text}</div>}
        <div className="artifact-meta compact">
          <span>Current</span><b>{artifact.filename || "--"}</b>
          <span>Version</span><b>{artifact.version || "--"}</b>
          <span>Size</span><b>{artifact.size ? `${artifact.size} bytes` : "--"}</b>
          <span>SHA-256</span><b>{shortHash(artifact.sha256)}</b>
        </div>
        <label className="admin-field">
          <span>Version</span>
          <input name="version" placeholder={artifact.version || new Date().toISOString()} />
        </label>
        <label className="admin-field">
          <span>File</span>
          <input name="file" type="file" required />
        </label>
        <label className="admin-field">
          <span>Notes</span>
          <textarea name="notes" rows={3} />
        </label>
        <button className="admin-button primary" disabled={busy}>Upload</button>
      </form>
    );
  }

  function renderArtifactStatus(type: ArtifactType, label: string, currentVersion: string | undefined) {
    const artifact = firmware[type];
    const status = artifactStatus(artifact, currentVersion);
    return (
      <div className="artifact-card">
        <div className="artifact-status-head">
          <h3>{label}</h3>
          <span className={`artifact-status ${status.tone}`}>{status.text}</span>
        </div>
        <div className="artifact-meta">
          <span>Target</span><b>{artifact.version || "--"}</b>
          <span>Station</span><b>{currentVersion || "--"}</b>
          <span>Delivery</span><b>{artifactDelivery(artifact, currentVersion)}</b>
          <span>Uploaded</span><b>{updatedLabel(artifact.uploadedAt)}</b>
          <span>Size</span><b>{artifact.size ? `${artifact.size} bytes` : "--"}</b>
          <span>SHA-256</span><b>{shortHash(artifact.sha256)}</b>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <main className="admin-page station-dashboard">
        <nav className="station-header">
          <div className="station-brand-stack">
            <a className="brand station-brand-word" href="/">Archipelago</a>
            <h1><em>Admin</em></h1>
          </div>
          <div className="station-header-actions">
            <span className="station-status error">Locked</span>
          </div>
        </nav>
        <section className="admin-panel compact">
          <h1>Admin</h1>
          <p className="admin-muted">Set WEATHER_STATION_ADMIN_PASSWORD before using this section.</p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="admin-page station-dashboard">
        <nav className="station-header">
          <div className="station-brand-stack">
            <a className="brand station-brand-word" href="/">Archipelago</a>
            <h1><em>Admin</em></h1>
          </div>
          <div className="station-header-actions">
            <span className="station-status waiting">Admin</span>
          </div>
        </nav>
        <form className="admin-panel compact" onSubmit={login}>
          <h1>Admin</h1>
          <label className="admin-field wide">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </label>
          <button className="admin-button primary" disabled={busy || password.length === 0}>
            Sign In
          </button>
          {message && <div className="admin-message">{message}</div>}
        </form>
      </main>
    );
  }

  const stationConfig = latest?.config;
  const sensorEntries = Object.entries(latest?.sensors ?? {});
  const failedSensors = sensorEntries.filter(([, online]) => !online);
  const displayStatus = latest?.displayStatus;
  const displayRows = latest?.displays ?? [];
  const displayCount = displayStatus?.count ?? displayRows.length;
  const displayOnlineCount = displayStatus?.onlineCount ??
    displayRows.filter(display => display.displayOnline !== false).length;
  const allDisplaysOnline = displayStatus?.allOnline ??
    (displayCount > 0 && displayOnlineCount === displayCount);
  const offlineDisplayRows = displayRows.filter(display => display.displayOnline === false);
  const offlineDisplays = offlineDisplayRows.length > 0 ?
    offlineDisplayRows :
    (displayStatus?.offline ?? []).map(display => ({
      id: display.id,
      label: `Display ${display.id ?? "--"}`,
      displayOnline: false,
      online: false,
      bus: display.bus,
      i2cAddressHex: display.i2cAddressHex
    }));
  const allSensorsOnline = sensorEntries.length > 0 && failedSensors.length === 0;

  return (
    <main className="admin-page station-dashboard">
      <nav className="station-header">
        <div className="station-brand-stack">
          <a className="brand station-brand-word" href="/">Archipelago</a>
          <h1><em>Admin</em></h1>
        </div>
        <div className="station-header-actions">
          <a className="station-nav-link" href="/history">History</a>
          <span className={`station-status ${connected ? "online" : "waiting"}`}>
            {connected ? "Station" : "Waiting"}
          </span>
          <button className="admin-button ghost" type="button" onClick={logout}>Sign Out</button>
        </div>
      </nav>

      <div className="admin-title-row">
        <div className="admin-top-actions">
          {message && <div className="admin-message">{message}</div>}
          <button className="admin-button ghost" type="button" onClick={loadManagementData} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      <section className="admin-panel">
        <div className="admin-section-head">
          <div>
            <h2>Events & Alerts</h2>
            <p className="admin-muted">Recent telemetry {history.length} samples · Last {updatedLabel(latest?.receivedAt)}</p>
            <p className="admin-help">
              Alerts and events are derived from station telemetry: offline gaps, low battery, sensor failures, post failures, solar changes, firmware changes, and fast pressure drops.
            </p>
          </div>
          <div className="admin-section-actions">
            <span className={`status-pill ${activeAlertCount > 0 ? "error" : "online"}`}>
              {activeAlertCount > 0 ? `${activeAlertCount} Alert${activeAlertCount === 1 ? "" : "s"}` : "Clear"}
            </span>
          </div>
        </div>

        <div className="alert-grid">
          {alerts.map(alert => (
            <article className={`alert-card ${alert.severity}`} key={alert.id}>
              <span>{severityText(alert.severity)}</span>
              <strong>{alert.title}</strong>
              <p>{alert.detail}</p>
            </article>
          ))}
        </div>

        <div className="reachability-panel">
          <div className="admin-section-head">
            <div>
              <h2>Station Reachability</h2>
              <p className="admin-muted">
                Telemetry {updatedLabel(latest?.receivedAt)} · Command {updatedLabel(deviceCommandUpdatedAt)}
              </p>
              <p className="admin-help">
                Physical OLED presence is tracked separately from sensor source health, so an offline sensor no longer hides a reachable display.
              </p>
            </div>
            <div className="admin-section-actions">
              {deviceCommand && (
                <button className="admin-button ghost" type="button" onClick={clearRemoteCommand} disabled={busy}>
                  Clear Action
                </button>
              )}
              <button className="admin-button ghost" type="button" onClick={() => queueRemoteCommand("displayReboot")} disabled={busy}>
                Restart Displays
              </button>
              <button className="admin-button ghost" type="button" onClick={() => queueRemoteCommand("deviceReboot")} disabled={busy}>
                Reboot Device
              </button>
            </div>
          </div>

          <div className="reachability-summary">
            <article>
              <span>Sensors</span>
              <strong className={allSensorsOnline ? "ok-text" : failedSensors.length > 0 ? "bad-text" : "dim-text"}>
                {sensorEntries.length === 0 ? "Waiting" : `${sensorEntries.length - failedSensors.length}/${sensorEntries.length}`}
              </strong>
              <p>{failedSensors.length > 0 ? `${failedSensors.map(([name]) => sensorLabel(name)).join(", ")} offline` : "All reported sensors reachable"}</p>
            </article>
            <article>
              <span>Displays</span>
              <strong className={allDisplaysOnline ? "ok-text" : "bad-text"}>
                {displayCount ? `${displayOnlineCount}/${displayCount}` : "Waiting"}
              </strong>
              <p>{allDisplaysOnline ? "All OLEDs ACK on their display buses" : `${offlineDisplays.length} OLED${offlineDisplays.length === 1 ? "" : "s"} offline`}</p>
            </article>
            <article>
              <span>Remote Action</span>
              <strong className={deviceCommand ? "warn-text" : "dim-text"}>{commandLabel(deviceCommand)}</strong>
              <p>{commandHelp(deviceCommand)}</p>
            </article>
          </div>

          <div className="reachability-grid">
            {sensorEntries.map(([name, online]) => (
              <span key={name} className={`reachability-chip ${online ? "ok" : "bad"}`}>
                <b>{sensorLabel(name)}</b>
                <em>{online ? "ONLINE" : "OFFLINE"}</em>
              </span>
            ))}
            {displayRows.map((display, index) => {
              const physicalOnline = display.displayOnline !== false;
              const sourceOnline = display.sourceOnline ?? display.online;
              return (
                <span key={`display-${display.id ?? index}`} className={`reachability-chip ${physicalOnline ? "ok" : "bad"}`}>
                  <b>{display.label || `DISPLAY ${display.id ?? index}`}</b>
                  <em>{physicalOnline ? `DISPLAY OK · ${sourceOnline ? "SOURCE OK" : "SOURCE OFF"}` : `OFFLINE · BUS ${display.bus ?? "--"} ${display.i2cAddressHex ?? ""}`}</em>
                </span>
              );
            })}
            {sensorEntries.length === 0 && displayRows.length === 0 && (
              <div className="reachability-empty">Waiting for telemetry with sensor and display status.</div>
            )}
          </div>
        </div>

        <div className="event-timeline" aria-label="Station event timeline">
          {events.length === 0 ? (
            <div className="event-empty">No timeline events detected in stored history yet.</div>
          ) : events.map(event => (
            <article className={`event-row ${event.severity}`} key={event.id}>
              <div className="event-marker" />
              <div className="event-body">
                <div className="event-head">
                  <span>{event.category}</span>
                  <time dateTime={event.at}>{eventTime(event.at)}</time>
                </div>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </div>
            </article>
          ))}
        </div>

        <form className="alert-rule-form" onSubmit={saveAlertRuleSettings}>
          <div className="admin-section-head">
            <div>
              <h2>Alert Rules</h2>
              <p className="admin-muted">Saved {updatedLabel(alertRulesUpdatedAt)}</p>
            </div>
            <button className="admin-button primary" disabled={busy}>Save Rules</button>
          </div>

          <div className="admin-grid">
            <label className="admin-field">
              <span>Offline after</span>
              <p className="admin-help field-help">Raise an offline alert when telemetry has been silent this long.</p>
              <div className="admin-input-row">
                <input
                  min="1"
                  max="1440"
                  step="1"
                  type="number"
                  value={alertRules.offlineAfterMinutes}
                  onChange={event => setAlertRule("offlineAfterMinutes", Number(event.target.value))}
                />
                <b>min</b>
              </div>
            </label>
            <label className="admin-field">
              <span>Battery watch</span>
              <p className="admin-help field-help">Warn when estimated battery percentage drops below this value.</p>
              <div className="admin-input-row">
                <input
                  min="0"
                  max="100"
                  step="1"
                  type="number"
                  value={alertRules.batteryWarnPercent}
                  onChange={event => setAlertRule("batteryWarnPercent", Number(event.target.value))}
                />
                <b>%</b>
              </div>
            </label>
            <label className="admin-field">
              <span>Battery critical</span>
              <p className="admin-help field-help">Raise a critical alert below this battery percentage.</p>
              <div className="admin-input-row">
                <input
                  min="0"
                  max="100"
                  step="1"
                  type="number"
                  value={alertRules.batteryBadPercent}
                  onChange={event => setAlertRule("batteryBadPercent", Number(event.target.value))}
                />
                <b>%</b>
              </div>
            </label>
            <label className="admin-field">
              <span>Pressure drop</span>
              <p className="admin-help field-help">Warn when pressure falls by this much over roughly three hours.</p>
              <div className="admin-input-row">
                <input
                  min="0.1"
                  max="50"
                  step="0.1"
                  type="number"
                  value={alertRules.pressureDropHpa}
                  onChange={event => setAlertRule("pressureDropHpa", Number(event.target.value))}
                />
                <b>hPa</b>
              </div>
            </label>
            <label className="admin-field">
              <span>Timeline rows</span>
              <p className="admin-help field-help">Limit how many detected events appear in the admin timeline.</p>
              <div className="admin-input-row">
                <input
                  min="1"
                  max="100"
                  step="1"
                  type="number"
                  value={alertRules.eventLimit}
                  onChange={event => setAlertRule("eventLimit", Number(event.target.value))}
                />
                <b>rows</b>
              </div>
            </label>
          </div>

          <div className="admin-grid top-gap">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={alertRules.batteryAlerts}
                onChange={event => setAlertRule("batteryAlerts", event.target.checked)}
              />
              <span>Battery alerts</span>
              <p className="admin-help field-help">Use battery percentage or voltage-derived percentage when available.</p>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={alertRules.sensorAlerts}
                onChange={event => setAlertRule("sensorAlerts", event.target.checked)}
              />
              <span>Sensor alerts</span>
              <p className="admin-help field-help">Flag sensors that report offline and log recoveries.</p>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={alertRules.postFailureAlerts}
                onChange={event => setAlertRule("postFailureAlerts", event.target.checked)}
              />
              <span>Post alerts</span>
              <p className="admin-help field-help">Watch non-200 station post codes and recovery events.</p>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={alertRules.pressureAlerts}
                onChange={event => setAlertRule("pressureAlerts", event.target.checked)}
              />
              <span>Pressure alerts</span>
              <p className="admin-help field-help">Detect sharp pressure falls from the stored telemetry history.</p>
            </label>
          </div>
        </form>

        <form className="alert-rule-form" onSubmit={saveNotificationDeliverySettings}>
          <div className="admin-section-head">
            <div>
              <h2>Alert Delivery</h2>
              <p className="admin-muted">Saved {updatedLabel(notificationSettingsUpdatedAt)}</p>
              <p className="admin-help">
                When enabled, active alert payloads are posted to the webhook after each station ingest, with a per-alert cooldown.
              </p>
            </div>
            <button className="admin-button primary" disabled={busy}>Save Delivery</button>
          </div>

          <div className="admin-grid">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={notificationSettings.enabled}
                onChange={event => setNotificationSetting("enabled", event.target.checked)}
              />
              <span>Webhook delivery</span>
              <p className="admin-help field-help">Send active alert notifications to the configured webhook.</p>
            </label>
            <label className="admin-field">
              <span>Station name</span>
              <p className="admin-help field-help">Shown in the notification text.</p>
              <input
                value={notificationSettings.stationName}
                onChange={event => setNotificationSetting("stationName", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Cooldown</span>
              <p className="admin-help field-help">Minimum delay before the same active alert is sent again.</p>
              <div className="admin-input-row">
                <input
                  min="1"
                  max="1440"
                  step="1"
                  type="number"
                  value={notificationSettings.cooldownMinutes}
                  onChange={event => setNotificationSetting("cooldownMinutes", Number(event.target.value))}
                />
                <b>min</b>
              </div>
            </label>
            <label className="admin-field wide">
              <span>Webhook URL</span>
              <p className="admin-help field-help">Accepts generic JSON webhooks, Slack incoming webhooks, and Discord webhooks.</p>
              <input
                type="url"
                value={notificationSettings.webhookUrl}
                onChange={event => setNotificationSetting("webhookUrl", event.target.value)}
              />
            </label>
          </div>
        </form>
      </section>

      <form className="admin-panel" onSubmit={saveConfig}>
        <div className="admin-section-head">
          <div>
            <h2>Remote Config</h2>
            <p className="admin-muted">Station {updatedLabel(latest?.receivedAt)} · Saved {updatedLabel(configUpdatedAt)}</p>
            <p className="admin-help">
              Inputs are desired remote values. Empty fields leave the station local; current station values and pending changes are shown under each field.
            </p>
          </div>
          <button className="admin-button primary" disabled={busy}>Save Config</button>
        </div>

        <div className="admin-grid">
          {configFields.map(field => {
            const currentValue = stationNumberValue(stationConfig, field.key);
            const desiredValue = draftNumberValue(configDraft, field.key);
            const state = pendingNumberState(currentValue, desiredValue, field.suffix);
            return (
              <label className="admin-field" key={field.key}>
                <span>{field.label}</span>
                <div className="config-state">
                  <span>Current</span><b>{formatConfigNumber(currentValue, field.suffix)}</b>
                  <span>Desired</span><b>{desiredValue === undefined ? "Leave local" : formatConfigNumber(desiredValue, field.suffix)}</b>
                </div>
                <p className={`config-pending ${state.tone}`}>{state.text}</p>
                <div className="admin-input-row">
                  <input
                    type="number"
                    step={field.step}
                    placeholder={currentValue === undefined ? "" : String(currentValue)}
                    value={configDraft[field.key] ?? ""}
                    onChange={event => setConfigDraft(current => ({
                      ...current,
                      [field.key]: event.target.value
                    }))}
                  />
                  <b>{field.suffix}</b>
                </div>
              </label>
            );
          })}

          {boolFields.map(field => {
            const currentValue = stationConfig?.[field.key];
            const desiredValue = draftBoolValue(configDraft, field.key);
            const state = pendingBoolState(currentValue, desiredValue);
            return (
              <label className="admin-field" key={field.key}>
                <span>{field.label}</span>
                <p className="admin-help field-help">{field.help}</p>
                <div className="config-state">
                  <span>Current</span><b>{formatConfigBool(currentValue)}</b>
                  <span>Desired</span><b>{desiredValue === undefined ? "Leave local" : formatConfigBool(desiredValue)}</b>
                </div>
                <p className={`config-pending ${state.tone}`}>{state.text}</p>
                <select
                  value={configDraft[field.key]}
                  onChange={event => setConfigDraft(current => ({
                    ...current,
                    [field.key]: event.target.value as ConfigDraft[ConfigBoolKey]
                  }))}
                >
                  <option value="">Leave local</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
            );
          })}
        </div>
      </form>

      <section className="admin-panel">
        <div className="admin-section-head">
          <div>
            <h2>Upload</h2>
            <p className="admin-muted">Manifest {updatedLabel(firmwareUpdatedAt)}</p>
            <p className="admin-help">
              Uploads are stored by the website. Each new firmware or SPIFFS upload deletes the previous file for that slot after the new file is saved.
            </p>
          </div>
        </div>
        <div className="artifact-grid">
          {renderUpload("firmware", "Firmware")}
          {renderUpload("spiffs", "SPIFFS")}
        </div>
      </section>

      <form className="admin-panel" onSubmit={saveFirmware}>
        <div className="admin-section-head">
          <div>
            <h2>Update Status</h2>
            <p className="admin-muted">
              Station {updatedLabel(latest?.receivedAt)} · Firmware state {latest?.wifi?.firmwareMessage || "--"} · Manifest HTTP {httpCodeLabel(latest?.wifi?.firmwareHttpCode)} · OTA HTTP {httpCodeLabel(latest?.wifi?.otaHttpCode)}
            </p>
            <p className="admin-help">
              The station downloads only when the target version differs from the version reported by telemetry. Version match means no update is offered.
            </p>
          </div>
          <button className="admin-button primary" disabled={busy}>Save Flags</button>
        </div>

        <div className="artifact-grid">
          {renderArtifactStatus("firmware", "Firmware", latest?.firmwareVersion)}
          {renderArtifactStatus("spiffs", "SPIFFS", latest?.spiffsVersion)}
        </div>

        <div className="admin-grid top-gap">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={firmware.firmware.enabled}
              onChange={event => setArtifact("firmware", { enabled: event.target.checked })}
            />
            <span>Firmware update</span>
            <p className="admin-help field-help">Tick to offer the uploaded firmware to the station. Untick to pause delivery without deleting the upload.</p>
          </label>
          <label className="admin-field">
            <span>Firmware version</span>
            <input
              value={firmware.firmware.version}
              onChange={event => setArtifact("firmware", { version: event.target.value })}
            />
          </label>
          <label className="admin-field wide">
            <span>Firmware notes</span>
            <textarea
              rows={3}
              value={firmware.firmware.notes}
              onChange={event => setArtifact("firmware", { notes: event.target.value })}
            />
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={firmware.spiffs.enabled}
              onChange={event => setArtifact("spiffs", { enabled: event.target.checked })}
            />
            <span>SPIFFS update</span>
            <p className="admin-help field-help">Tick to offer the uploaded web UI filesystem to the station. Untick to pause delivery.</p>
          </label>
          <label className="admin-field">
            <span>SPIFFS version</span>
            <input
              value={firmware.spiffs.version}
              onChange={event => setArtifact("spiffs", { version: event.target.value })}
            />
          </label>
          <label className="admin-field wide">
            <span>SPIFFS notes</span>
            <textarea
              rows={3}
              value={firmware.spiffs.notes}
              onChange={event => setArtifact("spiffs", { notes: event.target.value })}
            />
          </label>
        </div>
      </form>
    </main>
  );
}
