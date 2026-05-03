import { deriveActiveAlerts } from "./events";
import {
  getAlertRules,
  getNotificationDeliveryState,
  getNotificationSettings,
  saveNotificationDeliveryState
} from "./store";
import type { ActiveAlert } from "./events";
import type { NotificationSettings } from "./notification-settings";
import type { WeatherStationTelemetry } from "./telemetry";

type NotificationResult = {
  attempted: number;
  sent: number;
};

function alertText(settings: NotificationSettings, alert: ActiveAlert) {
  const prefix = alert.severity === "bad" ? "Critical" : alert.severity === "warn" ? "Watch" : "Info";
  return `[${settings.stationName}] ${prefix}: ${alert.title} - ${alert.detail}`;
}

async function postWebhook(url: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldSend(lastSentAt: string | undefined, now: number, cooldownMs: number) {
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt).getTime();
  return !Number.isFinite(last) || now - last >= cooldownMs;
}

export async function sendActiveAlertNotifications(
  latest: WeatherStationTelemetry,
  history: WeatherStationTelemetry[]
): Promise<NotificationResult> {
  const [{ settings }, { rules }] = await Promise.all([
    getNotificationSettings(),
    getAlertRules()
  ]);

  if (!settings.enabled || !settings.webhookUrl) return { attempted: 0, sent: 0 };

  const activeAlerts = deriveActiveAlerts(latest, history, rules).filter(alert => alert.severity !== "ok");
  if (activeAlerts.length === 0) return { attempted: 0, sent: 0 };

  const state = await getNotificationDeliveryState();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cooldownMs = settings.cooldownMinutes * 60 * 1000;
  const nextState = { ...state.lastSentAtByAlertId };
  let attempted = 0;
  let sent = 0;

  for (const alert of activeAlerts) {
    if (!shouldSend(state.lastSentAtByAlertId[alert.id], now, cooldownMs)) continue;
    attempted += 1;

    const text = alertText(settings, alert);
    const ok = await postWebhook(settings.webhookUrl, {
      text,
      content: text,
      station: settings.stationName,
      at: nowIso,
      alert,
      telemetry: {
        receivedAt: latest.receivedAt,
        board: latest.board,
        solarMode: latest.solarMode,
        firmwareVersion: latest.firmwareVersion,
        spiffsVersion: latest.spiffsVersion
      }
    });

    if (ok) {
      sent += 1;
      nextState[alert.id] = nowIso;
    }
  }

  if (sent > 0) {
    await saveNotificationDeliveryState({
      lastSentAtByAlertId: nextState,
      updatedAt: nowIso
    });
  }

  return { attempted, sent };
}
