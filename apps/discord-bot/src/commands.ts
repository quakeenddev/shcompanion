import { SlashCommandBuilder } from "discord.js";

export const developmentCommands = [
  new SlashCommandBuilder()
    .setName("steam64id")
    .setDescription("Register or update your Steam64 ID.")
    .addStringOption((option) =>
      option
        .setName("steam64id")
        .setDescription("Your Steam64 ID.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("lobi-olustur")
    .setDescription("Create a Secret Hitler Companion lobby.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Lobby mode.")
        .setRequired(true)
        .addChoices(
          { name: "Training", value: "TRAINING" },
          { name: "Casual", value: "CASUAL" },
          { name: "Competitive", value: "COMPETITIVE" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("player_count")
        .setDescription("Player count.")
        .setRequired(true)
        .addChoices(
          { name: "7 players", value: 7 },
          { name: "9 players", value: 9 },
          { name: "10 players", value: 10 }
        )
    )
    .addStringOption((option) =>
      option
        .setName("scheduled_at")
        .setDescription("Game date/time, e.g. 03.06.2026-21.00.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("variant")
        .setDescription("7-player variant.")
        .setRequired(false)
        .addChoices(
          { name: "Standard", value: "STANDARD" },
          { name: "Standard Meta", value: "STANDARD_META" },
          { name: "Freeplay", value: "FREEPLAY" }
        )
    ),
  new SlashCommandBuilder()
    .setName("lobim")
    .setDescription("Reopen your active lobby controls.")
];

export const developmentCommandPayloads = developmentCommands.map((command) =>
  command.toJSON()
);
