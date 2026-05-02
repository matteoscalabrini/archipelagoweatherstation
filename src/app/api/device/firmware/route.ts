import { NextRequest, NextResponse } from "next/server";
import { isDeviceAuthorized } from "@/lib/auth";
import { getFirmwareManifest } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isDeviceAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const current = request.nextUrl.searchParams.get("version") ?? "";
  const currentSpiffs = request.nextUrl.searchParams.get("spiffs") ?? "";
  const record = await getFirmwareManifest();
  const { firmware, spiffs } = record.manifest;
  const firmwareUpdateAvailable = Boolean(
    firmware.enabled && firmware.version && firmware.url && firmware.version !== current
  );
  const spiffsUpdateAvailable = Boolean(
    spiffs.enabled && spiffs.version && spiffs.url && spiffs.version !== currentSpiffs
  );

  return NextResponse.json(
    {
      success: true,
      firmware,
      spiffs,
      updateAvailable: firmwareUpdateAvailable,
      firmwareUpdateAvailable,
      spiffsUpdateAvailable,
      firmwareEnabled: firmware.enabled,
      firmwareVersion: firmware.version,
      firmwareUrl: firmware.url,
      firmwareSha256: firmware.sha256,
      firmwareSize: firmware.size,
      spiffsEnabled: spiffs.enabled,
      spiffsVersion: spiffs.version,
      spiffsUrl: spiffs.url,
      spiffsSha256: spiffs.sha256,
      spiffsSize: spiffs.size,
      updatedAt: record.updatedAt
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
