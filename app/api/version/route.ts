import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getBuildVersionLabel } from "@/lib/buildVersion";
import { getBuildVersionFilePath } from "@/lib/buildVersionFile";

export const dynamic = "force-dynamic";

type BuildVersionPayload = {
  ok: boolean;
  buildVersionLabel: string;
};

const readBuildVersionFile = async (): Promise<BuildVersionPayload | null> => {
  try {
    const filePath = getBuildVersionFilePath();
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BuildVersionPayload> | null;
    if (!parsed || typeof parsed.buildVersionLabel !== "string") return null;
    return {
      ok: true,
      buildVersionLabel: parsed.buildVersionLabel
    };
  } catch {
    return null;
  }
};

export async function GET() {
  const buildVersionPayload = await readBuildVersionFile();
  const buildVersionLabel = buildVersionPayload?.buildVersionLabel ?? getBuildVersionLabel();
  return NextResponse.json(
    {
      ok: true,
      buildVersionLabel
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
