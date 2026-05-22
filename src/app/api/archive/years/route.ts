import { NextResponse } from "next/server";
import { getAvailableYears } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/archive/years
 *
 * Returns a list of years that have daily aggregate data.
 */
export async function GET() {
  const years = await getAvailableYears();
  
  return NextResponse.json({
    success: true,
    years
  });
}