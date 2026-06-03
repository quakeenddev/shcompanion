import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { GameMode, GameVariant, PlayerColor } from "@shc/shared-types";
import {
  isCompetitive,
  resolveRequestedVariant,
  validateGameModePlayerCount
} from "@shc/game-rules";
import Fastify, { type FastifyReply } from "fastify";
import { getBackendEnv } from "./env.js";
import { appendMatchEvent, validateMatchEventPayloadBasicForRequest } from "./match-events.js";
import { prisma } from "./prisma.js";

const { host, port } = getBackendEnv();

const app = Fastify({
  logger: true
});

app.setErrorHandler((error, _request, reply) => {
  if (isPrismaInitializationError(error)) {
    return jsonError(
      reply,
      503,
      "Database is unavailable. Start PostgreSQL and run Prisma migrations before using this endpoint."
    );
  }

  if (isPrismaUniqueConstraintError(error)) {
    return jsonError(reply, 409, "A record with this unique value already exists.");
  }

  app.log.error(error);
  return jsonError(reply, 500, "Internal server error.");
});

type SteamRegistrationBody = {
  steam64Id?: unknown;
  username?: unknown;
};

type CreateLobbyBody = {
  guildId?: unknown;
  channelId?: unknown;
  createdByDiscordId?: unknown;
  mode?: unknown;
  playerCount?: unknown;
  variant?: unknown;
  scheduledAt?: unknown;
};

type JoinLobbyBody = {
  discordId?: unknown;
  username?: unknown;
  selectedColor?: unknown;
};

type AppendMatchEventBody = {
  clientEventId?: unknown;
  type?: unknown;
  roundIndex?: unknown;
  actorUserId?: unknown;
  actorColor?: unknown;
  source?: unknown;
  trustWeight?: unknown;
  payload?: unknown;
};

function jsonError(reply: FastifyReply, statusCode: number, message: string) {
  return reply.status(statusCode).send({
    success: false,
    error: message
  });
}

function isPrismaInitializationError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseGameMode(value: unknown): GameMode | null {
  if (Object.values(GameMode).includes(value as GameMode)) {
    return value as GameMode;
  }

  return null;
}

function parsePlayerColor(value: unknown): PlayerColor | null {
  if (Object.values(PlayerColor).includes(value as PlayerColor)) {
    return value as PlayerColor;
  }

  return null;
}

function parseGameVariant(value: unknown): GameVariant | null {
  if (Object.values(GameVariant).includes(value as GameVariant)) {
    return value as GameVariant;
  }

  return null;
}

function parseScheduledAt(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T")
    : value;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function resolveSeatsLockedAt(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() - 60 * 60 * 1000);
}

async function upsertUser(discordId: string, username?: unknown) {
  const displayName = isNonEmptyString(username) ? username : undefined;

  return prisma.user.upsert({
    where: {
      discordId
    },
    create: {
      discordId,
      displayName
    },
    update: {
      ...(displayName ? { displayName } : {})
    }
  });
}

async function serializeLobby(lobbyId: string) {
  const lobby = await prisma.lobby.findUniqueOrThrow({
    where: {
      id: lobbyId
    },
    include: {
      host: true,
      participants: {
        include: {
          user: true
        },
        orderBy: {
          joinedAt: "asc"
        }
      },
      match: true
    }
  });

  return {
    id: lobby.id,
    code: lobby.code,
    guildId: lobby.guildId,
    channelId: lobby.channelId,
    mode: lobby.mode,
    variant: lobby.variant,
    playerCount: lobby.maxPlayers,
    status: lobby.status,
    scheduledAt: lobby.scheduledAt.toISOString(),
    seatsLockedAt: lobby.seatsLockedAt.toISOString(),
    createdByDiscordId: lobby.host.discordId,
    host: {
      discordId: lobby.host.discordId,
      username: lobby.host.displayName
    },
    joinedPlayersCount: lobby.participants.length,
    participants: lobby.participants.map((participant) => ({
      discordId: participant.user.discordId,
      username: participant.user.displayName,
      selectedColor: participant.selectedColor
    })),
    match: lobby.match
      ? {
          id: lobby.match.id,
          matchCode: lobby.match.code,
          status: lobby.match.status
        }
      : null
  };
}

function serializeMatchEvent(event: {
  id: string;
  matchId: string;
  clientEventId: string;
  type: string;
  roundIndex: number | null;
  actorUserId: string | null;
  actorColor: string | null;
  source: string;
  trustWeight: string;
  payload: unknown;
  createdAt: Date;
}) {
  return {
    id: event.id,
    matchId: event.matchId,
    clientEventId: event.clientEventId,
    type: event.type,
    roundIndex: event.roundIndex,
    actorUserId: event.actorUserId,
    actorColor: event.actorColor,
    source: event.source,
    trustWeight: event.trustWeight,
    payload: event.payload,
    createdAt: event.createdAt.toISOString()
  };
}

async function serializeMatch(matchId: string) {
  const match = await prisma.match.findUniqueOrThrow({
    where: {
      id: matchId
    },
    include: {
      lobby: {
        include: {
          host: true
        }
      },
      players: {
        include: {
          user: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      _count: {
        select: {
          events: true
        }
      }
    }
  });

  return {
    id: match.id,
    code: match.code,
    mode: match.mode,
    variant: match.variant,
    playerCount: match.playerCount,
    status: match.status,
    reviewStatus: match.reviewStatus,
    scheduledAt: match.scheduledAt?.toISOString() ?? null,
    seatsLockedAt: match.seatsLockedAt?.toISOString() ?? null,
    startedAt: match.startedAt?.toISOString() ?? null,
    completedAt: match.completedAt?.toISOString() ?? null,
    createdAt: match.createdAt.toISOString(),
    lobby: match.lobby
      ? {
          id: match.lobby.id,
          code: match.lobby.code,
          status: match.lobby.status,
          guildId: match.lobby.guildId,
          channelId: match.lobby.channelId,
          hostDiscordId: match.lobby.host.discordId
        }
      : null,
    players: match.players.map((player) => ({
      userId: player.userId,
      discordId: player.user.discordId,
      username: player.user.displayName,
      startingColor: player.startingColor,
      endingColor: player.endingColor,
      seatLockedAt: player.seatLockedAt?.toISOString() ?? null
    })),
    eventsCount: match._count.events
  };
}

function generateLobbyCode(): string {
  return `LB-${randomBytes(2).toString("hex").toUpperCase()}`;
}

function generateMatchCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from({ length: 4 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");

  return `SH-${suffix}`;
}

async function createUniqueMatchCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateMatchCode();
    const existing = await prisma.match.findUnique({
      where: {
        code
      }
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error("Unable to generate a unique match code.");
}

app.get("/health", async () => {
  return {
    status: "ok",
    service: "backend-api"
  };
});

app.get<{ Params: { lobbyId: string } }>("/api/v1/lobbies/:lobbyId", async (request, reply) => {
  const lobby = await prisma.lobby.findUnique({
    where: {
      id: request.params.lobbyId
    }
  });

  if (!lobby) {
    return jsonError(reply, 404, "LOBBY_NOT_FOUND");
  }

  return {
    success: true,
    lobby: await serializeLobby(lobby.id)
  };
});

app.get<{ Params: { matchId: string } }>("/api/v1/matches/:matchId", async (request, reply) => {
  const match = await prisma.match.findUnique({
    where: {
      id: request.params.matchId
    }
  });

  if (!match) {
    return jsonError(reply, 404, "MATCH_NOT_FOUND");
  }

  return {
    success: true,
    match: await serializeMatch(match.id)
  };
});

app.get<{ Params: { matchId: string } }>(
  "/api/v1/matches/:matchId/events",
  async (request, reply) => {
    const match = await prisma.match.findUnique({
      where: {
        id: request.params.matchId
      },
      select: {
        id: true
      }
    });

    if (!match) {
      return jsonError(reply, 404, "MATCH_NOT_FOUND");
    }

    const events = await prisma.matchEvent.findMany({
      where: {
        matchId: match.id
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return {
      success: true,
      events: events.map(serializeMatchEvent)
    };
  }
);

app.post<{ Params: { matchId: string }; Body: AppendMatchEventBody }>(
  "/api/v1/matches/:matchId/events",
  async (request, reply) => {
    const match = await prisma.match.findUnique({
      where: {
        id: request.params.matchId
      },
      select: {
        id: true
      }
    });

    if (!match) {
      return jsonError(reply, 404, "MATCH_NOT_FOUND");
    }

    const validation = validateMatchEventPayloadBasicForRequest(match.id, request.body);

    if (!validation.ok) {
      return jsonError(reply, 400, validation.message);
    }

    const result = await appendMatchEvent(validation.value);

    return reply.status(result.duplicated ? 200 : 201).send({
      success: true,
      duplicated: result.duplicated,
      event: serializeMatchEvent(result.event)
    });
  }
);

app.post<{ Params: { discordId: string }; Body: SteamRegistrationBody }>(
  "/api/v1/users/:discordId/steam",
  async (request, reply) => {
    const { discordId } = request.params;
    const { steam64Id, username } = request.body;

    if (!isNonEmptyString(discordId)) {
      return jsonError(reply, 400, "discordId is required.");
    }

    if (!isNonEmptyString(steam64Id) || !/^\d+$/.test(steam64Id)) {
      return jsonError(reply, 400, "steam64Id must be numeric.");
    }

    const existingOwner = await prisma.steamIdentity.findUnique({
      where: {
        steam64Id
      },
      include: {
        user: true
      }
    });

    if (existingOwner && existingOwner.user.discordId !== discordId) {
      return jsonError(reply, 409, "This Steam64 ID is already registered by another Discord user.");
    }

    const user = await upsertUser(discordId, username);

    const steamIdentity = await prisma.steamIdentity.upsert({
      where: {
        userId: user.id
      },
      create: {
        userId: user.id,
        steam64Id
      },
      update: {
        steam64Id
      }
    });

    return {
      success: true,
      user: {
        discordId: user.discordId,
        username: user.displayName
      },
      steamIdentity: {
        steam64Id: steamIdentity.steam64Id
      }
    };
  }
);

app.post<{ Body: CreateLobbyBody }>("/api/v1/lobbies", async (request, reply) => {
  const { guildId, channelId, createdByDiscordId, mode, playerCount, variant, scheduledAt } = request.body;
  const parsedMode = parseGameMode(mode);
  const parsedVariant = variant === undefined ? undefined : parseGameVariant(variant);
  const parsedScheduledAt = parseScheduledAt(scheduledAt);

  if (!isNonEmptyString(guildId)) {
    return jsonError(reply, 400, "guildId is required.");
  }

  if (!isNonEmptyString(channelId)) {
    return jsonError(reply, 400, "channelId is required.");
  }

  if (!isNonEmptyString(createdByDiscordId)) {
    return jsonError(reply, 400, "createdByDiscordId is required.");
  }

  if (!parsedMode) {
    return jsonError(reply, 400, "mode must be TRAINING, CASUAL, or COMPETITIVE.");
  }

  if (typeof playerCount !== "number" || !validateGameModePlayerCount(parsedMode, playerCount)) {
    return jsonError(reply, 400, "playerCount is not allowed for the selected mode.");
  }

  if (variant !== undefined && !parsedVariant) {
    return jsonError(reply, 400, "INVALID_GAME_VARIANT");
  }

  if (!parsedScheduledAt) {
    return jsonError(reply, 400, "scheduledAt must be a valid date/time.");
  }

  const hostUser = await upsertUser(createdByDiscordId);
  let resolvedVariant: GameVariant;

  try {
    resolvedVariant = resolveRequestedVariant(parsedMode, playerCount, parsedVariant ?? undefined);
  } catch {
    return jsonError(reply, 400, "INVALID_GAME_VARIANT");
  }
  const seatsLockedAt = resolveSeatsLockedAt(parsedScheduledAt);

  const lobby = await prisma.lobby.create({
    data: {
      code: generateLobbyCode(),
      guildId,
      channelId,
      mode: parsedMode,
      variant: resolvedVariant,
      maxPlayers: playerCount,
      scheduledAt: parsedScheduledAt,
      seatsLockedAt,
      hostUserId: hostUser.id
    }
  });

  return {
    success: true,
    lobby: await serializeLobby(lobby.id)
  };
});

app.post<{ Params: { lobbyId: string }; Body: JoinLobbyBody }>(
  "/api/v1/lobbies/:lobbyId/participants",
  async (request, reply) => {
    const { lobbyId } = request.params;
    const { discordId, username, selectedColor } = request.body;
    const parsedColor = parsePlayerColor(selectedColor);

    if (!isNonEmptyString(discordId)) {
      return jsonError(reply, 400, "discordId is required.");
    }

    if (!parsedColor) {
      return jsonError(reply, 400, "selectedColor is invalid.");
    }

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: lobbyId
      },
      include: {
        participants: true
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    if (lobby.status !== "OPEN") {
      return jsonError(reply, 400, "LOBBY_NOT_OPEN");
    }

    if (Date.now() >= lobby.seatsLockedAt.getTime()) {
      return jsonError(reply, 400, "SEATS_LOCKED");
    }

    if (lobby.participants.length >= lobby.maxPlayers) {
      return jsonError(reply, 400, "LOBBY_FULL");
    }

    if (lobby.participants.some((participant) => participant.selectedColor === parsedColor)) {
      return jsonError(reply, 409, "COLOR_TAKEN");
    }

    const user = await upsertUser(discordId, username);

    if (lobby.participants.some((participant) => participant.userId === user.id)) {
      return jsonError(reply, 409, "USER_ALREADY_JOINED");
    }

    if (isCompetitive(lobby.mode as GameMode)) {
      const steamIdentity = await prisma.steamIdentity.findUnique({
        where: {
          userId: user.id
        }
      });

      if (!steamIdentity) {
        return jsonError(reply, 403, "STEAM_ID_REQUIRED");
      }
    }

    await prisma.lobbyParticipant.create({
      data: {
        lobbyId,
        userId: user.id,
        selectedColor: parsedColor
      }
    });

    return {
      success: true,
      lobby: await serializeLobby(lobbyId)
    };
  }
);

app.post<{ Params: { lobbyId: string } }>(
  "/api/v1/lobbies/:lobbyId/match",
  async (request, reply) => {
    const { lobbyId } = request.params;

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: lobbyId
      },
      include: {
        participants: true,
        match: true
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    if (lobby.match) {
      return jsonError(reply, 409, "Match has already been created for this lobby.");
    }

    if (lobby.participants.length < lobby.maxPlayers) {
      return jsonError(reply, 400, "LOBBY_NOT_FULL");
    }

    const matchCode = await createUniqueMatchCode();

    await prisma.$transaction(async (tx) => {
      await tx.match.create({
        data: {
          lobbyId: lobby.id,
          code: matchCode,
          mode: lobby.mode,
          variant: lobby.variant,
          playerCount: lobby.maxPlayers,
          scheduledAt: lobby.scheduledAt,
          seatsLockedAt: lobby.seatsLockedAt,
          status: "CREATED",
          players: {
            create: lobby.participants.map((participant) => ({
              userId: participant.userId,
              startingColor: participant.selectedColor
            }))
          }
        }
      });

      await tx.lobby.update({
        where: {
          id: lobby.id
        },
        data: {
          status: "READY"
        }
      });
    });

    return {
      success: true,
      lobby: await serializeLobby(lobbyId),
      matchCode
    };
  }
);

await app.listen({ host, port });
