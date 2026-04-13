#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { workerScriptPaths } from "../lib/workers/entrypoints";

const repoRoot = process.cwd();
const imageTag = `noctua-mail-worker-verify:${randomUUID()}`;

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type WorkerCheck = {
  name: string;
  command: string[];
  expectedOutput: string;
};

const workerChecks: WorkerCheck[] = [
  {
    name: "sync worker",
    command: ["--entrypoint", "bun", imageTag, "--bun", "run", workerScriptPaths.sync, "{}"],
    expectedOutput: "Missing accountId in sync payload."
  },
  {
    name: "thread recompute worker",
    command: ["--entrypoint", "bun", imageTag, "--bun", "run", workerScriptPaths.recomputeThreads],
    expectedOutput: "Missing accountId argument."
  },
  {
    name: "category recompute worker",
    command: ["--entrypoint", "bun", imageTag, "--bun", "run", workerScriptPaths.recomputeCategories],
    expectedOutput: "Missing accountId argument."
  }
];

function runDockerCommand(args: string[]): CommandResult {
  const result = spawnSync("docker", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1
  };
}

function fail(message: string, details?: string): never {
  console.error(`[docker-worker-check] ${message}`);
  if (details) {
    console.error(details.trim());
  }
  cleanupImage();
  process.exit(1);
}

function cleanupImage() {
  runDockerCommand(["image", "rm", "-f", imageTag]);
}

const dockerInfoResult = runDockerCommand(["info"]);
if (dockerInfoResult.exitCode !== 0) {
  fail(
    "Docker daemon is unavailable. Start Docker and rerun \"bun run test:docker-workers\".",
    dockerInfoResult.stderr || dockerInfoResult.stdout
  );
}

const buildResult = runDockerCommand(["build", "-t", imageTag, "."]);
if (buildResult.exitCode !== 0) {
  fail("Docker build failed.", `${buildResult.stdout}\n${buildResult.stderr}`);
}

for (const check of workerChecks) {
  const result = runDockerCommand(["run", "--rm", ...check.command]);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode === 0) {
    fail(
      `${check.name} unexpectedly exited successfully.`,
      combinedOutput
    );
  }
  if (!combinedOutput.includes(check.expectedOutput)) {
    fail(
      `${check.name} did not emit the expected runtime validation message.`,
      combinedOutput
    );
  }
  if (combinedOutput.includes('Module not found "scripts/')) {
    fail(
      `${check.name} still failed with a module resolution error.`,
      combinedOutput
    );
  }
}

cleanupImage();
console.log("[docker-worker-check] Verified worker entrypoints resolve inside the Docker runtime image.");
