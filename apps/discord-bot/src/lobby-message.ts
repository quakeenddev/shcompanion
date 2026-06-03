import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import { resolvePlayerSlots } from "@shc/game-rules";
import { LobbyStatus } from "@shc/shared-types";
import type { LobbyView } from "./backend-client.js";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul"
  });
}

function isFull(lobby: LobbyView): boolean {
  return lobby.joinedPlayersCount >= lobby.playerCount;
}

function isTerminalLobby(lobby: LobbyView): boolean {
  return (
    lobby.status === LobbyStatus.Cancelled ||
    lobby.status === LobbyStatus.Expired ||
    lobby.status === LobbyStatus.Dissolved ||
    lobby.status === LobbyStatus.CancelledMissingPlayers ||
    lobby.status === LobbyStatus.Ended ||
    lobby.status === LobbyStatus.Voided ||
    lobby.status === LobbyStatus.GameStarting ||
    lobby.status === LobbyStatus.InProgress
  );
}

function canUseNoShowTools(lobby: LobbyView): boolean {
  if (!lobby.scheduledAt || isTerminalLobby(lobby)) {
    return false;
  }

  const scheduledAt = new Date(lobby.scheduledAt).getTime();
  return Date.now() >= scheduledAt - 15 * 60 * 1000;
}

function canCancelForMissingPlayers(lobby: LobbyView): boolean {
  if (!lobby.scheduledAt || isTerminalLobby(lobby)) {
    return false;
  }

  return Date.now() >= new Date(lobby.scheduledAt).getTime();
}

export function renderLobbyEmbed(lobby: LobbyView, matchCode?: string): EmbedBuilder {
  const slots = resolvePlayerSlots(lobby.playerCount, lobby.participants)
    .map((slot) => {
      const occupant = slot.discordId ? `<@${slot.discordId}>` : slot.username ?? "Empty";
      return `${slot.index}. ${occupant}`;
    })
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Secret Hitler Companion Lobby")
    .setColor(isTerminalLobby(lobby) ? 0x6b7280 : 0xb91c1c)
    .addFields(
      { name: "Mode", value: lobby.mode, inline: true },
      { name: "Players", value: `${lobby.joinedPlayersCount}/${lobby.playerCount}`, inline: true },
      { name: "Variant", value: lobby.variant, inline: true },
      { name: "Status", value: lobby.status, inline: true },
      { name: "Host", value: `<@${lobby.createdByDiscordId}>`, inline: true },
      { name: "Game Time", value: formatDateTime(lobby.scheduledAt), inline: true },
      { name: "Seat Lock", value: formatDateTime(lobby.seatsLockedAt), inline: true },
      { name: "Oyuncular", value: slots || "No players.", inline: false }
    );

  if (lobby.status === LobbyStatus.Cancelled) {
    embed.setDescription("Bu lobi host tarafindan bozuldu.");
  }

  if (lobby.status === LobbyStatus.Expired) {
    embed.setDescription("Planlanan oyun yeterli oyuncuya ulasmadigi icin kapatildi.");
  }

  if (lobby.status === LobbyStatus.Dissolved) {
    embed.setDescription("Lobi oyuncu oylamasiyla feshedildi.");
  }

  if (lobby.status === LobbyStatus.CancelledMissingPlayers) {
    embed.setDescription("Eksik katilim nedeniyle oyun dagildi.");
  }

  if (lobby.status === LobbyStatus.GameStarting || lobby.status === LobbyStatus.InProgress) {
    embed.setDescription("Oyun basliyor. Lobi kilitlendi.");
  }

  if (lobby.noShowParticipants.length > 0) {
    embed.addFields({
      name: "Oyuncu Yok",
      value: lobby.noShowParticipants
        .map((participant) => participant.username ?? `<@${participant.discordId}>`)
        .join("\n"),
      inline: false
    });
  }

  if (lobby.dissolutionVote) {
    embed.addFields({
      name: "Fesih Oylamasi",
      value: `${lobby.dissolutionVote.yesCount}/${lobby.dissolutionVote.threshold} Evet`,
      inline: true
    });
  }

  if (matchCode) {
    embed.addFields({
      name: "Match Code",
      value: `${matchCode}. Bu kodu ileride Tabletop Match Control Panel'e girecegiz.`,
      inline: false
    });
  }

  return embed;
}

export function renderLobbyComponents(
  lobby: LobbyView,
  _currentUserIsHost = false
): ActionRowBuilder<ButtonBuilder>[] {
  const terminal = isTerminalLobby(lobby);
  const full = isFull(lobby);
  const open = lobby.status === LobbyStatus.Open;
  const openOrReady = lobby.status === LobbyStatus.Open || lobby.status === LobbyStatus.Ready;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lobby-join:${lobby.id}`)
        .setLabel("Lobiye Katil")
        .setStyle(ButtonStyle.Success)
        .setDisabled(terminal || !open || full),
      new ButtonBuilder()
        .setCustomId(`lobby-leave:${lobby.id}`)
        .setLabel("Lobiden Cik")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(terminal || full || !open),
      new ButtonBuilder()
        .setCustomId(`lobby-edit-schedule:${lobby.id}:${lobby.createdByDiscordId}`)
        .setLabel("Tarih/Saat Degistir")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(terminal || !open),
      new ButtonBuilder()
        .setCustomId(`lobby-cancel:${lobby.id}:${lobby.createdByDiscordId}`)
        .setLabel("Oyunu Boz")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(terminal),
      new ButtonBuilder()
        .setCustomId(`lobby-create-match:${lobby.id}:${lobby.createdByDiscordId}`)
        .setLabel("Match Code Olustur")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(terminal || !full || Boolean(lobby.match))
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lobby-dissolution-start:${lobby.id}`)
        .setLabel("Fesih Oylamasi Baslat")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(terminal || !openOrReady || !full || Boolean(lobby.dissolutionVote)),
      new ButtonBuilder()
        .setCustomId(`lobby-dissolution-vote:${lobby.id}:YES`)
        .setLabel("Feshe Evet")
        .setStyle(ButtonStyle.Success)
        .setDisabled(terminal || !Boolean(lobby.dissolutionVote)),
      new ButtonBuilder()
        .setCustomId(`lobby-dissolution-vote:${lobby.id}:NO`)
        .setLabel("Feshe Hayir")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(terminal || !Boolean(lobby.dissolutionVote)),
      new ButtonBuilder()
        .setCustomId(`lobby-start-game:${lobby.id}:${lobby.createdByDiscordId}`)
        .setLabel("Oyun Basliyor")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(terminal || !openOrReady || !full || Boolean(lobby.dissolutionVote))
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lobby-no-show-menu:${lobby.id}:${lobby.createdByDiscordId}`)
        .setLabel("Oyuncu Yok Isaretle")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(terminal || !canUseNoShowTools(lobby) || lobby.joinedPlayersCount === 0),
      new ButtonBuilder()
        .setCustomId(`lobby-cancel-missing-menu:${lobby.id}:${lobby.createdByDiscordId}`)
        .setLabel("Eksik Katilim: Oyunu Dagit")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(terminal || !canCancelForMissingPlayers(lobby) || lobby.joinedPlayersCount === 0)
    )
  ];
}

export const buildLobbyEmbed = renderLobbyEmbed;
export const buildLobbyComponents = renderLobbyComponents;
