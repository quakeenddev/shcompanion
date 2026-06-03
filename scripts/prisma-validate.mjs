import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/secret_hitler_companion?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

const prismaBin = process.platform === "win32"
  ? join("node_modules", ".bin", "prisma.CMD")
  : join("node_modules", ".bin", "prisma");

const command = existsSync(prismaBin) ? prismaBin : "prisma";

const result = spawnSync(
  command,
  ["validate", "--schema", "prisma/schema.prisma"],
  {
    shell: true,
    stdio: "inherit",
    env: process.env
  }
);

process.exit(result.status ?? 1);
