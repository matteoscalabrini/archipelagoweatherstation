import { NextRequest, NextResponse } from "next/server";
import { isDeviceAuthorized } from "@/lib/auth";
import { consumeDeviceCommand, getRemoteConfig } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isDeviceAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const [record, commandRecord] = await Promise.all([
    getRemoteConfig(),
    consumeDeviceCommand()
  ]);
  const command = commandRecord.command;
  return NextResponse.json(
    {
      success: true,
      ...record,
      deviceCommand: command,
      deviceCommandType: command?.type ?? "",
      deviceCommandId: command?.id ?? "",
      deviceCommandRequestedAt: command?.requestedAt ?? ""
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
