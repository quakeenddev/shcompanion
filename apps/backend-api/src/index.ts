import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { GameMode, GameVariant, LobbyParticipantStatus, LobbyStatus } from "@shc/shared-types";
import {
  canCancelForMissingPlayers,
  canCancelLobby,
  canLeaveLobby,
  canMarkNoShow,
  canStartDissolutionVote,
  canStartGame,
  countJoinedParticipants,
  getDissolutionThreshold,
  hasDissolutionVotePassed,
  isCompetitive,
  isDissolutionVoteExpired,
  parseScheduledAtInput,
  resolveRequestedVariant,
  resolveSeatsLockedAt,
  shouldExpireIncompleteLobby,
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
};

type RequestedByBody = {
  requestedByDiscordId?: unknown;
};

type UpdateScheduleBody = RequestedByBody & {
  scheduledAtInput?: unknown;
};

type DissolutionVoteBody = RequestedByBody & {
  vote?: unknown;
};

type MarkNoShowBody = RequestedByBody & {
  targetDiscordId?: unknown;
};

type CancelMissingPlayersBody = RequestedByBody & {
  missingDiscordIds?: unknown;
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

function jsonError(reply: FastifyReply, statusCode: number, code: string, message = code) {
  return reply.status(statusCode).send({
    success: false,
    error: {
      code,
      message
    }
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

function parseGameVariant(value: unknown): GameVariant | null {
  if (Object.values(GameVariant).includes(value as GameVariant)) {
    return value as GameVariant;
  }

  return null;
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

function isJoinedLobbyParticipant(participant: { status: string }): boolean {
  return participant.status === LobbyParticipantStatus.Joined;
}

function getJoinedParticipants<T extends { status: string }>(participants: T[]): T[] {
  return participants.filter(isJoinedLobbyParticipant);
}

async function expireOpenDissolutionVotesForLobby(lobbyId: string, now = new Date()): Promise<void> {
  const openVotes = await prisma.lobbyDissolutionVote.findMany({
    where: {
      lobbyId,
      status: "OPEN"
    }
  });

  const expiredVoteIds = openVotes
    .filter((vote) => isDissolutionVoteExpired({ createdAt: vote.createdAt, now }))
    .map((vote) => vote.id);

  if (expiredVoteIds.length === 0) {
    return;
  }

  await prisma.lobbyDissolutionVote.updateMany({
    where: {
      id: {
        in: expiredVoteIds
      }
    },
    data: {
      status: "FAILED",
      resolvedAt: now
    }
  });
}

async function serializeLobby(lobbyId: string) {
  await expireOpenDissolutionVotesForLobby(lobbyId);

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
      match: true,
      dissolutionVotes: {
        where: {
          status: "OPEN"
        },
        include: {
          votes: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });
  const joinedParticipants = getJoinedParticipants(lobby.participants);
  const noShowParticipants = lobby.participants.filter((participant) =>
    participant.status === LobbyParticipantStatus.NoShow ||
    participant.status === LobbyParticipantStatus.RemovedNoShow
  );
  const openDissolutionVote = lobby.dissolutionVotes[0];
  const yesCount = openDissolutionVote?.votes.filter((vote) => vote.vote === "YES").length ?? 0;
  const noCount = openDissolutionVote?.votes.filter((vote) => vote.vote === "NO").length ?? 0;

  return {
    id: lobby.id,
    code: lobby.code,
    guildId: lobby.guildId,
    channelId: lobby.channelId,
    discordGuildId: lobby.guildId,
    discordChannelId: lobby.channelId,
    discordMessageId: lobby.discordMessageId,
    mode: lobby.mode,
    variant: lobby.variant,
    playerCount: lobby.maxPlayers,
    status: lobby.status,
    scheduledAt: lobby.scheduledAt?.toISOString() ?? null,
    seatsLockedAt: lobby.seatsLockedAt?.toISOString() ?? null,
    createdByDiscordId: lobby.host.discordId,
    host: {
      discordId: lobby.host.discordId,
      username: lobby.host.displayName
    },
    joinedPlayersCount: joinedParticipants.length,
    participants: lobby.participants.map((participant) => ({
      discordId: participant.user.discordId,
      username: participant.user.displayName,
      status: participant.status,
      joinedAt: participant.joinedAt.toISOString()
    })),
    noShowParticipants: noShowParticipants.map((participant) => ({
      discordId: participant.user.discordId,
      username: participant.user.displayName,
      status: participant.status
    })),
    match: lobby.match
      ? {
          id: lobby.match.id,
          matchCode: lobby.match.code,
          status: lobby.match.status
        }
      : null,
    dissolutionVote: openDissolutionVote
      ? {
          id: openDissolutionVote.id,
          status: openDissolutionVote.status,
          yesCount,
          noCount,
          threshold: getDissolutionThreshold(lobby.maxPlayers),
          startedByDiscordId: openDissolutionVote.startedByDiscordId,
          votes: openDissolutionVote.votes.map((vote) => ({
            discordId: vote.discordId,
            vote: vote.vote
          }))
        }
      : null
  };
}

async function findActiveLobbyForDiscordUser(discordId: string) {
  return prisma.lobby.findFirst({
    where: {
      status: {
        in: ["OPEN", "READY", "GAME_STARTING", "IN_PROGRESS"]
      },
      OR: [
        {
          host: {
            discordId
          }
        },
        {
          participants: {
            some: {
              status: "JOINED",
              user: {
                discordId
              }
            }
          }
        }
      ]
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

async function hasOtherActiveLobby(discordId: string, lobbyId: string): Promise<boolean> {
  const activeLobby = await findActiveLobbyForDiscordUser(discordId);
  return Boolean(activeLobby && activeLobby.id !== lobbyId);
}

function scheduleFormatMessage(): string {
  return "Tarih/saat formati hatali. Dogru format: gun.ay.yil-00.00 orn. 03.06.2026-21.00";
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
      tabletopColor: player.tabletopColor,
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

app.get<{ Params: { discordId: string } }>(
  "/api/v1/users/:discordId/active-lobby",
  async (request, reply) => {
    const lobby = await findActiveLobbyForDiscordUser(request.params.discordId);

    if (!lobby) {
      return jsonError(reply, 404, "NO_ACTIVE_LOBBY");
    }

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.patch<{
  Params: { lobbyId: string };
  Body: { discordChannelId?: unknown; discordMessageId?: unknown };
}>("/api/v1/lobbies/:lobbyId/discord-message", async (request, reply) => {
  const { discordChannelId, discordMessageId } = request.body;

  if (!isNonEmptyString(discordChannelId) || !isNonEmptyString(discordMessageId)) {
    return jsonError(reply, 400, "INVALID_DISCORD_MESSAGE");
  }

  const lobby = await prisma.lobby.findUnique({
    where: {
      id: request.params.lobbyId
    }
  });

  if (!lobby) {
    return jsonError(reply, 404, "LOBBY_NOT_FOUND");
  }

  await prisma.lobby.update({
    where: {
      id: lobby.id
    },
    data: {
      channelId: discordChannelId,
      discordMessageId
    }
  });

  return {
    success: true,
    lobby: await serializeLobby(lobby.id)
  };
});

app.post<{ Params: { lobbyId: string }; Body: RequestedByBody }>(
  "/api/v1/lobbies/:lobbyId/leave",
  async (request, reply) => {
    const { requestedByDiscordId } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    await expireOpenDissolutionVotesForLobby(request.params.lobbyId);

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    const joinedParticipants = getJoinedParticipants(lobby.participants);
    const participant = joinedParticipants.find(
      (candidate) => candidate.user.discordId === requestedByDiscordId
    );

    if (!participant) {
      return jsonError(reply, 404, "NOT_IN_LOBBY");
    }

    if (lobby.host.discordId === requestedByDiscordId) {
      return jsonError(
        reply,
        400,
        "HOST_CANNOT_LEAVE",
        "Host lobiden ayrilamaz. Lobiyi kapatmak icin Oyunu Boz butonunu kullan."
      );
    }

    if (
      !canLeaveLobby({
        isHost: false,
        status: lobby.status as LobbyStatus,
        participantCount: joinedParticipants.length,
        playerCount: lobby.maxPlayers
      })
    ) {
      return jsonError(reply, 400, "LOBBY_LOCKED");
    }

    await prisma.lobbyParticipant.update({
      where: {
        id: participant.id
      },
      data: {
        status: "LEFT",
        leftAt: new Date()
      }
    });

    await prisma.lobbyDissolutionVote.updateMany({
      where: {
        lobbyId: lobby.id,
        status: "OPEN"
      },
      data: {
        status: "CANCELLED",
        resolvedAt: new Date()
      }
    });

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.patch<{ Params: { lobbyId: string }; Body: UpdateScheduleBody }>(
  "/api/v1/lobbies/:lobbyId/schedule",
  async (request, reply) => {
    const { requestedByDiscordId, scheduledAtInput } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    if (!isNonEmptyString(scheduledAtInput)) {
      return jsonError(reply, 400, "INVALID_SCHEDULE_FORMAT", scheduleFormatMessage());
    }

    const scheduledAt = parseScheduledAtInput(scheduledAtInput);

    if (!scheduledAt) {
      return jsonError(reply, 400, "INVALID_SCHEDULE_FORMAT", scheduleFormatMessage());
    }

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    if (lobby.host.discordId !== requestedByDiscordId) {
      return jsonError(reply, 403, "HOST_ONLY");
    }

    if (lobby.status !== "OPEN") {
      return jsonError(reply, 400, "LOBBY_NOT_OPEN");
    }

    await prisma.lobby.update({
      where: {
        id: lobby.id
      },
      data: {
        scheduledAt,
        seatsLockedAt: resolveSeatsLockedAt(scheduledAt)
      }
    });

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post<{ Params: { lobbyId: string }; Body: RequestedByBody }>(
  "/api/v1/lobbies/:lobbyId/cancel",
  async (request, reply) => {
    const { requestedByDiscordId } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: true
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    if (lobby.host.discordId !== requestedByDiscordId) {
      return jsonError(reply, 403, "HOST_ONLY");
    }

    if (lobby.status === "CANCELLED") {
      return jsonError(reply, 409, "LOBBY_ALREADY_CANCELLED");
    }

    if (lobby.status === "EXPIRED") {
      return jsonError(reply, 409, "LOBBY_ALREADY_EXPIRED");
    }

    if (lobby.status === "DISSOLVED") {
      return jsonError(reply, 409, "LOBBY_ALREADY_DISSOLVED");
    }

    if (lobby.status === "CANCELLED_MISSING_PLAYERS") {
      return jsonError(reply, 409, "LOBBY_ALREADY_CANCELLED_MISSING_PLAYERS");
    }

    if (lobby.status === "GAME_STARTING" || lobby.status === "IN_PROGRESS") {
      return jsonError(reply, 409, "LOBBY_ALREADY_IN_PROGRESS");
    }

    if (
      !canCancelLobby({
        status: lobby.status as LobbyStatus,
        participantCount: countJoinedParticipants(lobby.participants as Array<{ status: LobbyParticipantStatus }>),
        playerCount: lobby.maxPlayers,
        scheduledAt: lobby.scheduledAt,
        now: new Date()
      })
    ) {
      return jsonError(
        reply,
        400,
        "CANNOT_CANCEL_WITHIN_ONE_HOUR",
        "Oyuna 1 saatten az kaldigi icin dolu lobi bozulamaz."
      );
    }

    await prisma.lobby.update({
      where: {
        id: lobby.id
      },
      data: {
        status: "CANCELLED"
      }
    });

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post<{ Params: { lobbyId: string }; Body: RequestedByBody }>(
  "/api/v1/lobbies/:lobbyId/dissolution-vote/start",
  async (request, reply) => {
    const { requestedByDiscordId } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: {
          include: {
            user: true
          }
        },
        dissolutionVotes: {
          where: {
            status: "OPEN"
          }
        }
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    const joinedParticipants = getJoinedParticipants(lobby.participants);
    const isParticipant =
      lobby.host.discordId === requestedByDiscordId ||
      joinedParticipants.some((participant) => participant.user.discordId === requestedByDiscordId);

    if (!isParticipant) {
      return jsonError(reply, 403, "NOT_IN_LOBBY", "Bu oylamaya sadece lobi oyunculari katilabilir.");
    }

    if (lobby.status === "GAME_STARTING" || lobby.status === "IN_PROGRESS") {
      return jsonError(reply, 400, "GAME_ALREADY_STARTED");
    }

    if (
      !canStartDissolutionVote({
        status: lobby.status as LobbyStatus,
        participantCount: joinedParticipants.length,
        playerCount: lobby.maxPlayers,
        hasOpenVote: lobby.dissolutionVotes.length > 0
      })
    ) {
      if (lobby.dissolutionVotes.length > 0) {
        return jsonError(reply, 409, "DISSOLUTION_VOTE_ALREADY_OPEN");
      }

      return jsonError(reply, 400, "LOBBY_NOT_FULL");
    }

    await prisma.lobbyDissolutionVote.create({
      data: {
        lobbyId: lobby.id,
        startedByDiscordId: requestedByDiscordId
      }
    });

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post<{ Params: { lobbyId: string }; Body: DissolutionVoteBody }>(
  "/api/v1/lobbies/:lobbyId/dissolution-vote/vote",
  async (request, reply) => {
    const { requestedByDiscordId, vote } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    if (vote !== "YES" && vote !== "NO") {
      return jsonError(reply, 400, "INVALID_DISSOLUTION_VOTE");
    }

    await expireOpenDissolutionVotesForLobby(request.params.lobbyId);

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: {
          include: {
            user: true
          }
        },
        dissolutionVotes: {
          where: {
            status: "OPEN"
          },
          include: {
            votes: true
          },
          take: 1
        }
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    const joinedParticipants = getJoinedParticipants(lobby.participants);
    const isParticipant =
      lobby.host.discordId === requestedByDiscordId ||
      joinedParticipants.some((participant) => participant.user.discordId === requestedByDiscordId);

    if (!isParticipant) {
      return jsonError(reply, 403, "NOT_IN_LOBBY", "Bu oylamaya sadece lobi oyunculari katilabilir.");
    }

    const openVote = lobby.dissolutionVotes[0];

    if (!openVote) {
      return jsonError(reply, 404, "NO_OPEN_DISSOLUTION_VOTE");
    }

    if (joinedParticipants.length < lobby.maxPlayers) {
      await prisma.lobbyDissolutionVote.update({
        where: {
          id: openVote.id
        },
        data: {
          status: "CANCELLED",
          resolvedAt: new Date()
        }
      });
      return jsonError(reply, 400, "LOBBY_NOT_FULL");
    }

    await prisma.lobbyDissolutionVoteRecord.upsert({
      where: {
        lobbyDissolutionVoteId_discordId: {
          lobbyDissolutionVoteId: openVote.id,
          discordId: requestedByDiscordId
        }
      },
      create: {
        lobbyDissolutionVoteId: openVote.id,
        discordId: requestedByDiscordId,
        vote
      },
      update: {
        vote
      }
    });

    const updatedVote = await prisma.lobbyDissolutionVote.findUniqueOrThrow({
      where: {
        id: openVote.id
      },
      include: {
        votes: true
      }
    });
    const yesCount = updatedVote.votes.filter((record) => record.vote === "YES").length;

    if (hasDissolutionVotePassed({ yesCount, playerCount: lobby.maxPlayers })) {
      await prisma.$transaction([
        prisma.lobbyDissolutionVote.update({
          where: {
            id: openVote.id
          },
          data: {
            status: "PASSED",
            resolvedAt: new Date()
          }
        }),
        prisma.lobby.update({
          where: {
            id: lobby.id
          },
          data: {
            status: "DISSOLVED"
          }
        })
      ]);
    }

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post<{ Params: { lobbyId: string }; Body: RequestedByBody }>(
  "/api/v1/lobbies/:lobbyId/start-game",
  async (request, reply) => {
    const { requestedByDiscordId } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: true,
        dissolutionVotes: {
          where: {
            status: "OPEN"
          }
        }
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    if (lobby.status === "GAME_STARTING" || lobby.status === "IN_PROGRESS") {
      return jsonError(reply, 409, "LOBBY_ALREADY_STARTED");
    }

    if (lobby.status !== "OPEN" && lobby.status !== "READY") {
      return jsonError(reply, 400, "LOBBY_NOT_OPEN");
    }

    const joinedParticipants = getJoinedParticipants(lobby.participants);

    const result = canStartGame({
      isHost: lobby.host.discordId === requestedByDiscordId,
      participantCount: joinedParticipants.length,
      playerCount: lobby.maxPlayers,
      scheduledAt: lobby.scheduledAt,
      now: new Date(),
      hasOpenDissolutionVote: lobby.dissolutionVotes.length > 0
    });

    if (!result.ok) {
      const mappedCode: Record<typeof result.code, string> = {
        HOST_ONLY: "HOST_ONLY",
        LOBBY_NOT_FULL: "LOBBY_NOT_FULL",
        START_TOO_EARLY: "START_TOO_EARLY",
        START_TOO_LATE: "START_TOO_LATE",
        DISSOLUTION_VOTE_OPEN: "DISSOLUTION_VOTE_OPEN"
      };
      return jsonError(reply, 400, mappedCode[result.code]);
    }

    await prisma.lobby.update({
      where: {
        id: lobby.id
      },
      data: {
        status: "GAME_STARTING"
      }
    });

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post<{ Params: { lobbyId: string }; Body: MarkNoShowBody }>(
  "/api/v1/lobbies/:lobbyId/participants/no-show",
  async (request, reply) => {
    const { requestedByDiscordId, targetDiscordId } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    if (!isNonEmptyString(targetDiscordId)) {
      return jsonError(reply, 400, "targetDiscordId is required.");
    }

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    const result = canMarkNoShow({
      isHost: lobby.host.discordId === requestedByDiscordId,
      status: lobby.status as LobbyStatus,
      scheduledAt: lobby.scheduledAt,
      now: new Date()
    });

    if (!result.ok) {
      return jsonError(reply, 400, result.code);
    }

    const targetParticipant = lobby.participants.find(
      (participant) =>
        participant.user.discordId === targetDiscordId &&
        participant.status === LobbyParticipantStatus.Joined
    );

    if (!targetParticipant) {
      return jsonError(reply, 404, "TARGET_NOT_IN_LOBBY");
    }

    const now = new Date();

    await prisma.$transaction([
      prisma.lobbyParticipant.update({
        where: {
          id: targetParticipant.id
        },
        data: {
          status: "REMOVED_NO_SHOW",
          leftAt: now
        }
      }),
      prisma.lobbyAuditRecord.create({
        data: {
          lobbyId: lobby.id,
          action: "PARTICIPANT_MARKED_NO_SHOW",
          requestedByDiscordId,
          targetDiscordId,
          payload: {
            timestamp: now.toISOString()
          }
        }
      }),
      prisma.lobbyDissolutionVote.updateMany({
        where: {
          lobbyId: lobby.id,
          status: "OPEN"
        },
        data: {
          status: "CANCELLED",
          resolvedAt: now
        }
      }),
      prisma.lobby.update({
        where: {
          id: lobby.id
        },
        data: {
          status: "OPEN"
        }
      })
    ]);

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post<{ Params: { lobbyId: string }; Body: CancelMissingPlayersBody }>(
  "/api/v1/lobbies/:lobbyId/cancel-missing-players",
  async (request, reply) => {
    const { requestedByDiscordId, missingDiscordIds } = request.body;

    if (!isNonEmptyString(requestedByDiscordId)) {
      return jsonError(reply, 400, "requestedByDiscordId is required.");
    }

    const normalizedMissingDiscordIds = Array.isArray(missingDiscordIds)
      ? [...new Set(missingDiscordIds.filter(isNonEmptyString))]
      : [];

    const lobby = await prisma.lobby.findUnique({
      where: {
        id: request.params.lobbyId
      },
      include: {
        host: true,
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    if (!lobby) {
      return jsonError(reply, 404, "LOBBY_NOT_FOUND");
    }

    if (lobby.status === "CANCELLED_MISSING_PLAYERS") {
      return jsonError(reply, 409, "LOBBY_ALREADY_CANCELLED_MISSING_PLAYERS");
    }

    const result = canCancelForMissingPlayers({
      isHost: lobby.host.discordId === requestedByDiscordId,
      status: lobby.status as LobbyStatus,
      scheduledAt: lobby.scheduledAt,
      now: new Date(),
      missingCount: normalizedMissingDiscordIds.length
    });

    if (!result.ok) {
      return jsonError(reply, 400, result.code);
    }

    const missingParticipants = lobby.participants.filter(
      (participant) =>
        normalizedMissingDiscordIds.includes(participant.user.discordId) &&
        participant.status === LobbyParticipantStatus.Joined
    );

    if (missingParticipants.length !== normalizedMissingDiscordIds.length) {
      return jsonError(reply, 404, "TARGET_NOT_IN_LOBBY");
    }

    const now = new Date();

    await prisma.$transaction([
      ...missingParticipants.map((participant) =>
        prisma.lobbyParticipant.update({
          where: {
            id: participant.id
          },
          data: {
            status: "REMOVED_NO_SHOW",
            leftAt: now
          }
        })
      ),
      ...missingParticipants.map((participant) =>
        prisma.report.create({
          data: {
            matchId: null,
            lobbyId: lobby.id,
            reporterUserId: lobby.hostUserId,
            reportedUserId: participant.userId,
            category: "NO_SHOW",
            description: "Eksik katilim nedeniyle oyun dagildi."
          }
        })
      ),
      ...missingParticipants.map((participant) =>
        prisma.lobbyAuditRecord.create({
          data: {
            lobbyId: lobby.id,
            action: "MISSING_PLAYER_REPORTED",
            requestedByDiscordId,
            targetDiscordId: participant.user.discordId,
            payload: {
              timestamp: now.toISOString()
            }
          }
        })
      ),
      prisma.lobbyDissolutionVote.updateMany({
        where: {
          lobbyId: lobby.id,
          status: "OPEN"
        },
        data: {
          status: "CANCELLED",
          resolvedAt: now
        }
      }),
      prisma.lobby.update({
        where: {
          id: lobby.id
        },
        data: {
          status: "CANCELLED_MISSING_PLAYERS"
        }
      })
    ]);

    return {
      success: true,
      lobby: await serializeLobby(lobby.id)
    };
  }
);

app.post("/api/v1/lobbies/expire-stale", async () => {
  const now = new Date();
  const lobbies = await prisma.lobby.findMany({
    where: {
      status: "OPEN",
      scheduledAt: {
        not: null,
        lte: new Date(now.getTime() + 60 * 60 * 1000)
      }
    },
    include: {
      participants: true
    }
  });

  const expirable = lobbies.filter((lobby) =>
    shouldExpireIncompleteLobby({
      status: lobby.status as LobbyStatus,
      participantCount: countJoinedParticipants(lobby.participants as Array<{ status: LobbyParticipantStatus }>),
      playerCount: lobby.maxPlayers,
      scheduledAt: lobby.scheduledAt,
      now
    })
  );

  await Promise.all(
    expirable.map((lobby) =>
      prisma.lobby.update({
        where: {
          id: lobby.id
        },
        data: {
          status: "EXPIRED"
        }
      })
    )
  );

  return {
    success: true,
    expired: await Promise.all(expirable.map((lobby) => serializeLobby(lobby.id)))
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
  const parsedScheduledAt = scheduledAt === undefined ? null : isNonEmptyString(scheduledAt) ? parseScheduledAtInput(scheduledAt) : null;

  if (!isNonEmptyString(guildId)) {
    return jsonError(reply, 400, "guildId is required.");
  }

  if (!isNonEmptyString(channelId)) {
    return jsonError(reply, 400, "channelId is required.");
  }

  if (!isNonEmptyString(createdByDiscordId)) {
    return jsonError(reply, 400, "createdByDiscordId is required.");
  }

  const activeLobby = await findActiveLobbyForDiscordUser(createdByDiscordId);

  if (activeLobby) {
    return jsonError(reply, 409, "ACTIVE_LOBBY_EXISTS");
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

  if (scheduledAt !== undefined && !parsedScheduledAt) {
    return jsonError(reply, 400, "INVALID_SCHEDULE_FORMAT", scheduleFormatMessage());
  }

  const hostUser = await upsertUser(createdByDiscordId);
  let resolvedVariant: GameVariant;

  try {
    resolvedVariant = resolveRequestedVariant(parsedMode, playerCount, parsedVariant ?? undefined);
  } catch {
    return jsonError(reply, 400, "INVALID_GAME_VARIANT");
  }
  const seatsLockedAt = parsedScheduledAt ? resolveSeatsLockedAt(parsedScheduledAt) : null;

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
    const { discordId, username } = request.body;

    if (!isNonEmptyString(discordId)) {
      return jsonError(reply, 400, "discordId is required.");
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

    if (await hasOtherActiveLobby(discordId, lobbyId)) {
      return jsonError(reply, 409, "ACTIVE_LOBBY_EXISTS");
    }

    const user = await upsertUser(discordId, username);
    const existingParticipant = lobby.participants.find((participant) => participant.userId === user.id);
    const joinedParticipants = getJoinedParticipants(lobby.participants);

    if (existingParticipant?.status === LobbyParticipantStatus.Joined) {
      return jsonError(reply, 409, "USER_ALREADY_JOINED");
    }

    if (joinedParticipants.length >= lobby.maxPlayers) {
      return jsonError(reply, 400, "LOBBY_FULL");
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

    if (existingParticipant) {
      await prisma.lobbyParticipant.update({
        where: {
          id: existingParticipant.id
        },
        data: {
          status: "JOINED",
          joinedAt: new Date(),
          leftAt: null
        }
      });
    } else {
      await prisma.lobbyParticipant.create({
        data: {
          lobbyId,
          userId: user.id
        }
      });
    }

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
      return jsonError(reply, 409, "MATCH_ALREADY_CREATED");
    }

    if (lobby.status === "GAME_STARTING" || lobby.status === "IN_PROGRESS") {
      return jsonError(reply, 409, "LOBBY_ALREADY_STARTED");
    }

    const joinedParticipants = getJoinedParticipants(lobby.participants);

    if (joinedParticipants.length < lobby.maxPlayers) {
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
          status: "CREATED"
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
