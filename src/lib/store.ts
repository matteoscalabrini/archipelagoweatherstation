import { Redis } from "@upstash/redis";
import type {
  DeviceCommand,
  DeviceCommandRecord,
  FirmwareManifestRecord,
  RemoteConfigRecord,
  StationRemoteConfig,
  FirmwareManifest
} from "./management";
import { emptyFirmwareManifest, sanitizeDeviceCommand, sanitizeFirmwareManifest, sanitizeRemoteConfig } from "./management";
import { defaultAlertRules, sanitizeAlertRules, type AlertRules, type AlertRulesRecord } from "./events";
import {
  defaultNotificationSettings,
  sanitizeNotificationSettings,
  type NotificationDeliveryState,
  type NotificationSettings,
  type NotificationSettingsRecord
} from "./notification-settings";
import type { WeatherStationTelemetry } from "./telemetry";

const latestKey = "weatherstation:latest";
const historyKey = "weatherstation:history";
const remoteConfigKey = "weatherstation:remote-config";
const deviceCommandKey = "weatherstation:device-command";
const firmwareManifestKey = "weatherstation:firmware-manifest";
const alertRulesKey = "weatherstation:alert-rules";
const notificationSettingsKey = "weatherstation:notification-settings";
const notificationDeliveryKey = "weatherstation:notification-delivery";
const HISTORY_CAP = 10080;

export type StorageDiagnostics = {
  backend: "redis" | "memory";
  provider: "upstash" | "vercel-kv" | "none";
  configured: {
    upstashUrl: boolean;
    upstashToken: boolean;
    kvUrl: boolean;
    kvToken: boolean;
  };
  latest: {
    exists: boolean;
    receivedAt: string | null;
  };
  history: {
    keyType: string;
    length: number;
    newestReceivedAt: string | null;
    oldestReceivedAt: string | null;
  };
};

type MemoryGlobal = typeof globalThis & {
  __weatherstationLatest?: WeatherStationTelemetry;
  __weatherstationHistory?: WeatherStationTelemetry[];
  __weatherstationRemoteConfig?: RemoteConfigRecord;
  __weatherstationDeviceCommand?: DeviceCommandRecord;
  __weatherstationFirmwareManifest?: FirmwareManifestRecord;
  __weatherstationAlertRules?: AlertRulesRecord;
  __weatherstationNotificationSettings?: NotificationSettingsRecord;
  __weatherstationNotificationDelivery?: NotificationDeliveryState;
};

function kvConfigured() {
  return Boolean(redisUrl() && redisToken());
}

function redisUrl() {
  return process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
}

function redisToken() {
  return process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
}

function redisClient() {
  return new Redis({
    url: redisUrl(),
    token: redisToken()
  });
}

function storageProvider(): StorageDiagnostics["provider"] {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "vercel-kv";
  return "none";
}

export async function saveLatestTelemetry(payload: WeatherStationTelemetry) {
  if (kvConfigured()) {
    const client = redisClient();
    await Promise.all([
      client.set(latestKey, payload),
      client.lpush(historyKey, payload)
    ]);
    await client.ltrim(historyKey, 0, HISTORY_CAP - 1);
    return;
  }
  const g = globalThis as MemoryGlobal;
  g.__weatherstationLatest = payload;
  g.__weatherstationHistory = [payload, ...(g.__weatherstationHistory ?? [])].slice(0, HISTORY_CAP);
}

export async function getLatestTelemetry() {
  if (kvConfigured()) {
    return await redisClient().get<WeatherStationTelemetry>(latestKey);
  }
  return (globalThis as MemoryGlobal).__weatherstationLatest ?? null;
}

export async function getRecentTelemetry(limit = 200): Promise<WeatherStationTelemetry[]> {
  const cap = Math.max(1, Math.min(HISTORY_CAP, limit));
  if (kvConfigured()) {
    const items = await redisClient().lrange<WeatherStationTelemetry>(historyKey, 0, cap - 1);
    return items ?? [];
  }
  return (globalThis as MemoryGlobal).__weatherstationHistory?.slice(0, cap) ?? [];
}

export async function clearTelemetryHistory() {
  if (kvConfigured()) {
    await redisClient().del(historyKey);
    return;
  }
  (globalThis as MemoryGlobal).__weatherstationHistory = [];
}

export async function getStorageDiagnostics(): Promise<StorageDiagnostics> {
  const configured = {
    upstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    upstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    kvUrl: Boolean(process.env.KV_REST_API_URL),
    kvToken: Boolean(process.env.KV_REST_API_TOKEN)
  };

  if (kvConfigured()) {
    const client = redisClient();
    const [latest, keyType] = await Promise.all([
      client.get<WeatherStationTelemetry>(latestKey),
      client.type(historyKey)
    ]);
    const length = keyType === "list" ? await client.llen(historyKey) : 0;
    const newestItems = length > 0 ? await client.lrange<WeatherStationTelemetry>(historyKey, 0, 0) : [];
    const oldestItems = length > 0 ?
      await client.lrange<WeatherStationTelemetry>(historyKey, length - 1, length - 1) : [];

    return {
      backend: "redis",
      provider: storageProvider(),
      configured,
      latest: {
        exists: Boolean(latest),
        receivedAt: latest?.receivedAt ?? null
      },
      history: {
        keyType,
        length,
        newestReceivedAt: newestItems[0]?.receivedAt ?? null,
        oldestReceivedAt: oldestItems[0]?.receivedAt ?? null
      }
    };
  }

  const g = globalThis as MemoryGlobal;
  const history = g.__weatherstationHistory ?? [];
  return {
    backend: "memory",
    provider: "none",
    configured,
    latest: {
      exists: Boolean(g.__weatherstationLatest),
      receivedAt: g.__weatherstationLatest?.receivedAt ?? null
    },
    history: {
      keyType: "memory-array",
      length: history.length,
      newestReceivedAt: history[0]?.receivedAt ?? null,
      oldestReceivedAt: history[history.length - 1]?.receivedAt ?? null
    }
  };
}

export async function getRemoteConfig(): Promise<RemoteConfigRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<RemoteConfigRecord>(remoteConfigKey);
    return record ? { config: sanitizeRemoteConfig(record.config), updatedAt: record.updatedAt ?? null } :
      { config: {}, updatedAt: null };
  }
  const record = (globalThis as MemoryGlobal).__weatherstationRemoteConfig;
  return record ? { config: sanitizeRemoteConfig(record.config), updatedAt: record.updatedAt ?? null } :
    { config: {}, updatedAt: null };
}

export async function saveRemoteConfig(config: StationRemoteConfig): Promise<RemoteConfigRecord> {
  const record = { config, updatedAt: new Date().toISOString() };
  if (kvConfigured()) {
    await redisClient().set(remoteConfigKey, record);
    return record;
  }
  (globalThis as MemoryGlobal).__weatherstationRemoteConfig = record;
  return record;
}

function normalizeDeviceCommandRecord(record: DeviceCommandRecord | null | undefined): DeviceCommandRecord {
  const command = sanitizeDeviceCommand(record?.command);
  return {
    command,
    updatedAt: record?.updatedAt ?? null
  };
}

export async function getDeviceCommand(): Promise<DeviceCommandRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<DeviceCommandRecord>(deviceCommandKey);
    return normalizeDeviceCommandRecord(record);
  }
  return normalizeDeviceCommandRecord((globalThis as MemoryGlobal).__weatherstationDeviceCommand);
}

export async function queueDeviceCommand(command: DeviceCommand): Promise<DeviceCommandRecord> {
  const record = { command, updatedAt: new Date().toISOString() };
  if (kvConfigured()) {
    await redisClient().set(deviceCommandKey, record);
    return record;
  }
  (globalThis as MemoryGlobal).__weatherstationDeviceCommand = record;
  return record;
}

export async function clearDeviceCommand(): Promise<DeviceCommandRecord> {
  if (kvConfigured()) {
    await redisClient().del(deviceCommandKey);
  } else {
    (globalThis as MemoryGlobal).__weatherstationDeviceCommand = undefined;
  }
  return { command: null, updatedAt: new Date().toISOString() };
}

export async function consumeDeviceCommand(): Promise<DeviceCommandRecord> {
  const record = await getDeviceCommand();
  if (record.command) await clearDeviceCommand();
  return record;
}

export async function getFirmwareManifest(): Promise<FirmwareManifestRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<FirmwareManifestRecord>(firmwareManifestKey);
    return record ?
      { manifest: sanitizeFirmwareManifest(record.manifest), updatedAt: record.updatedAt ?? null } :
      { manifest: emptyFirmwareManifest, updatedAt: null };
  }
  const record = (globalThis as MemoryGlobal).__weatherstationFirmwareManifest;
  return record ?
    { manifest: sanitizeFirmwareManifest(record.manifest), updatedAt: record.updatedAt ?? null } :
    { manifest: emptyFirmwareManifest, updatedAt: null };
}

export async function saveFirmwareManifest(manifest: FirmwareManifest): Promise<FirmwareManifestRecord> {
  const record = { manifest, updatedAt: new Date().toISOString() };
  if (kvConfigured()) {
    await redisClient().set(firmwareManifestKey, record);
    return record;
  }
  (globalThis as MemoryGlobal).__weatherstationFirmwareManifest = record;
  return record;
}

export async function getAlertRules(): Promise<AlertRulesRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<AlertRulesRecord>(alertRulesKey);
    return record ?
      { rules: sanitizeAlertRules(record.rules), updatedAt: record.updatedAt ?? null } :
      { rules: defaultAlertRules, updatedAt: null };
  }
  const record = (globalThis as MemoryGlobal).__weatherstationAlertRules;
  return record ?
    { rules: sanitizeAlertRules(record.rules), updatedAt: record.updatedAt ?? null } :
    { rules: defaultAlertRules, updatedAt: null };
}

export async function saveAlertRules(rules: AlertRules): Promise<AlertRulesRecord> {
  const record = { rules: sanitizeAlertRules(rules), updatedAt: new Date().toISOString() };
  if (kvConfigured()) {
    await redisClient().set(alertRulesKey, record);
    return record;
  }
  (globalThis as MemoryGlobal).__weatherstationAlertRules = record;
  return record;
}

export async function getNotificationSettings(): Promise<NotificationSettingsRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<NotificationSettingsRecord>(notificationSettingsKey);
    return record ?
      { settings: sanitizeNotificationSettings(record.settings), updatedAt: record.updatedAt ?? null } :
      { settings: defaultNotificationSettings, updatedAt: null };
  }
  const record = (globalThis as MemoryGlobal).__weatherstationNotificationSettings;
  return record ?
    { settings: sanitizeNotificationSettings(record.settings), updatedAt: record.updatedAt ?? null } :
    { settings: defaultNotificationSettings, updatedAt: null };
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<NotificationSettingsRecord> {
  const record = { settings: sanitizeNotificationSettings(settings), updatedAt: new Date().toISOString() };
  if (kvConfigured()) {
    await redisClient().set(notificationSettingsKey, record);
    return record;
  }
  (globalThis as MemoryGlobal).__weatherstationNotificationSettings = record;
  return record;
}

export async function getNotificationDeliveryState(): Promise<NotificationDeliveryState> {
  if (kvConfigured()) {
    const record = await redisClient().get<NotificationDeliveryState>(notificationDeliveryKey);
    return record ?
      { lastSentAtByAlertId: record.lastSentAtByAlertId ?? {}, updatedAt: record.updatedAt ?? null } :
      { lastSentAtByAlertId: {}, updatedAt: null };
  }
  return (globalThis as MemoryGlobal).__weatherstationNotificationDelivery ?? {
    lastSentAtByAlertId: {},
    updatedAt: null
  };
}

export async function saveNotificationDeliveryState(state: NotificationDeliveryState): Promise<NotificationDeliveryState> {
  const record = {
    lastSentAtByAlertId: state.lastSentAtByAlertId ?? {},
    updatedAt: new Date().toISOString()
  };
  if (kvConfigured()) {
    await redisClient().set(notificationDeliveryKey, record);
    return record;
  }
  (globalThis as MemoryGlobal).__weatherstationNotificationDelivery = record;
  return record;
}
