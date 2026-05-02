"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  emptyFirmwareManifest,
  type FirmwareManifest,
  type StationRemoteConfig
} from "@/lib/management";

type ConfigNumberKey = keyof Omit<StationRemoteConfig, "serverPostEnabled">;
type ConfigDraft = Partial<Record<ConfigNumberKey, string>> & {
  serverPostEnabled: "" | "true" | "false";
};

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

const emptyConfigDraft: ConfigDraft = { serverPostEnabled: "" };

function asDraft(config: StationRemoteConfig): ConfigDraft {
  const draft: ConfigDraft = {
    serverPostEnabled: config.serverPostEnabled === undefined ? "" : String(config.serverPostEnabled) as "true" | "false"
  };
  for (const field of configFields) {
    const value = config[field.key];
    if (value !== undefined) draft[field.key] = String(value);
  }
  return draft;
}

function updatedLabel(value: string | null) {
  if (!value) return "not saved";
  return new Date(value).toLocaleString();
}

function buildConfigPayload(draft: ConfigDraft) {
  const payload: Record<string, number | boolean> = {};
  for (const field of configFields) {
    const raw = draft[field.key]?.trim() ?? "";
    if (raw !== "") payload[field.key] = Number(raw);
  }
  if (draft.serverPostEnabled !== "") {
    payload.serverPostEnabled = draft.serverPostEnabled === "true";
  }
  return payload;
}

export default function AdminClient() {
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(emptyConfigDraft);
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string | null>(null);
  const [firmware, setFirmware] = useState<FirmwareManifest>(emptyFirmwareManifest);
  const [firmwareUpdatedAt, setFirmwareUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadManagementData() {
    const [configRes, firmwareRes] = await Promise.all([
      fetch("/api/admin/station-config", { cache: "no-store" }),
      fetch("/api/admin/firmware", { cache: "no-store" })
    ]);
    if (!configRes.ok || !firmwareRes.ok) throw new Error("unauthorized");
    const configJson = await configRes.json() as ConfigResponse;
    const firmwareJson = await firmwareRes.json() as FirmwareResponse;
    setConfigDraft(asDraft(configJson.config ?? {}));
    setConfigUpdatedAt(configJson.updatedAt ?? null);
    setFirmware(firmwareJson.manifest ?? emptyFirmwareManifest);
    setFirmwareUpdatedAt(firmwareJson.updatedAt ?? null);
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
      setMessage("Firmware manifest saved");
    } catch {
      setMessage("Firmware manifest save failed");
    } finally {
      setBusy(false);
    }
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
          <span className="status-pill online">Admin</span>
          <button className="admin-button ghost" type="button" onClick={logout}>Sign Out</button>
        </div>
      </nav>

      <div className="admin-title-row">
        <h1>Admin</h1>
        {message && <div className="admin-message">{message}</div>}
      </div>

      <form className="admin-panel" onSubmit={saveConfig}>
        <div className="admin-section-head">
          <div>
            <h2>Remote Config</h2>
            <p className="admin-muted">Updated {updatedLabel(configUpdatedAt)}</p>
          </div>
          <button className="admin-button primary" disabled={busy}>Save Config</button>
        </div>

        <div className="admin-grid">
          {configFields.map(field => (
            <label className="admin-field" key={field.key}>
              <span>{field.label}</span>
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

          <label className="admin-field">
            <span>Server posting</span>
            <select
              value={configDraft.serverPostEnabled}
              onChange={event => setConfigDraft(current => ({
                ...current,
                serverPostEnabled: event.target.value as ConfigDraft["serverPostEnabled"]
              }))}
            >
              <option value="">Leave local</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
        </div>
      </form>

      <form className="admin-panel" onSubmit={saveFirmware}>
        <div className="admin-section-head">
          <div>
            <h2>Firmware</h2>
            <p className="admin-muted">Updated {updatedLabel(firmwareUpdatedAt)}</p>
          </div>
          <button className="admin-button primary" disabled={busy}>Save Firmware</button>
        </div>

        <div className="admin-grid">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={firmware.enabled}
              onChange={event => setFirmware(current => ({ ...current, enabled: event.target.checked }))}
            />
            <span>Enable remote update</span>
          </label>
          <label className="admin-field">
            <span>Version</span>
            <input
              value={firmware.version}
              onChange={event => setFirmware(current => ({ ...current, version: event.target.value }))}
            />
          </label>
          <label className="admin-field wide">
            <span>Binary URL</span>
            <input
              value={firmware.url}
              onChange={event => setFirmware(current => ({ ...current, url: event.target.value }))}
            />
          </label>
          <label className="admin-field wide">
            <span>SHA-256</span>
            <input
              value={firmware.sha256}
              onChange={event => setFirmware(current => ({ ...current, sha256: event.target.value }))}
            />
          </label>
          <label className="admin-field">
            <span>Size</span>
            <div className="admin-input-row">
              <input
                type="number"
                step="1"
                value={firmware.size || ""}
                onChange={event => setFirmware(current => ({
                  ...current,
                  size: Number(event.target.value || 0)
                }))}
              />
              <b>bytes</b>
            </div>
          </label>
          <label className="admin-field wide">
            <span>Notes</span>
            <textarea
              rows={4}
              value={firmware.notes}
              onChange={event => setFirmware(current => ({ ...current, notes: event.target.value }))}
            />
          </label>
        </div>
      </form>
    </main>
  );
}
