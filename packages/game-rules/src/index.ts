import { GameMode, GameVariant } from "@shc/shared-types";

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
