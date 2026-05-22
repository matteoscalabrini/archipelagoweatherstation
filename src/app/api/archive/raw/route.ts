import { NextRequest, NextResponse } from "next/server";
import { getRawTelemetryBuffer } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/archive/raw?date=2026-05-22
 *
 * Returns raw telemetry lines for a given date.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const dateStr = searchParams.get("date");
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json(
      { success: false, error: "invalid_date" },
      { status: 400 }
    );
  }

  const buffer = await getRawTelemetryBuffer(dateStr);
  
  // Parse each line back to JSON
  const lines = buffer.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);

  return NextResponse.json({
    success: true,
    date: dateStr,
    count: lines.length,
    data: lines
  });
}