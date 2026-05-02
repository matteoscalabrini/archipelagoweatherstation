"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  emptyFirmwareManifest,
  type FirmwareArtifact,
  type FirmwareManifest,
  type StationRemoteConfig
} from "@/lib/management";
import type { WeatherStationTelemetry } from "@/lib/telemetry";

type ConfigNumberKey = keyof Omit<StationRemoteConfig, "serverPostEnabled" | "wifiApAlways">;
type ConfigBoolKey = "serverPostEnabled" | "wifiApAlways";
type ConfigDraft = Partial<Record<ConfigNumberKey, string>> & Record<ConfigBoolKey, "" | "true" | "false">;

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

function hasConfigValues(config: StationRemoteConfig | undefined) {
  return Boolean(config && Object.keys(config).length > 0);
}

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
    if (raw !== "") payload[field.key] = Number(raw);
  }
  for (const field of boolFields) {
    if (draft[field.key] !== "") payload[field.key] = draft[field.key] === "true";
  }
  return payload;
}

function artifactStatus(artifact: FirmwareArtifact, currentVersion: string | undefined) {
  if (!artifact.enabled || !artifact.version) return { text: "Disabled", tone: "muted" };
  if (currentVersion && currentVersion === artifact.version) return { text: "Installed", tone: "ok" };
  if (currentVersion) return { text: "Pending", tone: "warn" };
  return { text: "Waiting", tone: "muted" };
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : "--";
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
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadManagementData() {
    const [configRes, firmwareRes, latestRes] = await Promise.all([
      fetch("/api/admin/station-config", { cache: "no-store" }),
      fetch("/api/admin/firmware", { cache: "no-store" }),
      fetch("/api/latest", { cache: "no-store" })
    ]);
    if (!configRes.ok || !firmwareRes.ok) throw new Error("unauthorized");
    const configJson = await configRes.json() as ConfigResponse;
    const firmwareJson = await firmwareRes.json() as FirmwareResponse;
    const latestJson = latestRes.ok ? await latestRes.json() as LatestResponse : null;
    const stationConfig = latestJson?.telemetry?.config;

    setConfigDraft(asDraft(hasConfigValues(stationConfig) ? { ...configJson.config, ...stationConfig } : configJson.config ?? {}));
    setConfigUpdatedAt(configJson.updatedAt ?? null);
    setFirmware(firmwareJson.manifest ?? emptyFirmwareManifest);
    setFirmwareUpdatedAt(firmwareJson.updatedAt ?? null);
    setLatest(latestJson?.telemetry ?? null);
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

  async function uploadArtifact(type: "firmware" | "spiffs", event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("type", type);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("upload_failed");
      const json = await res.json() as FirmwareResponse;
      setFirmware(json.manifest ?? emptyFirmwareManifest);
      setFirmwareUpdatedAt(json.updatedAt ?? null);
      event.currentTarget.reset();
      setMessage(`${type === "firmware" ? "Firmware" : "SPIFFS"} uploaded`);
    } catch {
      setMessage(`${type === "firmware" ? "Firmware" : "SPIFFS"} upload failed`);
    } finally {
      setBusy(false);
    }
  }

  function setArtifact(type: "firmware" | "spiffs", patch: Partial<FirmwareArtifact>) {
    setFirmware(current => ({
      ...current,
      [type]: { ...current[type], ...patch }
    }));
  }

  function renderUpload(type: "firmware" | "spiffs", label: string) {
    const help = type === "firmware"
      ? "Upload the PlatformIO firmware.bin. A successful upload replaces the previous firmware blob."
      : "Upload the PlatformIO SPIFFS image. A successful upload replaces the previous SPIFFS blob.";
    return (
      <form className="artifact-card" onSubmit={event => uploadArtifact(type, event)}>
        <h3>{label}</h3>
        <p className="admin-help">{help}</p>
        <label className="admin-field">
          <span>Version</span>
          <input name="version" />
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

  function renderArtifactStatus(type: "firmware" | "spiffs", label: string, currentVersion: string | undefined) {
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
          <span>Uploaded</span><b>{updatedLabel(artifact.uploadedAt)}</b>
          <span>Size</span><b>{artifact.size ? `${artifact.size} bytes` : "--"}</b>
          <span>SHA-256</span><b>{shortHash(artifact.sha256)}</b>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <main className="admin-page">
        <nav className="topbar">
          <a className="brand" href="/">Archipelago</a>
          <span className="status-pill error">Locked</span>
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
      <main className="admin-page">
        <nav className="topbar">
          <a className="brand" href="/">Archipelago</a>
          <span className="status-pill waiting">Admin</span>
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

  return (
    <main className="admin-page">
      <nav className="topbar">
        <a className="brand" href="/">Archipelago</a>
        <div className="admin-top-actions">
          <span className={`status-pill ${connected ? "online" : "waiting"}`}>
            {connected ? "Station" : "Waiting"}
          </span>
          <button className="admin-button ghost" type="button" onClick={logout}>Sign Out</button>
        </div>
      </nav>

      <div className="admin-title-row">
        <h1>Admin</h1>
        <div className="admin-top-actions">
          {message && <div className="admin-message">{message}</div>}
          <button className="admin-button ghost" type="button" onClick={loadManagementData} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      <form className="admin-panel" onSubmit={saveConfig}>
        <div className="admin-section-head">
          <div>
            <h2>Remote Config</h2>
            <p className="admin-muted">Station {updatedLabel(latest?.receivedAt)} · Saved {updatedLabel(configUpdatedAt)}</p>
            <p className="admin-help">
              Values are filled from the latest station report when available. Saving writes the desired remote config; the station applies it on its next config pull.
            </p>
          </div>
          <button className="admin-button primary" disabled={busy}>Save Config</button>
        </div>

        <div className="admin-grid">
          {configFields.map(field => (
            <label className="admin-field" key={field.key}>
              <span>{field.label}</span>
              <p className="admin-help field-help">Leave unchanged only when you want to keep this current value.</p>
              <div className="admin-input-row">
                <input
                  type="number"
                  step={field.step}
                  value={configDraft[field.key] ?? ""}
                  onChange={event => setConfigDraft(current => ({
                    ...current,
                    [field.key]: event.target.value
                  }))}
                />
                <b>{field.suffix}</b>
              </div>
            </label>
          ))}

          {boolFields.map(field => (
            <label className="admin-field" key={field.key}>
              <span>{field.label}</span>
              <p className="admin-help field-help">{field.help} Choose Leave local to stop overriding this setting remotely.</p>
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
          ))}
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
            <p className="admin-muted">Station {updatedLabel(latest?.receivedAt)}</p>
            <p className="admin-help">
              Target is the uploaded manifest version. Station is the last version reported by telemetry. Pending means the station has not reported the target yet.
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
