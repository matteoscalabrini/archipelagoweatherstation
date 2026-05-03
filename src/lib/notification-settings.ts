export type NotificationSettings = {
  enabled: boolean;
  webhookUrl: string;
  cooldownMinutes: number;
  stationName: string;
};

export type NotificationSettingsRecord = {
  settings: NotificationSettings;
  updatedAt: string | null;
};

export type NotificationDeliveryState = {
  lastSentAtByAlertId: Record<string, string>;
  updatedAt: string | null;
};

export const defaultNotificationSettings: NotificationSettings = {
  enabled: false,
  webhookUrl: "",
  cooldownMinutes: 60,
  stationName: "Archipelago Weather Station"
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

function optionalString(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function webhookUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 600);
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function sanitizeNotificationSettings(value: unknown): NotificationSettings {
  const source = typeof value === "object" && value !== null ? value as Partial<NotificationSettings> : {};
  return {
    enabled: optionalBoolean(source.enabled, defaultNotificationSettings.enabled),
    webhookUrl: webhookUrl(source.webhookUrl),
    cooldownMinutes: optionalNumber(source.cooldownMinutes, defaultNotificationSettings.cooldownMinutes, 1, 1440, true),
    stationName: optionalString(source.stationName, defaultNotificationSettings.stationName, 80)
  };
}
