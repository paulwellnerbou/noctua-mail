import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getSyncJob } from "@/lib/syncJobs";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ ok: false, message: "Missing jobId" }, { status: 400 });
  }
  const job = getSyncJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, message: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job });
}
