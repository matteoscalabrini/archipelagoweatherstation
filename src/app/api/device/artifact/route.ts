import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isDeviceArtifactRequestAuthorized } from "@/lib/auth";
import { getFirmwareManifest } from "@/lib/store";

export const runtime = "nodejs";

type ArtifactType = "firmware" | "spiffs";

function artifactLabel(value: string | null): ArtifactType | null {
  return value === "firmware" || value === "spiffs" ? value : null;
}

function safeDownloadName(value: string, fallback: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export async function GET(request: NextRequest) {
  const type = artifactLabel(request.nextUrl.searchParams.get("type"));
  if (!type) {
    return NextResponse.json({ success: false, error: "invalid_artifact" }, { status: 400 });
  }
  if (!isDeviceArtifactRequestAuthorized(request, type)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json({ success: false, error: "blob_token_not_configured" }, { status: 500 });
  }

  const record = await getFirmwareManifest();
  const artifact = record.manifest[type];
  const blobPath = artifact.pathname || artifact.url;
  if (!artifact.enabled || !artifact.version || !blobPath) {
    return NextResponse.json({ success: false, error: "artifact_not_available" }, { status: 404 });
  }

  let result;
  try {
    result = await get(blobPath, {
      access: "private",
      token: blobToken,
      useCache: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "blob_download_failed";
    return NextResponse.json({ success: false, error: "blob_download_failed", detail: message }, { status: 502 });
  }

  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ success: false, error: "artifact_not_found" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", result.blob.contentType || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${safeDownloadName(artifact.filename, `${type}.bin`)}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  if (result.blob.etag) headers.set("ETag", result.blob.etag);

  return new NextResponse(result.stream, { headers });
}
