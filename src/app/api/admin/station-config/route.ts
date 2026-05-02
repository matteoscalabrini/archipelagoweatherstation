import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getRemoteConfig, saveRemoteConfig } from "@/lib/store";
import { sanitizeRemoteConfig } from "@/lib/management";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  const record = await getRemoteConfig();
  return NextResponse.json({ success: true, ...record });
}

export async function PUT(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  const record = await saveRemoteConfig(sanitizeRemoteConfig(body));
  return NextResponse.json({ success: true, ...record });
}
