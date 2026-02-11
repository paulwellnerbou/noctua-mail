import { NextResponse } from "next/server";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";
import { getThreadRecomputeJob } from "@/lib/threadRecomputeJobs";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ ok: false, message: "Missing jobId" }, { status: 400 });
  }
  const job = getThreadRecomputeJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, message: "Job not found" }, { status: 404 });
  }
  const access = await requireAccountAccessOr403(session, job.accountId);
  if (access instanceof NextResponse) {
    return NextResponse.json({ ok: false, message: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job });
}
