import { NextRequest, NextResponse } from "next/server";
import { isDeviceAuthorized } from "@/lib/auth";
import { getRemoteConfig } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isDeviceAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const record = await getRemoteConfig();
  return NextResponse.json(
    { success: true, ...record },
    { headers: { "Cache-Control": "no-store" } }
  );
}
