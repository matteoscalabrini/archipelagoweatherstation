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
import {
  createAccumulator,
  updateAccumulator,
  finalizeAccumulator,
  extractRawTelemetryLine,
  getDateStr,
  type DailyAggregate,
  type DailyAccumulator
} from "./archive";

const latestKey = "weatherstation:latest";
const historyKey = "weatherstation:history";
const remoteConfigKey = "weatherstation:remote-config";
const deviceCommandKey = "weatherstation:device-command";
const firmwareManifestKey = "weatherstation:firmware-manifest";
const alertRulesKey = "weatherstation:alert-rules";
const notificationSettingsKey = "weatherstation:notification-settings";
const notificationDeliveryKey = "weatherstation:notification-delivery";
const cumulativeUptimeStateKey = "weatherstation:cumulative-uptime-state";

// Archive keys
function dailyAggregateKey(dateStr: string) {
  return `weatherstation:daily:${dateStr}`;
}
function dailyYearIndexKey(year: number) {
  return `weatherstation:daily:index:${year}`;
}
function dailyMonthIndexKey(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  return `weatherstation:daily:index:${year}-${mm}`;
}

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
  __weatherstationCumulativeUptime?: CumulativeUptimeState;
  // Archive memory fallback
  __archiveDailyAggregates?: Record<string, DailyAggregate>;
  __archiveAccumulators?: Record<string, DailyAccumulator>;
};

type CumulativeUptimeState = {
  lastSeenBootUptimeMs: number | null;
  cumulativeOffsetMs: number;
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
  // Compute cumulative uptime from per-boot uptimeMs
  const cumulativeUptimeMs = await computeCumulativeUptime(payload.uptimeMs);

  const enrichedPayload: WeatherStationTelemetry = {
    ...payload,
    cumulativeUptimeMs
  };

  if (kvConfigured()) {
    const client = redisClient();
    await Promise.all([
      client.set(latestKey, enrichedPayload),
      client.lpush(historyKey, enrichedPayload)
    ]);
    await client.ltrim(historyKey, 0, HISTORY_CAP - 1);
  } else {
    const g = globalThis as MemoryGlobal;
    g.__weatherstationLatest = enrichedPayload;
    g.__weatherstationHistory = [enrichedPayload, ...(g.__weatherstationHistory ?? [])].slice(0, HISTORY_CAP);
  }

  // Archive: update daily aggregate and buffer raw telemetry
  await processArchiveData(enrichedPayload);
}

/**
 * Process archive data for a telemetry payload.
 * Updates the daily accumulator and buffers raw telemetry lines.
 */
async function processArchiveData(payload: WeatherStationTelemetry): Promise<void> {
  const receivedAt = payload.receivedAt;
  if (!receivedAt) return;

  const dateStr = getDateStr(receivedAt);

  // Check if there's an existing accumulator for a different day (date boundary)
  let acc = await getOrCreateAccumulator(dateStr);
  
  // If the accumulator is from a previous day, finalize it first
  if (acc.date !== dateStr && acc.count > 0) {
    const oldRecord = finalizeAccumulator(acc);
    await saveDailyAggregate(oldRecord);

    // Flush raw telemetry buffer for that old day to blob
    try {
      await flushRawTelemetryToBlob(acc.date);
    } catch { /* non-critical */ }

    // Start fresh accumulator for new date
    acc = createAccumulator(dateStr);
  }
  
  updateAccumulator(acc, payload);
  await saveAccumulator(acc);

  // Buffer raw telemetry line for blob export (will be flushed on date boundary)
  const rawLine = extractRawTelemetryLine(payload);
  await appendRawTelemetryBuffer(dateStr, rawLine);
}

/**
 * Flush the raw telemetry buffer for a given day to Vercel Blob.
 * Stored gzip-compressed as `.jsonl.gz` — weather data compresses ~85%,
 * stretching the free-plan storage budget by an order of magnitude.
 */
async function flushRawTelemetryToBlob(dateStr: string): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return; // No blob configured

  try {
    const { put } = await import("@vercel/blob");
    const { gzipSync } = await import("node:zlib");

    const buffer = await getRawTelemetryBuffer(dateStr);
    if (buffer.length === 0) return;

    const content = buffer.join("\n") + "\n";
    const compressed = gzipSync(Buffer.from(content, "utf8"), { level: 9 });
    const pathname = `weather-history/raw/${dateStr.replace(/-/g, "/")}.jsonl.gz`;

    // Write the full file — each day gets one blob write with all its data
    await put(pathname, compressed, {
      access: "private",
      token: blobToken,
      contentType: "application/gzip"
    });

    // Clear the buffer after successful upload
    await clearRawTelemetryBuffer(dateStr);
  } catch (error) {
    console.error(`Failed to flush raw telemetry for ${dateStr}:`, error);
  }
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

/**
 * Get the current cumulative uptime state.
 */
async function getCumulativeUptimeState(): Promise<CumulativeUptimeState> {
  const empty: CumulativeUptimeState = { lastSeenBootUptimeMs: null, cumulativeOffsetMs: 0 };
  if (kvConfigured()) {
    const record = await redisClient().get<CumulativeUptimeState>(cumulativeUptimeStateKey);
    return record ?? empty;
  }
  return (globalThis as MemoryGlobal).__weatherstationCumulativeUptime ?? empty;
}

/**
 * Save the cumulative uptime state.
 */
async function saveCumulativeUptimeState(state: CumulativeUptimeState): Promise<void> {
  if (kvConfigured()) {
    await redisClient().set(cumulativeUptimeStateKey, state);
    return;
  }
  (globalThis as MemoryGlobal).__weatherstationCumulativeUptime = state;
}

/**
 * Compute cumulative uptime from the current boot's uptimeMs.
 *
 * Logic:
 * - On first telemetry: store lastSeenBootUptimeMs and set offset to 0
 * - If current uptimeMs < previous uptimeMs → device rebooted, add old value to offset
 * - Otherwise (normal increment): update lastSeenBootUptimeMs
 */
export async function computeCumulativeUptime(currentBootUptimeMs: number | undefined): Promise<number> {
  if (!currentBootUptimeMs || currentBootUptimeMs <= 0) return 0;

  const state = await getCumulativeUptimeState();

  let newOffset = state.cumulativeOffsetMs;
  let lastSeen = state.lastSeenBootUptimeMs;

  if (lastSeen === null) {
    // First telemetry ever — just record it
    lastSeen = currentBootUptimeMs;
  } else if (currentBootUptimeMs < lastSeen) {
    // Device rebooted: add the previous boot's uptime to cumulative offset
    newOffset += lastSeen;
    lastSeen = currentBootUptimeMs;
  } else {
    // Normal increment within same boot cycle — just update last seen
    lastSeen = currentBootUptimeMs;
  }

  await saveCumulativeUptimeState({ lastSeenBootUptimeMs: lastSeen, cumulativeOffsetMs: newOffset });

  return newOffset + currentBootUptimeMs;
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

/* ==========================================================================
   Archive — Daily Aggregates & Raw Telemetry Storage
   ========================================================================== */

/** Get a daily aggregate for the given date. */
export async function getDailyAggregate(dateStr: string): Promise<DailyAggregate | null> {
  if (kvConfigured()) {
    const client = redisClient();
    return await client.get<DailyAggregate>(dailyAggregateKey(dateStr));
  }
  const g = globalThis as MemoryGlobal;
  return g.__archiveDailyAggregates?.[dateStr] ?? null;
}

/** Save a daily aggregate record. */
export async function saveDailyAggregate(record: DailyAggregate): Promise<void> {
  if (kvConfigured()) {
    const client = redisClient();
    await Promise.all([
      client.set(dailyAggregateKey(record.date), record),
      // Add to year index
      client.sadd(dailyYearIndexKey(record.year), record.date),
      // Add to month index
      client.sadd(dailyMonthIndexKey(record.year, record.month), record.date)
    ]);
    return;
  }
  const g = globalThis as MemoryGlobal;
  if (!g.__archiveDailyAggregates) {
    g.__archiveDailyAggregates = {};
  }
  g.__archiveDailyAggregates[record.date] = record;
}

/** Get all daily aggregates for a given year. */
export async function getDailyAggregatesForYear(year: number): Promise<DailyAggregate[]> {
  if (kvConfigured()) {
    const client = redisClient();
    const dates = await client.smembers(dailyYearIndexKey(year));
    if (!dates || !Array.isArray(dates) || dates.length === 0) return [];
    // Fetch all aggregates in parallel
    const results: (DailyAggregate | null)[] = await Promise.all(
      (dates as string[]).map((d: string) => client.get<DailyAggregate>(dailyAggregateKey(d)))
    );
    return results.filter((r): r is DailyAggregate => r !== null);
  }
  const g = globalThis as MemoryGlobal;
  if (!g.__archiveDailyAggregates) return [];
  return Object.values(g.__archiveDailyAggregates)
    .filter(r => r.year === year)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Get all daily aggregates for a given month. */
export async function getDailyAggregatesForMonth(year: number, month: number): Promise<DailyAggregate[]> {
  if (kvConfigured()) {
    const client = redisClient();
    const dates = await client.smembers(dailyMonthIndexKey(year, month));
    if (!dates || !Array.isArray(dates) || dates.length === 0) return [];
    const results: (DailyAggregate | null)[] = await Promise.all(
      (dates as string[]).map((d: string) => client.get<DailyAggregate>(dailyAggregateKey(d)))
    );
    return results.filter((r): r is DailyAggregate => r !== null);
  }
  const g = globalThis as MemoryGlobal;
  if (!g.__archiveDailyAggregates) return [];
  return Object.values(g.__archiveDailyAggregates)
    .filter(r => r.year === year && r.month === month)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Get the running accumulator for today (or create one). */
export async function getOrCreateAccumulator(dateStr: string): Promise<DailyAccumulator> {
  if (kvConfigured()) {
    const client = redisClient();
    const existing = await client.get<DailyAccumulator>(`weatherstation:daily-acc:${dateStr}`);
    return existing ?? createAccumulator(dateStr);
  }
  const g = globalThis as MemoryGlobal;
  if (!g.__archiveAccumulators) {
    g.__archiveAccumulators = {};
  }
  return g.__archiveAccumulators[dateStr] ?? createAccumulator(dateStr);
}

/** Save the running accumulator for a date. */
export async function saveAccumulator(acc: DailyAccumulator): Promise<void> {
  if (kvConfigured()) {
    const client = redisClient();
    await client.set(`weatherstation:daily-acc:${acc.date}`, acc, { ex: 86400 * 2 });
    return;
  }
  const g = globalThis as MemoryGlobal;
  if (!g.__archiveAccumulators) {
    g.__archiveAccumulators = {};
  }
  g.__archiveAccumulators[acc.date] = acc;
}

/** Append a raw telemetry line to the daily blob buffer in Redis. */
export async function appendRawTelemetryBuffer(dateStr: string, line: object): Promise<void> {
  if (kvConfigured()) {
    const client = redisClient();
    await client.lpush(`weatherstation:daily-raw:${dateStr}`, JSON.stringify(line));
    return;
  }
  // In-memory fallback — store as array
  const g = globalThis as MemoryGlobal;
  const key = `__archiveRawBuffer_${dateStr}`;
  if (!(g as any)[key]) {
    (g as any)[key] = [];
  }
  (g as any)[key].unshift(JSON.stringify(line));
}

/** Get the raw telemetry buffer for a date. */
export async function getRawTelemetryBuffer(dateStr: string): Promise<string[]> {
  if (kvConfigured()) {
    const client = redisClient();
    return await client.lrange<string>(`weatherstation:daily-raw:${dateStr}`, 0, -1) ?? [];
  }
  const g = globalThis as MemoryGlobal;
  const key = `__archiveRawBuffer_${dateStr}`;
  return (g as any)[key] ?? [];
}

/** Clear the raw telemetry buffer for a date. */
export async function clearRawTelemetryBuffer(dateStr: string): Promise<void> {
  if (kvConfigured()) {
    await redisClient().del(`weatherstation:daily-raw:${dateStr}`);
    return;
  }
  const g = globalThis as MemoryGlobal;
  delete (g as any)[`__archiveRawBuffer_${dateStr}`];
}

/** Get all available years that have daily aggregates. */
export async function getAvailableYears(): Promise<number[]> {
  if (kvConfigured()) {
    const client = redisClient();
    // Use keys() to find year index patterns — small dataset (~365 max)
    const allKeys: string[] = await client.keys("weatherstation:daily:index:*");
    const yearsSet: Set<string> = new Set();
    for (const key of allKeys) {
      const match = String(key).match(/weatherstation:daily:index:(\d{4})$/);
      if (match) yearsSet.add(match[1]);
    }
    return Array.from(yearsSet).map(Number).sort((a, b) => a - b);
  }
  const g = globalThis as MemoryGlobal;
  if (!g.__archiveDailyAggregates) return [];
  const yearsSet = new Set(Object.values(g.__archiveDailyAggregates).map(r => r.year));
  return Array.from(yearsSet).sort((a, b) => a - b);
}
