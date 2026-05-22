import { NextRequest, NextResponse } from "next/server";
import { getRecentTelemetry } from "@/lib/store";

export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=0, must-revalidate"
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const raw = parseInt(searchParams.get("limit") ?? "200", 10);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 200;
  const history = await getRecentTelemetry(limit);

  // ETag = newest receivedAt + count. Cheap and accurate: any new ingest
  // changes the newest timestamp, and any cap shift changes the count.
  const newest = history[0]?.receivedAt ?? "empty";
  const etag = `"${newest}-${history.length}"`;

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, ...CACHE_HEADERS }
    });
  }

  return NextResponse.json(
    { success: true, history },
    { headers: { ETag: etag, ...CACHE_HEADERS } }
  );
}
