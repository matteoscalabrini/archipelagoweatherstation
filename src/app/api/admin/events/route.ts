import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { clearTelemetryHistory } from "@/lib/store";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export async function DELETE(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  await clearTelemetryHistory();
  return NextResponse.json({ success: true });
}
