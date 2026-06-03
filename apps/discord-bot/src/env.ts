import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(currentDir, "../../..", ".env");

config({
  path: rootEnvPath
});

const requiredEnvNames = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID"
] as const;

type RequiredEnvName = (typeof requiredEnvNames)[number];

type DiscordBotEnv = Record<RequiredEnvName, string> & {
  botApiBaseUrl: string;
  botApiKey?: string;
};

function readRequiredEnv(name: RequiredEnvName): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required. Add it to .env before starting the Discord bot.`);
  }

  return value;
}

export function loadDiscordBotEnv(): DiscordBotEnv {
  return {
    DISCORD_TOKEN: readRequiredEnv("DISCORD_TOKEN"),
    DISCORD_CLIENT_ID: readRequiredEnv("DISCORD_CLIENT_ID"),
    DISCORD_GUILD_ID: readRequiredEnv("DISCORD_GUILD_ID"),
    botApiBaseUrl: process.env.BOT_API_BASE_URL ?? "http://localhost:3000/api/v1",
    botApiKey: process.env.BOT_API_KEY
  };
}
