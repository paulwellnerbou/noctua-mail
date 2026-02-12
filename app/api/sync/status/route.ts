import { NextResponse } from "next/server";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";
import { getSyncJob } from "@/lib/syncJobs";

export async function GET(request: Request) {
  const clientId = request.headers.get("x-noctua-client") ?? "";
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const logStatus = (outcome: string, extra?: Record<string, unknown>) => {
    console.info(
      `[sync-status] ${JSON.stringify({
        outcome,
        clientId: clientId || undefined,
        jobId: jobId || undefined,
        ...extra
      })}`
    );
  };

  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) {
    logStatus("unauthorized");
    return session;
  }
  if (!jobId) {
    logStatus("missing-job-id");
    return NextResponse.json({ ok: false, message: "Missing jobId" }, { status: 400 });
  }
  const job = getSyncJob(jobId);
  if (!job) {
    logStatus("job-not-found");
    return NextResponse.json({ ok: false, message: "Job not found" }, { status: 404 });
  }
  const access = await requireAccountAccessOr403(session, job.payload.accountId);
  if (access instanceof NextResponse) {
    logStatus("forbidden", { accountId: job.payload.accountId });
    return NextResponse.json({ ok: false, message: "Job not found" }, { status: 404 });
  }
  logStatus("ok", {
    accountId: job.payload.accountId,
    status: job.status,
    pid: job.pid,
    progressPhase: job.progress?.phase,
    progressProcessed: job.progress?.processed,
    progressUpdatedAt: job.progress?.updatedAt,
    progressMessage: job.progress?.message
  });
  return NextResponse.json({ ok: true, job });
}
