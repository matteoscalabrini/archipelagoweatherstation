import { NextRequest, NextResponse } from "next/server";
import { isDeviceAuthorized } from "@/lib/auth";
import { getFirmwareManifest } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isDeviceAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const current = request.nextUrl.searchParams.get("version") ?? "";
  const record = await getFirmwareManifest();
  const firmware = record.manifest;
  const updateAvailable = Boolean(
    firmware.enabled &&
    firmware.version &&
    firmware.url &&
    firmware.version !== current
  );

  return NextResponse.json(
    { success: true, firmware, updateAvailable, updatedAt: record.updatedAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
