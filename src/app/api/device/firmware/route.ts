import { NextRequest, NextResponse } from "next/server";
import { createDeviceArtifactToken, isDeviceAuthorized } from "@/lib/auth";
import { getFirmwareManifest } from "@/lib/store";

export const runtime = "nodejs";

function artifactUrl(request: NextRequest, type: "firmware" | "spiffs") {
  const url = new URL("/api/device/artifact", request.nextUrl.origin);
  url.searchParams.set("type", type);
  url.searchParams.set("downloadToken", createDeviceArtifactToken(type));
  return url.toString();
}

export async function GET(request: NextRequest) {
  if (!isDeviceAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const current = request.nextUrl.searchParams.get("version") ?? "";
  const currentSpiffs = request.nextUrl.searchParams.get("spiffs") ?? "";
  const record = await getFirmwareManifest();
  const { firmware, spiffs } = record.manifest;
  const firmwareBlobAvailable = Boolean(firmware.pathname || firmware.url);
  const spiffsBlobAvailable = Boolean(spiffs.pathname || spiffs.url);
  const firmwareUpdateAvailable = Boolean(
    firmware.enabled && firmware.version && firmwareBlobAvailable && firmware.version !== current
  );
  const spiffsUpdateAvailable = Boolean(
    spiffs.enabled && spiffs.version && spiffsBlobAvailable && spiffs.version !== currentSpiffs
  );
  const firmwareUrl = firmwareUpdateAvailable ? artifactUrl(request, "firmware") : "";
  const spiffsUrl = spiffsUpdateAvailable ? artifactUrl(request, "spiffs") : "";

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
      firmwareUrl,
      firmwareSha256: firmware.sha256,
      firmwareSize: firmware.size,
      spiffsEnabled: spiffs.enabled,
      spiffsVersion: spiffs.version,
      spiffsUrl,
      spiffsSha256: spiffs.sha256,
      spiffsSize: spiffs.size,
      updatedAt: record.updatedAt
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
