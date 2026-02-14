import { NextResponse } from "next/server";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { startSyncJob } from "@/lib/syncJobs";
import type { SyncPayload } from "@/lib/syncOperation";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as SyncPayload;

  if (!payload?.accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, payload.accountId);
  if (access instanceof NextResponse) return access;

  const job = startSyncJob(payload, clientId);
  if (job.status === "failed") {
    return NextResponse.json(
      { ok: false, message: job.error || "Failed to start sync job." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, jobId: job.id, status: job.status },
    { status: 202 }
  );
}
