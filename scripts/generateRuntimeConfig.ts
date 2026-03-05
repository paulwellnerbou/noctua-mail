import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_TITLE = "Noctua Mail";
const envLabel = (process.env.APP_ENV_LABEL ?? "").trim();
const appTitle = envLabel ? `${BASE_TITLE} (${envLabel})` : BASE_TITLE;

const runtimeConfig = {
  appTitle,
  appEnvironmentLabel: envLabel
};
const runtimeConfigJson = JSON.stringify(runtimeConfig, null, 2).replace(/\n/g, "\n  ");

const fileContent =
  "(function () {\n" +
  `  var config = ${runtimeConfigJson};\n` +
  "  window.__NOCTUA_RUNTIME_CONFIG__ = config;\n" +
  "  if (config.appTitle) {\n" +
  "    document.title = config.appTitle;\n" +
  "  }\n" +
  "})();\n";

const outputPath = resolve(process.cwd(), "public/runtime-config.js");
writeFileSync(outputPath, fileContent, "utf8");

console.log(
  `[runtime-config] wrote ${outputPath} (title: "${appTitle}", label: "${envLabel || "<empty>"}")`
);
