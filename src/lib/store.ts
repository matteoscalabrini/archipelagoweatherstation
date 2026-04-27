import { Redis } from "@upstash/redis";
import type { WeatherStationTelemetry } from "./telemetry";

const latestKey = "weatherstation:latest";
const historyKey = "weatherstation:history";
const HISTORY_CAP = 500;

type MemoryGlobal = typeof globalThis & {
  __weatherstationLatest?: WeatherStationTelemetry;
  __weatherstationHistory?: WeatherStationTelemetry[];
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
