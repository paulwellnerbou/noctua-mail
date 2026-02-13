import { randomUUID } from "crypto";
import { parseSyncWorkerLine } from "@/lib/syncWorkerProtocol";
import type { SyncOperationProgress, SyncOperationResult, SyncPayload } from "@/lib/syncOperation";

type SyncJobStatus = "queued" | "running" | "done" | "failed";

export type SyncJob = {
  id: string;
  payload: SyncPayload;
  status: SyncJobStatus;
  startedAt: number;
  queuedAt?: number;
  finishedAt?: number;
  error?: string;
  pid?: number;
  result?: SyncOperationResult;
  progress?: SyncOperationProgress;
};

type AccountSyncState = {
  runningJobId: string;
  queuedJobId?: string;
  queuedClientId?: string;
};

type SyncJobsRuntimeState = {
  jobs: Map<string, SyncJob>;
  accountStates: Map<string, AccountSyncState>;
};

const runtimeState = (
  globalThis as typeof globalThis & {
    __noctuaSyncJobsState?: SyncJobsRuntimeState;
  }
);
if (!runtimeState.__noctuaSyncJobsState) {
  runtimeState.__noctuaSyncJobsState = {
    jobs: new Map<string, SyncJob>(),
    accountStates: new Map<string, AccountSyncState>()
  };
}

const jobs = runtimeState.__noctuaSyncJobsState.jobs;
const accountStates = runtimeState.__noctuaSyncJobsState.accountStates;
const JOB_TTL_MS = 1000 * 60 * 30;
const SYNC_PROGRESS_STALL_MS = Number.parseInt(
  process.env.SYNC_PROGRESS_STALL_MS ?? "",
  10
) || 1000 * 12;

const MODE_PRIORITY: Record<"new" | "recent" | "full", number> = {
  new: 1,
  recent: 2,
  full: 3
};

const scheduleCleanup = (jobId: string) => {
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
};

function getSyncMode(payload: SyncPayload): "full" | "recent" | "new" {
  return payload.mode ?? (payload.fullSync ? "full" : "recent");
}

function normalizeSyncPayload(payload: SyncPayload): SyncPayload {
  const mode = getSyncMode(payload);
  const recategorizeFolder =
    Boolean(payload.recategorizeFolder) && typeof payload.folderId === "string" && payload.folderId.length > 0;
  return {
    accountId: payload.accountId,
    folderId: payload.folderId,
    mode,
    fullSync: mode === "full",
    recategorizeFolder
  };
}

function isSameSyncIntent(a: SyncPayload, b: SyncPayload) {
  const left = normalizeSyncPayload(a);
  const right = normalizeSyncPayload(b);
  return (
    left.accountId === right.accountId &&
    (left.folderId ?? "") === (right.folderId ?? "") &&
    left.mode === right.mode &&
    Boolean(left.recategorizeFolder) === Boolean(right.recategorizeFolder)
  );
}

function coalesceSyncPayload(existing: SyncPayload, incoming: SyncPayload): SyncPayload {
  const normalizedExisting = normalizeSyncPayload(existing);
  const normalizedIncoming = normalizeSyncPayload(incoming);
  const existingMode = normalizedExisting.mode ?? "recent";
  const incomingMode = normalizedIncoming.mode ?? "recent";
  const mode = MODE_PRIORITY[incomingMode] >= MODE_PRIORITY[existingMode] ? incomingMode : existingMode;
  const folderId =
    normalizedExisting.folderId &&
    normalizedIncoming.folderId &&
    normalizedExisting.folderId === normalizedIncoming.folderId
      ? normalizedExisting.folderId
      : undefined;

  return {
    accountId: normalizedExisting.accountId,
    folderId,
    mode,
    fullSync: mode === "full",
    recategorizeFolder:
      Boolean(normalizedExisting.recategorizeFolder || normalizedIncoming.recategorizeFolder) &&
      Boolean(folderId)
  };
}

function createRunningJob(payload: SyncPayload): SyncJob {
  const mode = getSyncMode(payload);
  return {
    id: randomUUID(),
    payload,
    status: "running",
    startedAt: Date.now(),
    progress: {
      accountId: payload.accountId,
      folderId: payload.folderId,
      mailboxPath: payload.folderId ? payload.folderId.replace(`${payload.accountId}:`, "") : "INBOX",
      mode,
      phase: "starting",
      processed: 0,
      message: "Sync starting.",
      updatedAt: Date.now()
    }
  };
}

function createQueuedJob(payload: SyncPayload): SyncJob {
  const now = Date.now();
  return {
    id: randomUUID(),
    payload,
    status: "queued",
    startedAt: now,
    queuedAt: now
  };
}

function parseSyncResultFromStdout(stdoutText: string): SyncOperationResult | null {
  const trimmed = stdoutText.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as SyncOperationResult;
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]) as SyncOperationResult;
      } catch {
        // continue scanning older lines
      }
    }
  }
  return null;
}

function calculatePercent(processed: number, estimatedTotal?: number) {
  if (typeof estimatedTotal !== "number" || !Number.isFinite(estimatedTotal)) return undefined;
  if (estimatedTotal <= 0) return 100;
  return Math.min(100, Math.round((Math.max(0, processed) / estimatedTotal) * 1000) / 10);
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    return false;
  }
}

function buildSyncProgressFromJob(
  job: SyncJob,
  overrides: Partial<SyncOperationProgress>
): SyncOperationProgress {
  const base = job.progress;
  const mode = base?.mode ?? getSyncMode(job.payload);
  const folderId = base?.folderId ?? job.payload.folderId;
  const mailboxPath =
    base?.mailboxPath ??
    (job.payload.folderId
      ? job.payload.folderId.replace(`${job.payload.accountId}:`, "")
      : "INBOX");
  const processed = overrides.processed ?? base?.processed ?? 0;
  const estimatedTotal = overrides.estimatedTotal ?? base?.estimatedTotal;
  const computedPercent =
    overrides.percent !== undefined
      ? overrides.percent
      : calculatePercent(processed, estimatedTotal) ?? base?.percent;

  return {
    accountId: base?.accountId ?? job.payload.accountId,
    folderId,
    mailboxPath,
    mode,
    phase: overrides.phase ?? base?.phase ?? "starting",
    processed,
    batchNumber: overrides.batchNumber ?? base?.batchNumber,
    batchSize: overrides.batchSize ?? base?.batchSize,
    estimatedTotal,
    percent: computedPercent,
    message: overrides.message ?? base?.message,
    updatedAt: overrides.updatedAt ?? Date.now()
  };
}

function markJobFailed(job: SyncJob, error: string) {
  job.status = "failed";
  job.finishedAt = Date.now();
  job.error = error;
  job.progress = buildSyncProgressFromJob(job, {
    phase: "failed",
    message: error,
    updatedAt: Date.now()
  });
}

async function readPipedOutput(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine?: (line: string) => void
) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let lineBuffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      output += chunk;
      lineBuffer += chunk;
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        onLine?.(line);
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        newlineIndex = lineBuffer.indexOf("\n");
      }
    }
    const tail = decoder.decode();
    if (tail) {
      output += tail;
      lineBuffer += tail;
    }
    if (lineBuffer) {
      onLine?.(lineBuffer.replace(/\r$/, ""));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore release failures
    }
  }
  return output;
}

function handleCompletedRunningJob(job: SyncJob) {
  const accountId = job.payload.accountId;
  const state = accountStates.get(accountId);
  if (!state) return;
  if (state.runningJobId !== job.id) return;
  if (!state.queuedJobId) {
    accountStates.delete(accountId);
    return;
  }

  const nextJob = jobs.get(state.queuedJobId);
  if (!nextJob) {
    accountStates.delete(accountId);
    return;
  }

  const nextClientId = state.queuedClientId;
  state.runningJobId = nextJob.id;
  state.queuedJobId = undefined;
  state.queuedClientId = undefined;

  nextJob.status = "running";
  nextJob.startedAt = Date.now();
  nextJob.finishedAt = undefined;
  nextJob.error = undefined;
  nextJob.pid = undefined;
  nextJob.result = undefined;
  nextJob.progress = buildSyncProgressFromJob(nextJob, {
    phase: "starting",
    processed: 0,
    batchNumber: undefined,
    batchSize: undefined,
    estimatedTotal: undefined,
    percent: undefined,
    message: "Sync starting."
  });

  spawnSyncWorker(nextJob, nextClientId);
}

function spawnSyncWorker(job: SyncJob, clientId?: string) {
  try {
    const bun = (globalThis as typeof globalThis & { Bun?: any }).Bun;
    if (!bun?.spawn) {
      throw new Error("Bun runtime is required to spawn a sync worker.");
    }
    const childPayload = JSON.stringify({
      ...job.payload,
      clientId
    });
    const child = bun.spawn(
      ["bun", "run", "scripts/runSyncJob.ts", childPayload],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    job.pid = child.pid;
    console.info(
      `[sync] worker started ${JSON.stringify({
        jobId: job.id,
        accountId: job.payload.accountId,
        folderId: job.payload.folderId,
        mode: getSyncMode(job.payload),
        pid: job.pid,
        configuredStallMs: SYNC_PROGRESS_STALL_MS
      })}`
    );

    void (async () => {
      let streamedResult: SyncOperationResult | null = null;
      const stdoutTextPromise = readPipedOutput(child.stdout, (line) => {
        const parsed = parseSyncWorkerLine(line);
        if (!parsed) return;
        if (parsed.kind === "progress") {
          job.progress = parsed.progress;
          const percent =
            parsed.progress.percent ??
            calculatePercent(parsed.progress.processed, parsed.progress.estimatedTotal);
          const percentLabel = typeof percent === "number" ? `${percent}%` : "unknown%";
          console.info(`[sync] ${percentLabel} progress on ${JSON.stringify({
            jobId: job.id,
            accountId: parsed.progress.accountId,
            folderId: parsed.progress.folderId,
            mailboxPath: parsed.progress.mailboxPath,
            mode: parsed.progress.mode,
            phase: parsed.progress.phase,
            processed: parsed.progress.processed,
            estimatedTotal: parsed.progress.estimatedTotal,
            percent
          })}`);
          return;
        }
        streamedResult = parsed.result;
      });
      const stderrTextPromise = readPipedOutput(child.stderr);
      try {
        const [exitCode, stdoutText, stderrRaw] = await Promise.all([
          child.exited,
          stdoutTextPromise,
          stderrTextPromise
        ]);
        if (job.status !== "running") {
          return;
        }
        const stderrText = stderrRaw.trim();
        if (exitCode === 0) {
          job.status = "done";
          job.finishedAt = Date.now();
          job.result = streamedResult ?? parseSyncResultFromStdout(stdoutText) ?? { count: 0 };
          job.progress = buildSyncProgressFromJob(job, {
            phase: "done",
            processed: job.result.count,
            message: "Sync completed.",
            updatedAt: Date.now()
          });
        } else {
          const errorMessage = stderrText || `Sync worker exited with code ${exitCode}`;
          markJobFailed(job, errorMessage);
          console.error(
            `[sync] worker failed ${JSON.stringify({
              jobId: job.id,
              accountId: job.payload.accountId,
              folderId: job.payload.folderId,
              mode: getSyncMode(job.payload),
              exitCode,
              error: errorMessage
            })}`
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Sync worker monitor failed unexpectedly.";
        markJobFailed(job, errorMessage);
        console.error(
          `[sync] worker monitor failed ${JSON.stringify({
            jobId: job.id,
            accountId: job.payload.accountId,
            folderId: job.payload.folderId,
            mode: getSyncMode(job.payload),
            error: errorMessage
          })}`
        );
      } finally {
        if (job.status === "running") {
          markJobFailed(job, "Sync worker monitor completed while job was still running.");
        }
        scheduleCleanup(job.id);
        handleCompletedRunningJob(job);
      }
    })();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to start sync worker";
    markJobFailed(job, errorMessage);
    console.error(
      `[sync] failed to start worker ${JSON.stringify({
        jobId: job.id,
        accountId: job.payload.accountId,
        folderId: job.payload.folderId,
        mode: getSyncMode(job.payload),
        error: errorMessage
      })}`
    );
    scheduleCleanup(job.id);
    handleCompletedRunningJob(job);
  }
}

export function getSyncJob(jobId: string) {
  const job = jobs.get(jobId) ?? null;
  if (!job) return null;
  if (job.status === "running" && typeof job.pid === "number" && !isProcessAlive(job.pid)) {
    markJobFailed(job, "Sync worker process is no longer running.");
    scheduleCleanup(job.id);
    handleCompletedRunningJob(job);
  }
  return job;
}

export function startSyncJob(payload: SyncPayload, clientId?: string) {
  const normalizedPayload = normalizeSyncPayload(payload);
  const accountId = normalizedPayload.accountId;
  const existingState = accountStates.get(accountId);

  if (!existingState) {
    const job = createRunningJob(normalizedPayload);
    jobs.set(job.id, job);
    accountStates.set(accountId, { runningJobId: job.id });
    spawnSyncWorker(job, clientId);
    return job;
  }

  const runningJob = jobs.get(existingState.runningJobId);
  if (!runningJob || runningJob.status !== "running") {
    accountStates.delete(accountId);
    return startSyncJob(normalizedPayload, clientId);
  }
  if (typeof runningJob.pid === "number" && !isProcessAlive(runningJob.pid)) {
    markJobFailed(runningJob, "Sync worker process is no longer running.");
    scheduleCleanup(runningJob.id);
    accountStates.delete(accountId);
    return startSyncJob(normalizedPayload, clientId);
  }

  if (!existingState.queuedJobId && isSameSyncIntent(runningJob.payload, normalizedPayload)) {
    return runningJob;
  }

  if (existingState.queuedJobId) {
    const queuedJob = jobs.get(existingState.queuedJobId);
    if (queuedJob) {
      if (!isSameSyncIntent(queuedJob.payload, normalizedPayload)) {
        queuedJob.payload = coalesceSyncPayload(queuedJob.payload, normalizedPayload);
      }
      if (clientId) {
        existingState.queuedClientId = clientId;
      }
      return queuedJob;
    }
    existingState.queuedJobId = undefined;
    existingState.queuedClientId = undefined;
  }

  const queuedJob = createQueuedJob(normalizedPayload);
  jobs.set(queuedJob.id, queuedJob);
  existingState.queuedJobId = queuedJob.id;
  existingState.queuedClientId = clientId;
  return queuedJob;
}
