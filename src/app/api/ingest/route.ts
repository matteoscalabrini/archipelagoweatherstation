import { NextRequest, NextResponse } from "next/server";
import { saveLatestTelemetry } from "@/lib/store";
import { isTelemetryPayload } from "@/lib/telemetry";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const expected = process.env.WEATHER_STATION_API_KEY;
  if (!expected) return false;

  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const apiKey = request.headers.get("x-api-key") ?? "";
  return bearer === expected || apiKey === expected;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
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

  return NextResponse.json({
    success: true,
    receivedAt: payload.receivedAt
  });
}
