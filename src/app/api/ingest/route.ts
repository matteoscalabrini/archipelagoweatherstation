import { NextRequest, NextResponse } from "next/server";
import { isDeviceAuthorized } from "@/lib/auth";
import { sendActiveAlertNotifications } from "@/lib/notifications";
import { getRecentTelemetry, saveLatestTelemetry } from "@/lib/store";
import { isTelemetryPayload } from "@/lib/telemetry";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isDeviceAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  if (!isTelemetryPayload(body)) {
    return NextResponse.json({ success: false, error: "invalid_payload" }, { status: 400 });
  }

  const payload = {
    ...body,
    receivedAt: new Date().toISOString()
  };

  await saveLatestTelemetry(payload);
  const history = await getRecentTelemetry(10080);
  const notifications = await sendActiveAlertNotifications(payload, history);

  return NextResponse.json({
    success: true,
    receivedAt: payload.receivedAt,
    notifications
  });
}
