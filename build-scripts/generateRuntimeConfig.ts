import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function readAppEnvLabelFromFile(envFilePath: string) {
  if (!envFilePath || !existsSync(envFilePath)) return "";
  const content = readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^APP_ENV_LABEL\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[1]?.trim() ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1).trim();
    }
    return value;
  }
  return "";
}

const envFilePath = process.env.ENV_FILE?.trim() || ".env.local";
const envLabel = (process.env.APP_ENV_LABEL ?? readAppEnvLabelFromFile(envFilePath) ?? "").trim();

const runtimeConfig = {
  appEnvironmentLabel: envLabel
};
const runtimeConfigJson = JSON.stringify(runtimeConfig, null, 2).replace(/\n/g, "\n  ");

const fileContent =
  "(function () {\n" +
  `  var config = ${runtimeConfigJson};\n` +
  "  window.__NOCTUA_RUNTIME_CONFIG__ = config;\n" +
  "})();\n";

const outputPath = resolve(process.cwd(), "public/runtime-config.js");
writeFileSync(outputPath, fileContent, "utf8");

console.log(
  `[runtime-config] wrote ${outputPath} (label: "${envLabel || "<empty>"}")`
);
