import { NextResponse } from "next/server";
import { getLatestTelemetry } from "@/lib/store";
import { emptyTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";

export async function GET() {
  const latest = await getLatestTelemetry();
  return NextResponse.json({
    success: true,
    telemetry: latest ?? emptyTelemetry(),
    connected: Boolean(latest)
  });
}
