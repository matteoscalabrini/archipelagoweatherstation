import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordConfigured,
  createAdminSession,
  setAdminSessionCookie,
  verifyAdminPassword
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!adminPasswordConfigured()) {
    return NextResponse.json(
      { success: false, error: "admin_password_not_configured" },
      { status: 503 }
    );
  }

  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  setAdminSessionCookie(response, createAdminSession());
  return response;
}
