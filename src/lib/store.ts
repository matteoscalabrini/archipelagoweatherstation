import { Redis } from "@upstash/redis";
import type {
  FirmwareManifestRecord,
  RemoteConfigRecord,
  StationRemoteConfig,
  FirmwareManifest
} from "./management";
import { emptyFirmwareManifest } from "./management";
import type { WeatherStationTelemetry } from "./telemetry";

const latestKey = "weatherstation:latest";
const historyKey = "weatherstation:history";
const remoteConfigKey = "weatherstation:remote-config";
const firmwareManifestKey = "weatherstation:firmware-manifest";
const HISTORY_CAP = 500;

type MemoryGlobal = typeof globalThis & {
  __weatherstationLatest?: WeatherStationTelemetry;
  __weatherstationHistory?: WeatherStationTelemetry[];
  __weatherstationRemoteConfig?: RemoteConfigRecord;
  __weatherstationFirmwareManifest?: FirmwareManifestRecord;
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

export async function getRemoteConfig(): Promise<RemoteConfigRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<RemoteConfigRecord>(remoteConfigKey);
    return record ?? { config: {}, updatedAt: null };
  }
  return (globalThis as MemoryGlobal).__weatherstationRemoteConfig ?? { config: {}, updatedAt: null };
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

export async function getFirmwareManifest(): Promise<FirmwareManifestRecord> {
  if (kvConfigured()) {
    const record = await redisClient().get<FirmwareManifestRecord>(firmwareManifestKey);
    return record ?? { manifest: emptyFirmwareManifest, updatedAt: null };
  }
  return (globalThis as MemoryGlobal).__weatherstationFirmwareManifest ??
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
