import { NextRequest, NextResponse } from "next/server";
import {
  getDailyAggregate,
  getDailyAggregatesForMonth,
  getDailyAggregatesForYear
} from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/archive/daily?year=2026&month=5&day=22
 *
 * Returns daily aggregate records:
 * - If day specified: single record for that date
 * - If month specified: all days in that month
 * - If only year: all days in that year
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const rawYear = parseInt(searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(rawYear)) {
    return NextResponse.json(
      { success: false, error: "missing_year" },
      { status: 400 }
    );
  }

  const year = rawYear;
  
  // Day specified → single record
  const dayParam = searchParams.get("day");
  if (dayParam) {
    const monthStr = String(searchParams.get("month") ?? "").padStart(2, "0");
    const dayStr = String(dayParam).padStart(2, "0");
    
    // If no month specified but day is, return error
    if (!searchParams.has("month")) {
      return NextResponse.json(
        { success: false, error: "missing_month" },
        { status: 400 }
      );
    }

    const dateStr = `${year}-${monthStr}-${dayStr}`;
    const record = await getDailyAggregate(dateStr);
    
    if (!record) {
      return NextResponse.json({
        success: true,
        data: null
      });
    }

    return NextResponse.json({ success: true, data: [record] });
  }
  
  // Month specified → all days in month
  const rawMonth = parseInt(searchParams.get("month") ?? "", 10);
  if (Number.isFinite(rawMonth)) {
    const records = await getDailyAggregatesForMonth(year, rawMonth);
    
    return NextResponse.json({
      success: true,
      data: records.sort((a, b) => a.date.localeCompare(b.date))
    });
  }
  
  // Year only → all days in year
  const records = await getDailyAggregatesForYear(year);

  return NextResponse.json({
    success: true,
    data: records.sort((a, b) => a.date.localeCompare(b.date))
  });
}