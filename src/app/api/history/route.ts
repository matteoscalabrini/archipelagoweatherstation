import { NextRequest, NextResponse } from "next/server";
import { getRecentTelemetry } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const raw = parseInt(searchParams.get("limit") ?? "200", 10);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 200;
  const history = await getRecentTelemetry(limit);
  return NextResponse.json({ success: true, history });
}
