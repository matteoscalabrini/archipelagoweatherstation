import { NextRequest, NextResponse } from "next/server";
import { getLatestTelemetry } from "@/lib/store";
import { emptyTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=0, must-revalidate"
};

export async function GET(request: NextRequest) {
  const latest = await getLatestTelemetry();
  // ETag is derived from receivedAt — every fresh ingest yields a new tag.
  const etag = latest?.receivedAt ? `"${latest.receivedAt}"` : `"empty"`;

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, ...CACHE_HEADERS }
    });
  }

  return NextResponse.json(
    {
      success: true,
      telemetry: latest ?? emptyTelemetry(),
      connected: Boolean(latest)
    },
    { headers: { ETag: etag, ...CACHE_HEADERS } }
  );
}
