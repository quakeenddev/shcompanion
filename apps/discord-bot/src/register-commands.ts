import { REST, Routes } from "discord.js";
import { developmentCommandPayloads } from "./commands.js";
import { loadDiscordBotEnv } from "./env.js";

const env = loadDiscordBotEnv();

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
  {
    body: developmentCommandPayloads
  }
);

console.log(`Registered ${developmentCommandPayloads.length} development guild commands.`);
