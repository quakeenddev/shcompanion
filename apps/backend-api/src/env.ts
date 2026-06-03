import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(currentDir, "../../..", ".env");

config({
  path: rootEnvPath
});

export function getBackendEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to start the backend API.");
  }

  return {
    host: process.env.BACKEND_HOST ?? "0.0.0.0",
    port: Number(process.env.BACKEND_PORT ?? "3000")
  };
}
