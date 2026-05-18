import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { createDeviceCommand, isDeviceCommandType } from "@/lib/management";
import { clearDeviceCommand, getDeviceCommand, queueDeviceCommand } from "@/lib/store";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  const record = await getDeviceCommand();
  return NextResponse.json({ success: true, ...record });
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  const type = typeof body === "object" && body !== null ? (body as { type?: unknown }).type : undefined;
  if (!isDeviceCommandType(type)) {
    return NextResponse.json({ success: false, error: "invalid_command" }, { status: 400 });
  }

  const record = await queueDeviceCommand(createDeviceCommand(type));
  return NextResponse.json({ success: true, ...record });
}

export async function DELETE(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  const record = await clearDeviceCommand();
  return NextResponse.json({ success: true, ...record });
}
