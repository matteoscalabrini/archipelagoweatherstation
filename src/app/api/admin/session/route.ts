import { NextRequest, NextResponse } from "next/server";
import { adminPasswordConfigured, isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    configured: adminPasswordConfigured(),
    authenticated: isAdminRequest(request)
  });
}
