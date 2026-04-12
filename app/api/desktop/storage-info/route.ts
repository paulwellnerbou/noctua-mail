import { NextResponse } from "next/server";
import { getDataDir, getDbPath, getAttachmentsDir, getSourcesDir } from "@/lib/runtimePaths";

export async function GET() {
  if (process.env.NOCTUA_DESKTOP_MODE !== "true") {
    return NextResponse.json({ ok: false, message: "Not available" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    dataDir: getDataDir(),
    dbPath: getDbPath(),
    attachmentsDir: getAttachmentsDir(),
    sourcesDir: getSourcesDir()
  });
}
