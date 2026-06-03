import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type Message
} from "discord.js";
import { validateGameModePlayerCount, validateGameVariant } from "@shc/game-rules";
import { GameMode, GameVariant, LobbyParticipantStatus } from "@shc/shared-types";
import {
  BackendClient,
  BackendError,
  BackendNetworkError,
  BackendResponseShapeError,
  type CompactLobbyView,
  type LobbyView
} from "./backend-client.js";
import { loadDiscordBotEnv } from "./env.js";
import { renderLobbyComponents, renderLobbyEmbed } from "./lobby-message.js";

const env = loadDiscordBotEnv();
const backend = new BackendClient(env.botApiBaseUrl, env.botApiKey);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

type SendableChannel = {
  send(options: Parameters<Message["edit"]>[0]): Promise<Message>;
};

type MessageFetchableChannel = {
  messages: {
    fetch(messageId: string): Promise<Message>;
  };
};

type LobbyMessageUpdateResult =
  | { ok: true; action: "edited" | "recreated" | "fallback-edited" }
  | { ok: false; reason: string };

function parseGameMode(value: string): GameMode {
  return value as GameMode;
}

function parseGameVariant(value: string): GameVariant {
  return value as GameVariant;
}

function isSendableChannel(value: unknown): value is SendableChannel {
  return typeof value === "object" && value !== null && "send" in value;
}

function isMessageFetchableChannel(value: unknown): value is MessageFetchableChannel {
  return typeof value === "object" && value !== null && "messages" in value;
}

function isEphemeralMessage(message: Message): boolean {
  return message.flags.has(MessageFlags.Ephemeral);
}

function isValidScheduleInput(value: string): boolean {
  return /^\d{2}\.\d{2}\.\d{4}-\d{2}\.\d{2}$/.test(value);
}

function formatBackendError(error: unknown): string {
  if (error instanceof BackendError) {
    const messages: Record<string, string> = {
      STEAM_ID_REQUIRED: "Competitive maclara katilmak icin once /steam64id komutuyla Steam64 ID tanitmalisin.",
      COMPETITIVE_STEAM64_REQUIRED: "Competitive maclara katilmak icin once /steam64id komutuyla Steam64 ID tanitmalisin.",
      LOBBY_FULL: "Lobi dolu.",
      LOBBY_NOT_FULL: "Fesih oylamasi veya oyun baslatma islemi icin lobi dolu olmali.",
      USER_ALREADY_JOINED: "Bu lobiye zaten katildin.",
      LOBBY_NOT_OPEN: "Bu lobi artik katilima acik degil.",
      SEATS_LOCKED: "Koltuklar kilitlendi.",
      INVALID_GAME_VARIANT: "Secilen variant bu oyuncu sayisi/mod icin uygun degil.",
      LOBBY_NOT_FOUND: "Lobi bulunamadi.",
      NOT_IN_LOBBY: "Bu lobide degilsin.",
      HOST_CANNOT_LEAVE: "Host lobiden ayrilamaz. Lobiyi kapatmak icin Oyunu Boz butonunu kullan.",
      HOST_TRANSFER_REQUIRED: "Host lobiden ayrilmadan once hostlugu baska bir oyuncuya devretmeli.",
      HOST_TRANSFER_TARGET_SELF: "Hostlugu kendine devredemezsin.",
      LOBBY_LOCKED: "Bu lobi artik kilitlendigi icin cikis yapilamaz.",
      HOST_ONLY: "Bu islemi sadece host yapabilir.",
      INVALID_SCHEDULE_FORMAT: "Tarih/saat formati hatali. Dogru format: gun.ay.yil-00.00 orn. 03.06.2026-21.00",
      CANNOT_CANCEL_WITHIN_ONE_HOUR: "Oyuna 1 saatten az kaldigi icin dolu lobi bozulamaz.",
      LOBBY_ALREADY_CANCELLED: "Bu lobi zaten bozulmus.",
      LOBBY_ALREADY_EXPIRED: "Bu lobi zaten suresi doldugu icin kapanmis.",
      LOBBY_ALREADY_DISSOLVED: "Bu lobi zaten oyuncu oylamasiyla feshedilmis.",
      LOBBY_ALREADY_IN_PROGRESS: "Bu lobi icin oyun zaten baslatilmis.",
      LOBBY_ALREADY_STARTED: "Bu lobi icin oyun zaten baslatilmis.",
      LOBBY_ALREADY_CANCELLED_MISSING_PLAYERS: "Bu lobi eksik katilim nedeniyle zaten kapatilmis.",
      DISSOLUTION_VOTE_ALREADY_OPEN: "Bu lobi icin zaten acik bir fesih oylamasi var.",
      NO_OPEN_DISSOLUTION_VOTE: "Bu lobi icin acik fesih oylamasi yok.",
      GAME_ALREADY_STARTED: "Oyun baslatildigi icin fesih oylamasi acilamaz.",
      DISSOLUTION_VOTE_OPEN: "Acik fesih oylamasi varken oyun baslatilamaz.",
      START_TOO_EARLY: "Oyun baslatma kilidi yalnizca oyun saatine 15 dakika kala acilir.",
      START_TOO_LATE: "Oyun baslatma suresi gecti. Lutfen lobiyi yeniden planlayin veya host/mod destegi alin.",
      LOBBY_NOT_SCHEDULED: "Oyuncu yok isaretlemesi icin lobi tarihi/saatinin belirlenmis olmasi gerekir.",
      TOO_EARLY_FOR_NO_SHOW: "Oyuncu yok isaretlemesi oyun saatine 15 dakika kala acilir.",
      TARGET_NOT_IN_LOBBY: "Secilen oyuncu bu lobide degil.",
      TOO_EARLY_FOR_MISSING_CANCEL: "Eksik katilim nedeniyle oyunu dagitma secenegi oyun saati geldiginde acilir.",
      NO_MISSING_PLAYERS_SELECTED: "Lutfen gelmeyen en az bir oyuncu sec.",
      MATCH_ALREADY_CREATED: "Bu lobi icin match code zaten olusturulmus.",
      MODERATOR_ONLY: "Bu komutu sadece moderatorler kullanabilir.",
      USER_NOT_IN_ACTIVE_LOBBY: "Bu kullanicinin aktif lobisi yok.",
      LOBBY_ALREADY_CLOSED: "Bu lobi zaten kapali.",
      CANNOT_MODIFY_IN_PROGRESS: "Oyun baslamis lobiler bu islemle degistirilemez.",
      INVALID_STATUS: "Gecersiz lobi status filtresi.",
      USER_NOT_IN_LOBBY: "Kullanici bu lobide degil.",
      ACTIVE_LOBBY_EXISTS:
        "Zaten aktif bir lobidesin. Lobini tekrar acmak icin /lobim komutunu kullanabilir, oradan cikabilir veya host isen oyunu bozabilirsin.",
      NO_ACTIVE_LOBBY: "Aktif bir lobin yok."
    };

    return messages[error.message] ?? error.message;
  }

  if (error instanceof BackendNetworkError) {
    return "Backend ile iletisim kurulamadi. Lutfen biraz sonra tekrar dene.";
  }

  if (error instanceof BackendResponseShapeError) {
    return "Backend yaniti beklenen formatta degil. Lutfen tekrar dene.";
  }

  return "Islem kaydedilmis olabilir ama Discord mesaji guncellenirken hata olustu. Lutfen /lobim ile yeniden acmayi deneyin.";
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

function isModerator(interaction: Interaction): boolean {
  if (!interaction.inGuild()) {
    return false;
  }

  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  if (env.moderatorRoleIds.length === 0) {
    return false;
  }

  const roles = interaction.member?.roles;

  if (!roles) {
    return false;
  }

  const roleIds = Array.isArray(roles)
    ? roles
    : "cache" in roles
      ? [...roles.cache.keys()]
      : [];

  return roleIds.some((roleId) => env.moderatorRoleIds.includes(roleId));
}

async function saveLobbyMessage(
  lobby: LobbyView,
  message: Message,
  requestedByDiscordId: string,
  moderator = false
): Promise<void> {
  await backend.updateLobbyDiscordMessage({
    lobbyId: lobby.id,
    requestedByDiscordId,
    discordChannelId: message.channelId,
    discordMessageId: message.id,
    moderator
  });
}

async function sendLobbyMessage(channel: unknown, lobby: LobbyView, matchCode?: string): Promise<Message> {
  if (!isSendableChannel(channel)) {
    throw new Error("Current channel cannot send lobby messages.");
  }

  return channel.send({
    embeds: [renderLobbyEmbed(lobby, matchCode)],
    components: renderLobbyComponents(lobby)
  });
}

async function refreshLobbyMessage(message: Message, lobbyId: string, matchCode?: string): Promise<LobbyView> {
  const lobby = await backend.getLobby(lobbyId);

  await editLobbyMessage(message, lobby, matchCode);

  return lobby;
}

async function editLobbyMessage(message: Message, lobby: LobbyView, matchCode?: string): Promise<void> {
  await message.edit({
    embeds: [renderLobbyEmbed(lobby, matchCode)],
    components: renderLobbyComponents(lobby)
  });
}

async function tryEditLobbyMessage(
  message: Message,
  lobby: LobbyView,
  context: Record<string, unknown>,
  matchCode?: string
): Promise<boolean> {
  try {
    await editLobbyMessage(message, lobby, matchCode);
    return true;
  } catch (error) {
    logInteractionError("Lobby message edit failed", context, error);
    return false;
  }
}

async function fetchChannel(channelId: string): Promise<unknown> {
  return client.channels.fetch(channelId).catch((error: unknown) => {
    logInteractionError("Discord channel fetch failed", { channelId }, error);
    return null;
  });
}

async function resolveInteractionChannel(interaction: Interaction): Promise<unknown> {
  if (interaction.channel) {
    return interaction.channel;
  }

  if (!interaction.channelId) {
    return null;
  }

  return fetchChannel(interaction.channelId);
}

async function updateLobbyControlMessage(input: {
  lobby: LobbyView;
  requestedByDiscordId: string;
  moderator?: boolean;
  matchCode?: string;
  fallbackMessage?: Message;
  fallbackChannel?: unknown;
  context: Record<string, unknown>;
}): Promise<LobbyMessageUpdateResult> {
  const { lobby, requestedByDiscordId, moderator = false, matchCode, fallbackMessage, fallbackChannel, context } = input;
  const storedChannel = await fetchChannel(lobby.discordChannelId);

  if (isMessageFetchableChannel(storedChannel) && lobby.discordMessageId) {
    const storedMessage = await storedChannel.messages.fetch(lobby.discordMessageId).catch((error: unknown) => {
      logInteractionError("Stored lobby message fetch failed", {
        ...context,
        lobbyId: lobby.id,
        discordChannelId: lobby.discordChannelId,
        discordMessageId: lobby.discordMessageId
      }, error);
      return null;
    });

    if (storedMessage) {
      try {
        await editLobbyMessage(storedMessage, lobby, matchCode);
        return { ok: true, action: "edited" };
      } catch (error) {
        logInteractionError("Stored lobby message edit failed", {
          ...context,
          lobbyId: lobby.id,
          discordChannelId: lobby.discordChannelId,
          discordMessageId: lobby.discordMessageId
        }, error);
      }
    }
  }

  if (fallbackMessage && !isEphemeralMessage(fallbackMessage)) {
    try {
      await editLobbyMessage(fallbackMessage, lobby, matchCode);

      if (fallbackMessage.id !== lobby.discordMessageId || fallbackMessage.channelId !== lobby.discordChannelId) {
        await saveLobbyMessage(lobby, fallbackMessage, requestedByDiscordId, moderator);
      }

      return { ok: true, action: "fallback-edited" };
    } catch (error) {
      logInteractionError("Fallback lobby message edit failed", {
        ...context,
        lobbyId: lobby.id,
        fallbackMessageId: fallbackMessage.id,
        fallbackChannelId: fallbackMessage.channelId
      }, error);
    }
  }

  const sendChannel = fallbackChannel ?? storedChannel;

  if (isSendableChannel(sendChannel)) {
    try {
      const recreatedMessage = await sendLobbyMessage(sendChannel, lobby, matchCode);
      await saveLobbyMessage(lobby, recreatedMessage, requestedByDiscordId, moderator);
      return { ok: true, action: "recreated" };
    } catch (error) {
      logInteractionError("Lobby message recreate failed", {
        ...context,
        lobbyId: lobby.id
      }, error);
      return { ok: false, reason: "recreate-failed" };
    }
  }

  return { ok: false, reason: "no-sendable-channel" };
}

function formatLobbyMessageUpdateResult(successText: string, result: LobbyMessageUpdateResult): string {
  if (result.ok) {
    return successText;
  }

  return `${successText} ama lobi mesaji guncellenemedi. /lobim ile yeniden acmayi deneyin.`;
}

function getJoinedParticipantOptions(lobby: LobbyView) {
  return lobby.participants
    .filter((participant) => participant.status === LobbyParticipantStatus.Joined)
    .slice(0, 25)
    .map((participant, index) => ({
      label: (participant.username ?? `Oyuncu ${index + 1}`).slice(0, 100),
      description: participant.discordId,
      value: participant.discordId
    }));
}

function getHostTransferOptions(lobby: LobbyView) {
  return lobby.participants
    .filter(
      (participant) =>
        participant.status === LobbyParticipantStatus.Joined &&
        participant.discordId !== lobby.createdByDiscordId
    )
    .slice(0, 25)
    .map((participant, index) => ({
      label: (participant.username ?? `Oyuncu ${index + 1}`).slice(0, 100),
      description: participant.discordId,
      value: participant.discordId
    }));
}

function formatLobbyDate(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Istanbul"
      });
}

function renderCompactLobbyList(lobbies: CompactLobbyView[]): string {
  if (lobbies.length === 0) {
    return "Lobi bulunamadi.";
  }

  const visible = lobbies.slice(0, 10).map((lobby, index) => {
    const participants = lobby.participants
      .filter((participant) => participant.status === LobbyParticipantStatus.Joined)
      .map((participant) => `<@${participant.discordId}>`)
      .join(", ") || "Yok";

    return [
      `${index + 1}) Lobby: ${lobby.id}`,
      `Status: ${lobby.status}`,
      `Players: ${lobby.participantCount}/${lobby.playerCount}`,
      `Host: <@${lobby.createdByDiscordId}>`,
      `Schedule: ${formatLobbyDate(lobby.scheduledAt)}`,
      `Participants: ${participants}`
    ].join("\n");
  });

  if (lobbies.length > 10) {
    visible.push(`Ilk 10 lobi gosteriliyor. Toplam: ${lobbies.length}`);
  }

  return visible.join("\n\n");
}

function renderModeratorLobbyActions(lobby: LobbyView, targetDiscordId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`mod-reopen:${lobby.id}:${targetDiscordId}`)
        .setLabel("Lobiyi Yeniden Ac")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`mod-remove:${lobby.id}:${targetDiscordId}`)
        .setLabel("Kullaniciyi Lobiden Cikar")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mod-void:${lobby.id}:${targetDiscordId}`)
        .setLabel("Lobiyi Kapat")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`mod-release:${lobby.id}:${targetDiscordId}`)
        .setLabel("Oyunculari Serbest Birak")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

async function updateStoredLobbyMessage(lobby: LobbyView): Promise<void> {
  const result = await updateLobbyControlMessage({
    lobby,
    requestedByDiscordId: lobby.createdByDiscordId,
    context: {
      source: "updateStoredLobbyMessage"
    }
  });

  if (!result.ok) {
    throw new Error(`Unable to update stored lobby message: ${result.reason}`);
  }
}

async function handleChatCommand(interaction: ChatInputCommandInteraction): Promise<void> {
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

  if (interaction.commandName === "lobim") {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    let lobby: LobbyView;

    try {
      console.info("Fetching active lobby for /lobim", {
        commandName: interaction.commandName,
        requesterDiscordId: interaction.user.id,
        backendUrl: backend.getRequestUrl(`/users/${interaction.user.id}/active-lobby`)
      });
      lobby = await backend.getActiveLobby(interaction.user.id);
    } catch (error) {
      logInteractionError("/lobim active lobby lookup failed", {
        commandName: interaction.commandName,
        requesterDiscordId: interaction.user.id,
        backendUrl: backend.getRequestUrl(`/users/${interaction.user.id}/active-lobby`)
      }, error);

      await interaction.editReply({
        content: formatBackendError(error)
      });
      return;
    }

    try {
      const channel = await resolveInteractionChannel(interaction);
      const message = await sendLobbyMessage(channel, lobby);
      try {
        await saveLobbyMessage(lobby, message, interaction.user.id);
      } catch (error) {
        logInteractionError("/lobim message id save failed", {
          commandName: interaction.commandName,
          requesterDiscordId: interaction.user.id,
          lobbyId: lobby.id,
          messageId: message.id
        }, error);

        await interaction.editReply({
          content: "Aktif lobin yeniden acildi ama mesaj kaydi backend'de guncellenemedi. Moderatore haber ver."
        });
        return;
      }

      await interaction.editReply({
        content: "Aktif lobin yeniden acildi."
      });
    } catch (error) {
      logInteractionError("/lobim render or message recreation failed", {
        commandName: interaction.commandName,
        requesterDiscordId: interaction.user.id,
        lobbyId: lobby.id
      }, error);
      await interaction.editReply({
        content: error instanceof BackendNetworkError
          ? formatBackendError(error)
          : "Lobi bulundu ama mesaj olusturulurken hata olustu. Moderatore haber ver."
      });
    }

    return;
  }

  if (interaction.commandName === "lobiler") {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    if (!isModerator(interaction)) {
      await interaction.editReply({
        content: "Bu komutu sadece moderatorler kullanabilir."
      });
      return;
    }

    const status = interaction.options.getString("status", false) ?? "ACTIVE";

    try {
      const lobbies = await backend.listModeratorLobbies(status);

      await interaction.editReply({
        embeds: [{
          title: status === "ALL" ? "All Lobbies" : "Active Lobbies",
          description: renderCompactLobbyList(lobbies),
          color: 0xb91c1c
        }]
      });
    } catch (error) {
      await interaction.editReply({
        content: formatBackendError(error)
      });
    }

    return;
  }

  if (interaction.commandName === "lobi-bul") {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    if (!isModerator(interaction)) {
      await interaction.editReply({
        content: "Bu komutu sadece moderatorler kullanabilir."
      });
      return;
    }

    const targetUser = interaction.options.getUser("user", true);

    try {
      const lobby = await backend.getModeratorActiveLobby(targetUser.id);

      if (!lobby) {
        await interaction.editReply({
          content: "Bu kullanicinin aktif lobisi yok."
        });
        return;
      }

      await interaction.editReply({
        embeds: [renderLobbyEmbed(lobby)],
        components: renderModeratorLobbyActions(lobby, targetUser.id)
      });
    } catch (error) {
      await interaction.editReply({
        content: formatBackendError(error)
      });
    }

    return;
  }

  if (interaction.commandName !== "lobi-olustur") {
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "Bu komut sadece sunucu icinde kullanilabilir.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const modeInput = interaction.options.getString("mode", false);
  const playerCount = interaction.options.getInteger("player_count", false);
  const scheduledAt = interaction.options.getString("scheduled_at", false) ?? undefined;
  const variantInput = interaction.options.getString("variant", false);

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

  if (scheduledAt && !isValidScheduleInput(scheduledAt)) {
    await interaction.reply({
      content: "Tarih/saat formati hatali. Dogru format: gun.ay.yil-00.00 orn. 03.06.2026-21.00",
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
      components: renderLobbyComponents(lobby)
    });

    const message = await interaction.fetchReply();
    await saveLobbyMessage(lobby, message, interaction.user.id);
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

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [action, lobbyId, value] = interaction.customId.split(":");

  if (action.startsWith("mod-")) {
    if (!isModerator(interaction)) {
      await interaction.reply({
        content: "Bu islemi sadece moderatorler kullanabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    try {
      if (action === "mod-reopen") {
        const lobby = await backend.getLobby(lobbyId);
        const channel = await resolveInteractionChannel(interaction);
        const message = await sendLobbyMessage(channel, lobby);
        try {
          await saveLobbyMessage(lobby, message, interaction.user.id, true);
        } catch (error) {
          logInteractionError("Moderator lobby message id save failed", {
            customId: interaction.customId,
            lobbyId,
            moderatorDiscordId: interaction.user.id,
            messageId: message.id
          }, error);
          await interaction.editReply({
            content: "Lobi yeniden acildi ama mesaj kaydi backend'de guncellenemedi."
          });
          return;
        }
        await interaction.editReply({
          content: "Lobi yeniden acildi."
        });
        return;
      }

      if (action === "mod-remove") {
        const lobby = await backend.moderatorRemoveParticipant({
          lobbyId,
          requestedByDiscordId: interaction.user.id,
          targetDiscordId: value,
          reason: "Moderator removal"
        });
        const updateResult = await updateLobbyControlMessage({
          lobby,
          requestedByDiscordId: interaction.user.id,
          moderator: true,
          fallbackChannel: await resolveInteractionChannel(interaction),
          context: {
            customId: interaction.customId,
            lobbyId,
            moderatorDiscordId: interaction.user.id,
            targetDiscordId: value
          }
        });
        await interaction.editReply({
          content: formatLobbyMessageUpdateResult("Kullanici lobiden cikarildi.", updateResult)
        });
        return;
      }

      if (action === "mod-void") {
        const lobby = await backend.moderatorVoidLobby({
          lobbyId,
          requestedByDiscordId: interaction.user.id,
          reason: "Moderator closed lobby"
        });
        const updateResult = await updateLobbyControlMessage({
          lobby,
          requestedByDiscordId: interaction.user.id,
          moderator: true,
          fallbackChannel: await resolveInteractionChannel(interaction),
          context: {
            customId: interaction.customId,
            lobbyId,
            moderatorDiscordId: interaction.user.id
          }
        });
        await interaction.editReply({
          content: formatLobbyMessageUpdateResult("Lobi moderator tarafindan kapatildi.", updateResult)
        });
        return;
      }

      if (action === "mod-release") {
        const lobby = await backend.moderatorReleaseLobby({
          lobbyId,
          requestedByDiscordId: interaction.user.id,
          reason: "Stuck lobby recovery"
        });
        const updateResult = await updateLobbyControlMessage({
          lobby,
          requestedByDiscordId: interaction.user.id,
          moderator: true,
          fallbackChannel: await resolveInteractionChannel(interaction),
          context: {
            customId: interaction.customId,
            lobbyId,
            moderatorDiscordId: interaction.user.id
          }
        });
        await interaction.editReply({
          content: formatLobbyMessageUpdateResult("Oyuncular serbest birakildi.", updateResult)
        });
      }
    } catch (error) {
      logInteractionError("Moderator lobby action failed", {
        customId: interaction.customId,
        lobbyId,
        moderatorDiscordId: interaction.user.id
      }, error);
      await interaction.editReply({
        content: formatBackendError(error)
      });
    }

    return;
  }

  if (action === "lobby-join") {
    await interaction.deferUpdate();

    try {
      const lobby = await backend.joinLobby({
        lobbyId,
        discordId: interaction.user.id,
        username: interaction.user.username
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult("Lobiye katildin.", updateResult),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      logInteractionError("Lobby join failed", {
        customId: interaction.customId,
        lobbyId,
        userId: interaction.user.id
      }, error);

      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-leave") {
    await interaction.deferUpdate();

    try {
      const lobby = await backend.leaveLobby({
        lobbyId,
        requestedByDiscordId: interaction.user.id
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult("Lobiden ayrildin.", updateResult),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-edit-schedule") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`lobby-schedule-modal:${lobbyId}:${hostDiscordId}`)
      .setTitle("Tarih/Saat Degistir")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("scheduled_at")
            .setLabel("Yeni tarih/saat")
            .setPlaceholder("03.06.2026-21.00")
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        )
      );

    await interaction.showModal(modal);
    return;
  }

  if (action === "lobby-cancel") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const lobby = await backend.cancelLobby({
        lobbyId,
        requestedByDiscordId: interaction.user.id
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult("Lobi bozuldu.", updateResult),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-dissolution-start") {
    await interaction.deferUpdate();

    try {
      const lobby = await backend.startDissolutionVote({
        lobbyId,
        requestedByDiscordId: interaction.user.id
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult("Fesih oylamasi baslatildi.", updateResult),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-dissolution-vote") {
    await interaction.deferUpdate();
    const vote = value === "YES" ? "YES" : "NO";

    try {
      const lobby = await backend.castDissolutionVote({
        lobbyId,
        requestedByDiscordId: interaction.user.id,
        vote
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id,
          vote
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult(
          `Fesih oyunuz kaydedildi: ${vote === "YES" ? "Evet" : "Hayir"}`,
          updateResult
        ),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-start-game") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const lobby = await backend.startGame({
        lobbyId,
        requestedByDiscordId: interaction.user.id
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult("Oyun basliyor. Lobi kilitlendi.", updateResult),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.followUp({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-no-show-menu") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      const lobby = await backend.getLobby(lobbyId);
      const options = getJoinedParticipantOptions(lobby);

      if (options.length === 0) {
        await interaction.reply({
          content: "Isaretlenecek aktif oyuncu yok.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: "Oyuncu yok olarak isaretlenecek kisiyi sec.",
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`lobby-no-show-select:${lobbyId}:${hostDiscordId}`)
              .setPlaceholder("Oyuncu sec")
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(options)
          )
        ],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.reply({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-cancel-missing-menu") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      const lobby = await backend.getLobby(lobbyId);
      const options = getJoinedParticipantOptions(lobby);

      if (options.length === 0) {
        await interaction.reply({
          content: "Lutfen gelmeyen en az bir oyuncu sec.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: "Bu islem lobiyi kapatacak ve secilen oyunculari no-show olarak raporlayacak.",
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`lobby-cancel-missing-select:${lobbyId}:${hostDiscordId}`)
              .setPlaceholder("Gelmeyen oyunculari sec")
              .setMinValues(1)
              .setMaxValues(options.length)
              .addOptions(options)
          )
        ],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.reply({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-transfer-host-menu") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      const lobby = await backend.getLobby(lobbyId);
      const options = getHostTransferOptions(lobby);

      if (options.length === 0) {
        await interaction.reply({
          content: "Hostlugu devredebilecegin baska oyuncu yok.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: "Hostlugu devretmek istedigin oyuncuyu sec.",
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`lobby-transfer-host-select:${lobbyId}:${hostDiscordId}`)
              .setPlaceholder("Yeni host sec")
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(options)
          )
        ],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.reply({
        content: formatBackendError(error),
        flags: MessageFlags.Ephemeral
      });
    }

    return;
  }

  if (action === "lobby-create-match") {
    const hostDiscordId = value;

    if (interaction.user.id !== hostDiscordId) {
      await interaction.reply({
        content: "Bu islemi sadece host yapabilir.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const matchCode = await backend.createMatch(lobbyId);
      const freshLobby = await backend.getLobby(lobbyId);
      const updateResult = await updateLobbyControlMessage({
        lobby: freshLobby,
        requestedByDiscordId: interaction.user.id,
        matchCode,
        fallbackMessage: interaction.message,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          customId: interaction.customId,
          lobbyId,
          userId: interaction.user.id,
          matchCode
        }
      });

      await interaction.followUp({
        content: formatLobbyMessageUpdateResult(
          `Match Code: ${matchCode}. Bu kodu ileride Tabletop Match Control Panel'e girecegiz.`,
          updateResult
        ),
        flags: MessageFlags.Ephemeral
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

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [action, lobbyId, hostDiscordId] = interaction.customId.split(":");

  if (action !== "lobby-schedule-modal") {
    return;
  }

  if (interaction.user.id !== hostDiscordId) {
    await interaction.reply({
      content: "Bu islemi sadece host yapabilir.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const scheduledAtInput = interaction.fields.getTextInputValue("scheduled_at");

  if (!isValidScheduleInput(scheduledAtInput)) {
    await interaction.reply({
      content: "Tarih/saat formati hatali. Dogru format: gun.ay.yil-00.00 orn. 03.06.2026-21.00",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  try {
    const lobby = await backend.updateLobbySchedule({
      lobbyId,
      requestedByDiscordId: interaction.user.id,
      scheduledAtInput
    });

    const updateResult = await updateLobbyControlMessage({
      lobby,
      requestedByDiscordId: interaction.user.id,
      fallbackChannel: await resolveInteractionChannel(interaction),
      context: {
        source: "schedule-modal",
        lobbyId,
        userId: interaction.user.id,
        scheduledAtInput
      }
    });

    await interaction.editReply({
      content: formatLobbyMessageUpdateResult("Tarih/saat guncellendi.", updateResult)
    });
  } catch (error) {
    await interaction.editReply({
      content: formatBackendError(error)
    });
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const [action, lobbyId, hostDiscordId] = interaction.customId.split(":");

  if (interaction.user.id !== hostDiscordId) {
    await interaction.reply({
      content: "Bu islemi sadece host yapabilir.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferUpdate();

  if (action === "lobby-no-show-select") {
    try {
      const lobby = await backend.markNoShow({
        lobbyId,
        requestedByDiscordId: interaction.user.id,
        targetDiscordId: interaction.values[0]
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          source: "no-show-select",
          lobbyId,
          userId: interaction.user.id,
          targetDiscordId: interaction.values[0]
        }
      });
      await interaction.editReply({
        content: formatLobbyMessageUpdateResult("Oyuncu yok olarak isaretlendi.", updateResult),
        components: []
      });
    } catch (error) {
      await interaction.editReply({
        content: formatBackendError(error),
        components: []
      });
    }

    return;
  }

  if (action === "lobby-cancel-missing-select") {
    try {
      const lobby = await backend.cancelMissingPlayers({
        lobbyId,
        requestedByDiscordId: interaction.user.id,
        missingDiscordIds: interaction.values
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          source: "cancel-missing-select",
          lobbyId,
          userId: interaction.user.id,
          missingDiscordIds: interaction.values
        }
      });
      await interaction.editReply({
        content: formatLobbyMessageUpdateResult(
          "Eksik katilim nedeniyle oyun dagildi. Gelmeyen oyuncular raporlandi.",
          updateResult
        ),
        components: []
      });
    } catch (error) {
      await interaction.editReply({
        content: formatBackendError(error),
        components: []
      });
    }
    return;
  }

  if (action === "lobby-transfer-host-select") {
    try {
      const lobby = await backend.transferHost({
        lobbyId,
        requestedByDiscordId: interaction.user.id,
        targetDiscordId: interaction.values[0]
      });

      const updateResult = await updateLobbyControlMessage({
        lobby,
        requestedByDiscordId: interaction.user.id,
        fallbackChannel: await resolveInteractionChannel(interaction),
        context: {
          source: "transfer-host-select",
          lobbyId,
          userId: interaction.user.id,
          targetDiscordId: interaction.values[0]
        }
      });
      await interaction.editReply({
        content: formatLobbyMessageUpdateResult("Hostluk devredildi.", updateResult),
        components: []
      });
    } catch (error) {
      await interaction.editReply({
        content: formatBackendError(error),
        components: []
      });
    }
  }
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await handleChatCommand(interaction);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModal(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
}

async function runLobbyCleanup(): Promise<void> {
  try {
    const expired = await backend.expireStaleLobbies();

    for (const lobby of expired) {
      const channel = await client.channels.fetch(lobby.discordChannelId).catch(() => null);

      await updateStoredLobbyMessage(lobby);

      if (isSendableChannel(channel)) {
        await channel.send({
          content: "Planlanan oyun yeterli oyuncuya ulasmadigi icin dolmadi ve kapatildi."
        });
      }
    }
  } catch (error) {
    console.error("Lobby cleanup failed:", error);
  }
}

client.once("clientReady", (readyClient) => {
  console.log(`Discord bot ready as ${readyClient.user.tag}`);
  setInterval(() => {
    void runLobbyCleanup();
  }, 5 * 60 * 1000);
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
