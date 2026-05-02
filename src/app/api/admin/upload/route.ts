import crypto from "crypto";
import { del, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getFirmwareManifest, saveFirmwareManifest } from "@/lib/store";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

function safeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "upload.bin";
}

function artifactLabel(value: FormDataEntryValue | null): "firmware" | "spiffs" | null {
  return value === "firmware" || value === "spiffs" ? value : null;
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_form" }, { status: 400 });
  }

  const type = artifactLabel(form.get("type"));
  const file = form.get("file");
  if (!type || !(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ success: false, error: "missing_upload" }, { status: 400 });
  }

  const versionRaw = form.get("version");
  const notesRaw = form.get("notes");
  const version = typeof versionRaw === "string" && versionRaw.trim()
    ? versionRaw.trim().slice(0, 48)
    : new Date().toISOString();
  const notes = typeof notesRaw === "string" ? notesRaw.trim().slice(0, 600) : "";

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const uploadedAt = new Date().toISOString();
  const pathname = `station-ota/${type}-${Date.now()}-${safeName(file.name)}`;

  const current = await getFirmwareManifest();
  const previousUrl = current.manifest[type].url;

  let blob;
  try {
    blob = await put(pathname, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/octet-stream",
      multipart: true
    });
  } catch {
    return NextResponse.json({ success: false, error: "blob_upload_failed" }, { status: 500 });
  }

  if (previousUrl && previousUrl !== blob.url) {
    await del(previousUrl).catch(() => undefined);
  }

  const manifest = {
    ...current.manifest,
    [type]: {
      ...current.manifest[type],
      enabled: true,
      version,
      url: blob.url,
      sha256,
      size: file.size,
      uploadedAt,
      filename: file.name,
      notes
    }
  };

  const record = await saveFirmwareManifest(manifest);
  return NextResponse.json({ success: true, ...record });
}
