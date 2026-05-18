import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export async function DELETE(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  return NextResponse.json(
    {
      success: false,
      error: "telemetry_history_delete_disabled",
      message: "Events are derived from telemetry history; deleting them would erase trend data."
    },
    { status: 405 }
  );
}
