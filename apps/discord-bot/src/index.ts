import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  type Interaction
} from "discord.js";
import { validateGameModePlayerCount, validateGameVariant } from "@shc/game-rules";
import { GameMode, GameVariant, PlayerColor } from "@shc/shared-types";
import {
  BackendClient,
  BackendError,
  BackendNetworkError,
  BackendResponseShapeError
} from "./backend-client.js";
import { loadDiscordBotEnv } from "./env.js";
import { renderLobbyComponents, renderLobbyEmbed } from "./lobby-message.js";

const env = loadDiscordBotEnv();
const backend = new BackendClient(env.botApiBaseUrl, env.botApiKey);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function parseGameMode(value: string): GameMode {
  return value as GameMode;
}

function parsePlayerColor(value: string): PlayerColor {
  return value as PlayerColor;
}

function parseGameVariant(value: string): GameVariant {
  return value as GameVariant;
}

function formatBackendError(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.message === "STEAM_ID_REQUIRED" || error.message === "COMPETITIVE_STEAM64_REQUIRED") {
      return "Competitive maclara katilmak icin once /steam64id komutuyla Steam64 ID tanitmalisin.";
    }

    if (error.message === "LOBBY_FULL") {
      return "Lobi dolu.";
    }

    if (error.message === "COLOR_TAKEN") {
      return "Bu renk zaten secilmis.";
    }

    if (error.message === "USER_ALREADY_JOINED") {
      return "Bu lobiye zaten katildin.";
    }

    if (error.message === "LOBBY_NOT_OPEN") {
      return "Bu lobi artik katilima acik degil.";
    }

    if (error.message === "SEATS_LOCKED") {
      return "Koltuklar kilitlendi. Oyun saatine 1 saatten az kaldigi icin renk secimi degistirilemez.";
    }

    if (error.message === "INVALID_GAME_VARIANT") {
      return "Secilen variant bu oyuncu sayisi/mod icin uygun degil.";
    }

    if (error.message === "LOBBY_NOT_FOUND") {
      return "Lobi bulunamadi.";
    }

    return error.message;
  }

  if (error instanceof BackendNetworkError) {
    return "Backend ile iletisim kurulamadi. Lutfen biraz sonra tekrar dene.";
  }

  if (error instanceof BackendResponseShapeError) {
    return "Backend yaniti beklenen formatta degil. Lutfen tekrar dene.";
  }

  return "Backend ile iletisim kurulamadi. Lutfen biraz sonra tekrar dene.";
}

function logInteractionError(
  label: string,
  context: Record<string, unknown>,
  error: unknown
): void {
  console.error(label, {
    ...context,
    backendStatus: error instanceof BackendError ? error.statusCode : undefined,
    backendResponseBody: error instanceof BackendError ? error.responseBody : undefined,
    stack: error instanceof Error ? error.stack : undefined,
    error
  });
}

function logMissingOption(commandName: string, optionName: string): void {
  console.warn(
    `Discord command option mismatch: /${commandName} is missing required option "${optionName}". Re-register guild commands.`
  );
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "steam64id") {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      const steam64Id = interaction.options.getString("steam64id", false);

      if (!steam64Id) {
        logMissingOption("steam64id", "steam64id");
        await interaction.editReply({
          content: "Steam64 ID secenegi eksik gorunuyor. Lutfen slash komutlarini yeniden kaydedin."
        });
        return;
      }

      try {
        await backend.registerSteam64Id({
          discordId: interaction.user.id,
          steam64Id,
          username: interaction.user.username
        });

        await interaction.editReply({
          content: "Steam64 ID kaydedildi."
        });
      } catch (error) {
        await interaction.editReply({
          content: formatBackendError(error)
        });
      }

      return;
    }

    if (interaction.commandName === "lobi-olustur") {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "Bu komut sadece sunucu icinde kullanilabilir.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const modeInput = interaction.options.getString("mode", false);
      const playerCount = interaction.options.getInteger("player_count", false);
      const variantInput = interaction.options.getString("variant", false);
      const scheduledAt = interaction.options.getString("scheduled_at", false);

      if (!modeInput) {
        logMissingOption("lobi-olustur", "mode");
        await interaction.reply({
          content: "Lobi modu secenegi eksik gorunuyor. Lutfen slash komutlarini yeniden kaydedin.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!playerCount) {
        logMissingOption("lobi-olustur", "player_count");
        await interaction.reply({
          content: "Oyuncu sayisi secenegi eksik gorunuyor. Lutfen slash komutlarini yeniden kaydedin.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!scheduledAt) {
        logMissingOption("lobi-olustur", "scheduled_at");
        await interaction.reply({
          content: "Oyun tarih/saat secenegi eksik gorunuyor. Lutfen slash komutlarini yeniden kaydedin.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const mode = parseGameMode(modeInput);
      const variant = variantInput ? parseGameVariant(variantInput) : undefined;

      if (!validateGameModePlayerCount(mode, playerCount)) {
        await interaction.reply({
          content: "Secilen mod ve oyuncu sayisi uyumlu degil.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (variant && !validateGameVariant(mode, playerCount, variant)) {
        await interaction.reply({
          content: "Secilen variant sadece uygun 7 kisilik oyunlarda kullanilabilir.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferReply();

      try {
        const lobby = await backend.createLobby({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          createdByDiscordId: interaction.user.id,
          mode,
          playerCount,
          variant,
          scheduledAt
        });

        await interaction.editReply({
          embeds: [renderLobbyEmbed(lobby)],
          components: renderLobbyComponents(lobby, true)
        });
      } catch (error) {
        logInteractionError("Lobby creation failed", {
          commandName: interaction.commandName,
          userId: interaction.user.id,
          mode,
          playerCount,
          variant,
          scheduledAt
        }, error);
        await interaction.editReply({
          content: formatBackendError(error),
          embeds: [],
          components: []
        });
      }
    }

    return;
  }

  if (!interaction.isButton()) {
    return;
  }

  const [action, lobbyId, value] = interaction.customId.split(":");

  if (action === "lobby-join") {
    await interaction.deferUpdate();
    const selectedColor = parsePlayerColor(value);

    try {
      await backend.joinLobby({
        lobbyId,
        discordId: interaction.user.id,
        username: interaction.user.username,
        selectedColor
      });
    } catch (error) {
      logInteractionError("Lobby color selection backend request failed", {
        customId: interaction.customId,
        lobbyId,
        selectedColor,
        userId: interaction.user.id
      }, error);

      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      const lobby = await backend.getLobby(lobbyId);

      await interaction.message.edit({
        embeds: [renderLobbyEmbed(lobby)],
        components: renderLobbyComponents(lobby, interaction.user.id === lobby.createdByDiscordId)
      });

      await interaction.followUp({
        content: "Renk secimin kaydedildi.",
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      logInteractionError("Lobby color selection post-save update failed", {
        customId: interaction.customId,
        lobbyId,
        selectedColor,
        userId: interaction.user.id
      }, error);

      await interaction.followUp({
        content:
          "Renk kaydedildi ama lobi mesaji guncellenirken hata olustu. Lutfen tekrar deneyin veya hosttan mesaji yenilemesini isteyin.",
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-create-match") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Sadece lobi sahibi match code olusturabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const matchCode = await backend.createMatch(lobbyId);
      const freshLobby = await backend.getLobby(lobbyId);

      await interaction.message.edit({
        content: `Match Code: ${matchCode}. Bu kodu ileride Tabletop Match Control Panel'e girecegiz.`,
        embeds: [renderLobbyEmbed(freshLobby, matchCode)],
        components: renderLobbyComponents(freshLobby, true)
      });
    } catch (error) {
      logInteractionError("Match creation failed", {
        customId: interaction.customId,
        lobbyId,
        userId: interaction.user.id
      }, error);
      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }
  }
}

client.once("clientReady", (readyClient) => {
  console.log(`Discord bot ready as ${readyClient.user.tag}`);
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction).catch((error: unknown) => {
    console.error("Interaction handler failed:", error);
  });
});

await client.login(env.DISCORD_TOKEN);
