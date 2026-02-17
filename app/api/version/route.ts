import { NextResponse } from "next/server";
import { getBuildVersionLabel } from "@/lib/buildVersion";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      buildVersionLabel: getBuildVersionLabel()
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
