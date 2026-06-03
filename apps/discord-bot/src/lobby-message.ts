import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import { PlayerColor } from "@shc/shared-types";
import type { LobbyView } from "./backend-client.js";

const colorLabelByValue: Record<PlayerColor, string> = {
  [PlayerColor.Red]: "Red",
  [PlayerColor.Blue]: "Blue",
  [PlayerColor.Green]: "Green",
  [PlayerColor.Yellow]: "Yellow",
  [PlayerColor.Orange]: "Orange",
  [PlayerColor.Purple]: "Purple",
  [PlayerColor.Brown]: "Brown",
  [PlayerColor.White]: "White",
  [PlayerColor.Black]: "Black",
  [PlayerColor.Pink]: "Pink"
};

const selectablePlayerColors = Object.values(PlayerColor).filter(
  (color) => color !== PlayerColor.Black
);

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

export function renderLobbyEmbed(lobby: LobbyView, matchCode?: string): EmbedBuilder {
  const selectedColors = lobby.participants.length
    ? lobby.participants
        .map((participant) => {
          const name = participant.username ?? `<@${participant.discordId}>`;
          return `${colorLabelByValue[participant.selectedColor]}: ${name}`;
        })
        .join("\n")
    : "No selected colors yet.";

  const embed = new EmbedBuilder()
    .setTitle("Secret Hitler Companion Lobby")
    .setColor(0xb91c1c)
    .addFields(
      { name: "Mode", value: lobby.mode, inline: true },
      { name: "Players", value: `${lobby.joinedPlayersCount}/${lobby.playerCount}`, inline: true },
      { name: "Variant", value: lobby.variant, inline: true },
      { name: "Status", value: lobby.status, inline: true },
      { name: "Host", value: `<@${lobby.host.discordId}>`, inline: true },
      { name: "Game Time", value: formatDateTime(lobby.scheduledAt), inline: true },
      { name: "Seat Lock", value: formatDateTime(lobby.seatsLockedAt), inline: true },
      { name: "Selected Colors", value: selectedColors, inline: false }
    );

  if (matchCode) {
    embed.addFields({
      name: "Match Code",
      value: `${matchCode}. Bu kodu ileride Tabletop Match Control Panel'e gireceğiz.`,
      inline: false
    });
  }

  return embed;
}

export function buildLobbyComponents(
  lobby: LobbyView,
  currentUserIsHost = false
): ActionRowBuilder<ButtonBuilder>[] {
  if (lobby.match) {
    return [];
  }

  const usedColors = new Set(lobby.participants.map((participant) => participant.selectedColor));
  const colorButtons = selectablePlayerColors
    .filter((color) => !usedColors.has(color))
    .map((color) =>
      new ButtonBuilder()
        .setCustomId(`lobby-join:${lobby.id}:${color}`)
        .setLabel(colorLabelByValue[color])
        .setStyle(ButtonStyle.Secondary)
    );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let index = 0; index < colorButtons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(colorButtons.slice(index, index + 5)));
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lobby-create-match:${lobby.id}:${lobby.host.discordId}`)
        .setLabel("Create Match Code")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!currentUserIsHost || lobby.joinedPlayersCount < lobby.playerCount)
    )
  );

  return rows;
}

export const renderLobbyComponents = buildLobbyComponents;
export const buildLobbyEmbed = renderLobbyEmbed;
