import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@shc/shared-types": resolve(repoRoot, "packages/shared-types/src/index.ts")
    }
  }
});
