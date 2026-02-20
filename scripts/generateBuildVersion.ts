#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getBuildVersionLabel } from "../lib/buildVersion";
import { getBuildVersionFilePath } from "../lib/buildVersionFile";

const filePath = getBuildVersionFilePath();
const buildVersionLabel = getBuildVersionLabel();
const payload = {
  ok: true,
  buildVersionLabel
};

await mkdir(dirname(filePath), { recursive: true });
await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${filePath} (${buildVersionLabel || "empty"})`);
