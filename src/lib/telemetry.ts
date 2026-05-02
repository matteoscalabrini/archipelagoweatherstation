export type DisplayReading = {
  label: string;
  primary: number | string | null;
  primaryUnit?: string;
  secondary?: number | string | null;
  secondaryUnit?: string;
  secondaryLabel?: string;
  online: boolean;
};

export type WeatherStationTelemetry = {
  board?: string;
  firmwareVersion?: string;
  spiffsVersion?: string;
  uptimeMs?: number;
  solarMode?: "unknown" | "dark" | "shadow" | "sun" | string;
  displaysForcedOff?: boolean;
  wifi?: {
    enabled?: boolean;
    ap?: boolean;
    sta?: boolean;
    ip?: string;
    apIp?: string;
    lastPostCode?: number;
    lastPostMessage?: string;
    lastRemoteConfigPullMs?: number;
    remoteConfigMessage?: string;
    lastFirmwareCheckMs?: number;
    firmwareMessage?: string;
  };
  sensors?: Record<string, boolean>;
  config?: StationRemoteConfig;
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
