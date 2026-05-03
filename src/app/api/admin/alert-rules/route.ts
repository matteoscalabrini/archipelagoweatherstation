import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sanitizeAlertRules } from "@/lib/events";
import { getAlertRules, saveAlertRules } from "@/lib/store";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  const record = await getAlertRules();
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

  const record = await saveAlertRules(sanitizeAlertRules(body));
  return NextResponse.json({ success: true, ...record });
}
