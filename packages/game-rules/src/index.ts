import { GameMode, GameVariant, LobbyParticipantStatus, LobbyStatus } from "@shc/shared-types";

const istanbulUtcOffsetHours = 3;
const fifteenMinutesMs = 15 * 60 * 1000;
const dissolutionVoteTtlMs = 5 * 60 * 1000;

export type PlayerSlotParticipant = {
  discordId: string;
  username?: string | null;
  status: LobbyParticipantStatus;
};

export type PlayerSlot = {
  index: number;
  discordId: string | null;
  username: string | null;
};

export function getAllowedPlayerCounts(gameMode: GameMode): number[] {
  if (gameMode === GameMode.Competitive) {
    return [7];
  }

  if (gameMode === GameMode.Casual) {
    return [7, 9, 10];
  }

  return [7];
}

export function validateGameModePlayerCount(gameMode: GameMode, playerCount: number): boolean {
  return getAllowedPlayerCounts(gameMode).includes(playerCount);
}

export function resolveVariant(gameMode: GameMode, playerCount: number): GameVariant {
  return isCasualMayhem(gameMode, playerCount) ? GameVariant.Mayhem : GameVariant.Standard;
}

export function validateGameVariant(
  gameMode: GameMode,
  playerCount: number,
  variant: GameVariant
): boolean {
  if (isCasualMayhem(gameMode, playerCount)) {
    return variant === GameVariant.Mayhem;
  }

  if (playerCount === 7) {
    return [
      GameVariant.Standard,
      GameVariant.StandardMeta,
      GameVariant.Freeplay
    ].includes(variant);
  }

  return variant === GameVariant.Standard;
}

export function resolveRequestedVariant(
  gameMode: GameMode,
  playerCount: number,
  requestedVariant?: GameVariant
): GameVariant {
  if (isCasualMayhem(gameMode, playerCount)) {
    return GameVariant.Mayhem;
  }

  const variant = requestedVariant ?? GameVariant.Standard;

  if (!validateGameVariant(gameMode, playerCount, variant)) {
    throw new Error("INVALID_GAME_VARIANT");
  }

  return variant;
}

export function isCompetitive(gameMode: GameMode): boolean {
  return gameMode === GameMode.Competitive;
}

export function isCasualMayhem(gameMode: GameMode, playerCount: number): boolean {
  return gameMode === GameMode.Casual && playerCount === 10;
}

export const isMayhemGame = isCasualMayhem;

export function parseScheduledAtInput(input: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})-(\d{2})\.(\d{2})$/.exec(input);

  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - istanbulUtcOffsetHours, minute));
}

export function resolveSeatsLockedAt(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() - 60 * 60 * 1000);
}

export function isActiveLobbyStatus(status: LobbyStatus): boolean {
  return (
    status === LobbyStatus.Open ||
    status === LobbyStatus.Ready ||
    status === LobbyStatus.GameStarting ||
    status === LobbyStatus.InProgress
  );
}

export function isJoinedParticipantStatus(status: LobbyParticipantStatus): boolean {
  return status === LobbyParticipantStatus.Joined;
}

export function isBlockingParticipantStatus(status: LobbyParticipantStatus): boolean {
  return status === LobbyParticipantStatus.Joined;
}

export function countJoinedParticipants(
  participants: Array<{ status: LobbyParticipantStatus }>
): number {
  return participants.filter((participant) => isJoinedParticipantStatus(participant.status)).length;
}

export function canCancelLobby(input: {
  status: LobbyStatus;
  participantCount: number;
  playerCount: number;
  scheduledAt: Date | null;
  now: Date;
}): boolean {
  if (!isActiveLobbyStatus(input.status)) {
    return false;
  }

  if (input.status === LobbyStatus.GameStarting || input.status === LobbyStatus.InProgress) {
    return false;
  }

  const isFull = input.participantCount >= input.playerCount || input.status === LobbyStatus.Ready;

  if (!isFull || !input.scheduledAt) {
    return true;
  }

  return input.now.getTime() < resolveSeatsLockedAt(input.scheduledAt).getTime();
}

export function getDissolutionThreshold(playerCount: number): number {
  if (playerCount === 7) {
    return 5;
  }

  if (playerCount === 9) {
    return 6;
  }

  if (playerCount === 10) {
    return 7;
  }

  return Math.ceil(playerCount * 0.7);
}

export function canStartDissolutionVote(input: {
  status: LobbyStatus;
  participantCount: number;
  playerCount: number;
  hasOpenVote: boolean;
}): boolean {
  return (
    (input.status === LobbyStatus.Open || input.status === LobbyStatus.Ready) &&
    input.participantCount >= input.playerCount &&
    !input.hasOpenVote
  );
}

export function hasDissolutionVotePassed(input: {
  yesCount: number;
  playerCount: number;
}): boolean {
  return input.yesCount >= getDissolutionThreshold(input.playerCount);
}

export function isDissolutionVoteExpired(input: {
  createdAt: Date;
  now: Date;
}): boolean {
  return input.createdAt.getTime() + dissolutionVoteTtlMs <= input.now.getTime();
}

export function canStartGame(input: {
  isHost: boolean;
  participantCount: number;
  playerCount: number;
  scheduledAt: Date | null;
  now: Date;
  hasOpenDissolutionVote: boolean;
}): { ok: true } | { ok: false; code: "HOST_ONLY" | "LOBBY_NOT_FULL" | "START_TOO_EARLY" | "START_TOO_LATE" | "DISSOLUTION_VOTE_OPEN" } {
  if (!input.isHost) {
    return { ok: false, code: "HOST_ONLY" };
  }

  if (input.participantCount < input.playerCount) {
    return { ok: false, code: "LOBBY_NOT_FULL" };
  }

  if (input.hasOpenDissolutionVote) {
    return { ok: false, code: "DISSOLUTION_VOTE_OPEN" };
  }

  if (!input.scheduledAt) {
    return { ok: true };
  }

  const startWindow = input.scheduledAt.getTime() - fifteenMinutesMs;
  const endWindow = input.scheduledAt.getTime() + fifteenMinutesMs;
  const now = input.now.getTime();

  if (now < startWindow) {
    return { ok: false, code: "START_TOO_EARLY" };
  }

  if (now > endWindow) {
    return { ok: false, code: "START_TOO_LATE" };
  }

  return { ok: true };
}

export function canLeaveLobby(input: {
  isHost: boolean;
  status: LobbyStatus;
  participantCount: number;
  playerCount: number;
}): boolean {
  if (input.isHost) {
    return false;
  }

  return input.status === LobbyStatus.Open && input.participantCount < input.playerCount;
}

export function canMarkNoShow(input: {
  isHost: boolean;
  status: LobbyStatus;
  scheduledAt: Date | null;
  now: Date;
}): { ok: true } | { ok: false; code: "HOST_ONLY" | "LOBBY_NOT_SCHEDULED" | "TOO_EARLY_FOR_NO_SHOW" | "LOBBY_ALREADY_STARTED" } {
  if (!input.isHost) {
    return { ok: false, code: "HOST_ONLY" };
  }

  if (input.status === LobbyStatus.GameStarting || input.status === LobbyStatus.InProgress) {
    return { ok: false, code: "LOBBY_ALREADY_STARTED" };
  }

  if (!input.scheduledAt) {
    return { ok: false, code: "LOBBY_NOT_SCHEDULED" };
  }

  if (input.now.getTime() < input.scheduledAt.getTime() - fifteenMinutesMs) {
    return { ok: false, code: "TOO_EARLY_FOR_NO_SHOW" };
  }

  return { ok: true };
}

export function canCancelForMissingPlayers(input: {
  isHost: boolean;
  status: LobbyStatus;
  scheduledAt: Date | null;
  now: Date;
  missingCount: number;
}): { ok: true } | { ok: false; code: "HOST_ONLY" | "LOBBY_NOT_SCHEDULED" | "TOO_EARLY_FOR_MISSING_CANCEL" | "LOBBY_ALREADY_STARTED" | "NO_MISSING_PLAYERS_SELECTED" } {
  if (!input.isHost) {
    return { ok: false, code: "HOST_ONLY" };
  }

  if (input.status === LobbyStatus.GameStarting || input.status === LobbyStatus.InProgress) {
    return { ok: false, code: "LOBBY_ALREADY_STARTED" };
  }

  if (input.missingCount < 1) {
    return { ok: false, code: "NO_MISSING_PLAYERS_SELECTED" };
  }

  if (!input.scheduledAt) {
    return { ok: false, code: "LOBBY_NOT_SCHEDULED" };
  }

  if (input.now.getTime() < input.scheduledAt.getTime()) {
    return { ok: false, code: "TOO_EARLY_FOR_MISSING_CANCEL" };
  }

  return { ok: true };
}

export function shouldExpireIncompleteLobby(input: {
  status: LobbyStatus;
  participantCount: number;
  playerCount: number;
  scheduledAt: Date | null;
  now: Date;
}): boolean {
  if (input.status !== LobbyStatus.Open || !input.scheduledAt) {
    return false;
  }

  if (input.participantCount >= input.playerCount) {
    return false;
  }

  return input.scheduledAt.getTime() <= input.now.getTime() + 60 * 60 * 1000;
}

export function resolvePlayerSlots(
  playerCount: number,
  participants: PlayerSlotParticipant[]
): PlayerSlot[] {
  const joinedParticipants = participants.filter((participant) =>
    isJoinedParticipantStatus(participant.status)
  );

  return Array.from({ length: playerCount }, (_, index) => {
    const participant = joinedParticipants[index];

    return {
      index: index + 1,
      discordId: participant?.discordId ?? null,
      username: participant?.username ?? null
    };
  });
}
