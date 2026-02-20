import { resolve } from "node:path";

export const BUILD_VERSION_FILE_NAME = "build-version.json";

export const getBuildVersionFilePath = (cwd: string = process.cwd()) =>
  resolve(cwd, "public", BUILD_VERSION_FILE_NAME);
