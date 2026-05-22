export type DisplayReading = {
  id?: number;
  label: string;
  primary: number | string | null;
  primaryUnit?: string;
  secondary?: number | string | null;
  secondaryUnit?: string;
  secondaryLabel?: string;
  displayOnline?: boolean;
  sourceOnline?: boolean;
  bus?: number;
  i2cAddress?: number;
  i2cAddressHex?: string;
  online: boolean;
};

export type DisplayStatus = {
  count?: number;
  onlineCount?: number;
  offlineCount?: number;
  allOnline?: boolean;
  forcedOff?: boolean;
  onlineMask?: number;
  offlineMask?: number;
  offline?: Array<{
    id?: number;
    bus?: number;
    i2cAddress?: number;
    i2cAddressHex?: string;
  }>;
};

export type WeatherStationTelemetry = {
  board?: string;
  firmwareVersion?: string;
  spiffsVersion?: string;
  uptimeMs?: number;
  cumulativeUptimeMs?: number;
  solarMode?: "unknown" | "dark" | "shadow" | "sun" | string;
  displaysForcedOff?: boolean;
  wifi?: {
    enabled?: boolean;
    ap?: boolean;
    sta?: boolean;
    recoveryAp?: boolean;
    recoveryApRemainingMs?: number;
    ip?: string;
    apIp?: string;
    lastPostCode?: number;
    lastPostMessage?: string;
    lastRemoteConfigPullMs?: number;
    remoteConfigHttpCode?: number;
    remoteConfigMessage?: string;
    lastFirmwareCheckMs?: number;
    firmwareHttpCode?: number;
    otaHttpCode?: number;
    firmwareMessage?: string;
  };
  sensors?: Record<string, boolean>;
  config?: StationRemoteConfig;
  displayStatus?: DisplayStatus;
  displays?: DisplayReading[];
  receivedAt?: string;
};

export function isTelemetryPayload(value: unknown): value is WeatherStationTelemetry {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as WeatherStationTelemetry;
  return Array.isArray(payload.displays);
}

export function emptyTelemetry(): WeatherStationTelemetry {
  return {
    board: "Weather Station",
    solarMode: "unknown",
    displaysForcedOff: false,
    displays: [],
    receivedAt: undefined
  };
}
import type { StationRemoteConfig } from "./management";
