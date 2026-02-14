import { NextResponse } from "next/server";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { startThreadRecomputeJob } from "@/lib/threadRecomputeJobs";

export async function POST(request: Request) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as
    | { accountId?: string }
    | null;
  const accountId = body?.accountId;
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(auth, accountId);
  if (access instanceof NextResponse) return access;
  const job = startThreadRecomputeJob(accountId);
  if (job.status === "failed") {
    return NextResponse.json(
      { ok: false, message: job.error || "Failed to start thread recompute." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, jobId: job.id, status: job.status }, { status: 202 });
}
