#!/usr/bin/env bun
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { workerRuntimeTraceFiles } from "./workerRuntimeTraceFiles";
import { workerScriptEntrypoints } from "../lib/workers/entrypoints";

const standaloneDir = path.resolve(process.cwd(), ".next", "standalone");

const requiredFiles = workerRuntimeTraceFiles.map((entry) => entry.replace(/^\.\//, ""));

const expectedScriptFiles = workerScriptEntrypoints
  .map((entry) => entry.replace(/^scripts\//, ""))
  .sort();

function fail(message: string): never {
  console.error(`[standalone-worker-check] ${message}`);
  process.exit(1);
}

if (!existsSync(standaloneDir)) {
  fail(`Missing standalone output at ${standaloneDir}. Run "bun run build" first.`);
}

const missingFiles = requiredFiles.filter((relativePath) =>
  !existsSync(path.join(standaloneDir, relativePath))
);

if (missingFiles.length > 0) {
  fail(`Missing required standalone files:\n${missingFiles.map((entry) => `- ${entry}`).join("\n")}`);
}

const scriptsDir = path.join(standaloneDir, "scripts");
if (!existsSync(scriptsDir)) {
  fail(`Missing scripts directory at ${scriptsDir}.`);
}

const actualScriptFiles = readdirSync(scriptsDir)
  .filter((entry) => existsSync(path.join(scriptsDir, entry)))
  .sort();

if (actualScriptFiles.join("\n") !== expectedScriptFiles.join("\n")) {
  fail(
    `Unexpected standalone scripts contents.\nExpected:\n${expectedScriptFiles.map((entry) => `- ${entry}`).join("\n")}\nActual:\n${actualScriptFiles.map((entry) => `- ${entry}`).join("\n")}`
  );
}

console.log("[standalone-worker-check] Verified worker runtime files in .next/standalone.");
