import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { workerScriptEntrypoints } from "../lib/workers/entrypoints";

const repoRoot = process.cwd();

const IMPORT_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function toProjectRelativePath(absolutePath: string) {
  return `./${path.relative(repoRoot, absolutePath).replace(/\\/g, "/")}`;
}

function resolveLocalModule(fromFile: string, specifier: string) {
  const basePath = specifier.startsWith("@/")
    ? path.join(repoRoot, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    basePath,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs")
  ];
  return (
    candidates.find((candidate) => {
      if (!existsSync(candidate)) return false;
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) ?? null
  );
}

function listLocalImportSpecifiers(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const specifiers = new Set<string>();
  let match: RegExpExecArray | null = null;
  while ((match = IMPORT_SPECIFIER_PATTERN.exec(source)) !== null) {
    const specifier = match[1] ?? match[2] ?? "";
    if (!specifier) continue;
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("@/")) {
      specifiers.add(specifier);
    }
  }
  return Array.from(specifiers);
}

function collectFileGraph(entryFiles: string[]) {
  const visited = new Set<string>();
  const pending = entryFiles.map((file) => path.join(repoRoot, file));

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const importSpecifiers = listLocalImportSpecifiers(current);
    for (const specifier of importSpecifiers) {
      const resolved = resolveLocalModule(current, specifier);
      if (!resolved || visited.has(resolved)) continue;
      pending.push(resolved);
    }
  }

  return Array.from(visited)
    .sort()
    .map(toProjectRelativePath);
}

export function collectWorkerRuntimeTraceFiles() {
  return [...collectFileGraph([...workerScriptEntrypoints]), "./tsconfig.json"];
}

export const workerRuntimeTraceFiles = collectWorkerRuntimeTraceFiles();
