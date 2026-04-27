import { Redis } from "@upstash/redis";
import type { WeatherStationTelemetry } from "./telemetry";

const latestKey = "weatherstation:latest";

type MemoryGlobal = typeof globalThis & {
  __weatherstationLatest?: WeatherStationTelemetry;
};

function kvConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function redisClient() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!
  });
}

export async function saveLatestTelemetry(payload: WeatherStationTelemetry) {
  if (kvConfigured()) {
    await redisClient().set(latestKey, payload);
    return;
  }
  (globalThis as MemoryGlobal).__weatherstationLatest = payload;
}

export async function getLatestTelemetry() {
  if (kvConfigured()) {
    return await redisClient().get<WeatherStationTelemetry>(latestKey);
  }
  return (globalThis as MemoryGlobal).__weatherstationLatest ?? null;
}
