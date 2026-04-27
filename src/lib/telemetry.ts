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
  };
  sensors?: Record<string, boolean>;
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
