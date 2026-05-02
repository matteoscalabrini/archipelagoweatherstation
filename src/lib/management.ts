export type StationRemoteConfig = {
  solarSunEnterVoltageV?: number;
  solarSunExitVoltageV?: number;
  solarSunMinPowerW?: number;
  solarDarkEnterVoltageV?: number;
  solarDarkExitVoltageV?: number;
  solarDarkDeepSleepDelayMs?: number;
  solarDeepSleepWakeMs?: number;
  serverPostSunMs?: number;
  serverPostShadowMs?: number;
  serverPostDarkMs?: number;
  serverPostEnabled?: boolean;
  batteryPercentEmptyVoltageV?: number;
  batteryPercentFullVoltageV?: number;
  remoteConfigPullMs?: number;
  remoteFirmwareCheckMs?: number;
};

export type FirmwareManifest = {
  enabled: boolean;
  version: string;
  url: string;
  sha256: string;
  size: number;
  notes: string;
};

export type RemoteConfigRecord = {
  config: StationRemoteConfig;
  updatedAt: string | null;
};

export type FirmwareManifestRecord = {
  manifest: FirmwareManifest;
  updatedAt: string | null;
};

export const emptyFirmwareManifest: FirmwareManifest = {
  enabled: false,
  version: "",
  url: "",
  sha256: "",
  size: 0,
  notes: ""
};

type NumericConfigField = keyof Omit<StationRemoteConfig, "serverPostEnabled">;

const numberFields: Record<NumericConfigField, { min: number; max: number; integer?: boolean }> = {
  solarSunEnterVoltageV: { min: 0, max: 80 },
  solarSunExitVoltageV: { min: 0, max: 80 },
  solarSunMinPowerW: { min: 0, max: 5000 },
  solarDarkEnterVoltageV: { min: 0, max: 80 },
  solarDarkExitVoltageV: { min: 0, max: 80 },
  solarDarkDeepSleepDelayMs: { min: 0, max: 14 * 24 * 60 * 60 * 1000, integer: true },
  solarDeepSleepWakeMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000, integer: true },
  serverPostSunMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000, integer: true },
  serverPostShadowMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000, integer: true },
  serverPostDarkMs: { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000, integer: true },
  batteryPercentEmptyVoltageV: { min: 0, max: 80 },
  batteryPercentFullVoltageV: { min: 0, max: 80 },
  remoteConfigPullMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000, integer: true },
  remoteFirmwareCheckMs: { min: 5 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000, integer: true }
};

function sourceObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function optionalNumber(
  value: unknown,
  constraints: { min: number; max: number; integer?: boolean }
) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < constraints.min || parsed > constraints.max) return undefined;
  return constraints.integer ? Math.round(parsed) : parsed;
}

function optionalBoolean(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return undefined;
}

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function sanitizeRemoteConfig(value: unknown): StationRemoteConfig {
  const source = sourceObject(value);
  const config: StationRemoteConfig = {};

  for (const [key, constraints] of Object.entries(numberFields)) {
    const parsed = optionalNumber(source[key], constraints);
    if (parsed !== undefined) {
      config[key as NumericConfigField] = parsed;
    }
  }

  const serverPostEnabled = optionalBoolean(source.serverPostEnabled);
  if (serverPostEnabled !== undefined) {
    config.serverPostEnabled = serverPostEnabled;
  }

  return config;
}

export function sanitizeFirmwareManifest(value: unknown): FirmwareManifest {
  const source = sourceObject(value);
  const enabled = optionalBoolean(source.enabled) ?? false;
  const size = optionalNumber(source.size, { min: 0, max: 20 * 1024 * 1024, integer: true }) ?? 0;
  const sha256 = cleanString(source.sha256, 64).toLowerCase();

  return {
    enabled,
    version: cleanString(source.version, 48),
    url: cleanString(source.url, 400),
    sha256: /^[0-9a-f]{64}$/.test(sha256) ? sha256 : "",
    size,
    notes: cleanString(source.notes, 600)
  };
}
