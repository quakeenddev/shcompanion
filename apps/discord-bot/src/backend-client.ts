import { GameMode, GameVariant, LobbyParticipantStatus, LobbyStatus } from "@shc/shared-types";

export type LobbyParticipantView = {
  discordId: string;
  username?: string | null;
  status: LobbyParticipantStatus;
  joinedAt: string;
};

export type LobbyView = {
  id: string;
  code: string;
  guildId: string;
  channelId: string;
  discordGuildId: string;
  discordChannelId: string;
  discordMessageId?: string | null;
  mode: GameMode;
  variant: GameVariant;
  playerCount: number;
  status: LobbyStatus;
  scheduledAt: string | null;
  seatsLockedAt: string | null;
  createdByDiscordId: string;
  host: {
    discordId: string;
    username?: string | null;
  };
  joinedPlayersCount: number;
  participants: LobbyParticipantView[];
  noShowParticipants: Array<{
    discordId: string;
    username?: string | null;
    status: LobbyParticipantStatus;
  }>;
  match: {
    id: string;
    matchCode: string;
    status: string;
  } | null;
  dissolutionVote: {
    id: string;
    status: string;
    yesCount: number;
    noCount: number;
    threshold: number;
    startedByDiscordId: string;
    votes: Array<{
      discordId: string;
      vote: "YES" | "NO";
    }>;
  } | null;
};

export type CompactLobbyView = {
  id: string;
  mode: GameMode;
  playerCount: number;
  status: LobbyStatus;
  createdByDiscordId: string;
  createdByUsername?: string | null;
  scheduledAt: string | null;
  participantCount: number;
  participants: LobbyParticipantView[];
  discordChannelId: string;
  discordMessageId?: string | null;
  matchCode?: string | null;
};

type SuccessResponse<T> = {
  success: true;
} & T;

type ErrorResponse = {
  success: false;
  error:
    | string
    | {
        code: string;
        message: string;
      };
};

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown
  ) {
    super(message);
  }
}

export class BackendNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown
  ) {
    super(message);
  }
}

export class BackendResponseShapeError extends Error {
  constructor(
    message: string,
    public readonly responseBody: unknown
  ) {
    super(message);
  }
}

export class BackendClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string
  ) {}

  async registerSteam64Id(input: {
    discordId: string;
    steam64Id: string;
    username?: string;
  }): Promise<void> {
    await this.request<SuccessResponse<Record<string, never>>>(
      `/users/${input.discordId}/steam`,
      {
        method: "POST",
        body: {
          steam64Id: input.steam64Id,
          username: input.username
        }
      }
    );
  }

  async createLobby(input: {
    guildId: string;
    channelId: string;
    createdByDiscordId: string;
    mode: GameMode;
    playerCount: number;
    variant?: GameVariant;
    scheduledAt?: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>("/lobbies", {
      method: "POST",
      body: input
    });

    return assertLobbyView(response.lobby);
  }

  async getActiveLobby(discordId: string): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/users/${discordId}/active-lobby`,
      {
        method: "GET"
      }
    );

    return assertLobbyView(response.lobby);
  }

  async updateLobbyDiscordMessage(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    discordChannelId: string;
    discordMessageId: string;
    moderator?: boolean;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/message`,
      {
        method: "PATCH",
        body: {
          requestedByDiscordId: input.requestedByDiscordId,
          discordChannelId: input.discordChannelId,
          discordMessageId: input.discordMessageId,
          moderator: input.moderator
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async getLobby(lobbyId: string): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${lobbyId}`,
      {
        method: "GET"
      }
    );

    return assertLobbyView(response.lobby);
  }

  async joinLobby(input: {
    lobbyId: string;
    discordId: string;
    username?: string;
  }): Promise<void> {
    await this.request<SuccessResponse<Record<string, unknown>>>(
      `/lobbies/${input.lobbyId}/participants`,
      {
        method: "POST",
        body: {
          discordId: input.discordId,
          username: input.username
        }
      }
    );
  }

  async leaveLobby(input: {
    lobbyId: string;
    requestedByDiscordId: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/leave`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async updateLobbySchedule(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    scheduledAtInput: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/schedule`,
      {
        method: "PATCH",
        body: {
          requestedByDiscordId: input.requestedByDiscordId,
          scheduledAtInput: input.scheduledAtInput
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async cancelLobby(input: {
    lobbyId: string;
    requestedByDiscordId: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/cancel`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async startDissolutionVote(input: {
    lobbyId: string;
    requestedByDiscordId: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/dissolution-vote/start`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async castDissolutionVote(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    vote: "YES" | "NO";
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/dissolution-vote/vote`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId,
          vote: input.vote
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async startGame(input: {
    lobbyId: string;
    requestedByDiscordId: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/start-game`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async markNoShow(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    targetDiscordId: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/participants/no-show`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId,
          targetDiscordId: input.targetDiscordId
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async cancelMissingPlayers(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    missingDiscordIds: string[];
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/lobbies/${input.lobbyId}/cancel-missing-players`,
      {
        method: "POST",
        body: {
          requestedByDiscordId: input.requestedByDiscordId,
          missingDiscordIds: input.missingDiscordIds
        }
      }
    );

    return assertLobbyView(response.lobby);
  }

  async expireStaleLobbies(): Promise<LobbyView[]> {
    const response = await this.request<SuccessResponse<{ expired: unknown[] }>>(
      "/lobbies/expire-stale",
      {
        method: "POST"
      }
    );

    return response.expired.map(assertLobbyView);
  }

  async createMatch(lobbyId: string): Promise<string> {
    const response = await this.request<SuccessResponse<{ matchCode: string }>>(
      `/lobbies/${lobbyId}/match`,
      {
        method: "POST"
      }
    );

    return response.matchCode;
  }

  async listModeratorLobbies(status?: string): Promise<CompactLobbyView[]> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    const response = await this.request<SuccessResponse<{ lobbies: unknown[] }>>(
      `/mod/lobbies${suffix}`,
      {
        method: "GET"
      }
    );

    return response.lobbies.map(assertCompactLobbyView);
  }

  async getModeratorActiveLobby(discordId: string): Promise<LobbyView | null> {
    const response = await this.request<SuccessResponse<{ lobby: unknown | null }>>(
      `/mod/users/${discordId}/active-lobby`,
      {
        method: "GET"
      }
    );

    return response.lobby ? assertLobbyView(response.lobby) : null;
  }

  async moderatorRemoveParticipant(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    targetDiscordId: string;
    reason?: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/mod/lobbies/${input.lobbyId}/participants/remove`,
      {
        method: "POST",
        body: input
      }
    );

    return assertLobbyView(response.lobby);
  }

  async moderatorVoidLobby(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    reason?: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/mod/lobbies/${input.lobbyId}/void`,
      {
        method: "POST",
        body: input
      }
    );

    return assertLobbyView(response.lobby);
  }

  async moderatorReleaseLobby(input: {
    lobbyId: string;
    requestedByDiscordId: string;
    reason?: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>(
      `/mod/lobbies/${input.lobbyId}/release`,
      {
        method: "POST",
        body: input
      }
    );

    return assertLobbyView(response.lobby);
  }

  getRequestUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "PATCH";
      body?: unknown;
    }
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { "X-Bot-Api-Key": this.apiKey } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      console.error("Backend network request failed", {
        method: options.method,
        path,
        url: this.getRequestUrl(path),
        error
      });
      throw new BackendNetworkError("Backend network request failed.", error);
    }

    const text = await response.text();
    const data = parseJsonResponse(text);

    if (!response.ok || isErrorResponse(data)) {
      console.error("Backend returned an error response", {
        method: options.method,
        path,
        url: this.getRequestUrl(path),
        status: response.status,
        responseBody: data
      });

      const message = isErrorResponse(data)
        ? typeof data.error === "string"
          ? data.error
          : data.error.code
        : "Backend request failed.";
      throw new BackendError(message, response.status, data);
    }

    return data as T;
  }
}

function parseJsonResponse(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new BackendResponseShapeError("Backend returned invalid JSON.", {
      text,
      error
    });
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === false &&
    "error" in value &&
    (typeof value.error === "string" ||
      (typeof value.error === "object" &&
        value.error !== null &&
        "code" in value.error &&
        typeof value.error.code === "string" &&
        "message" in value.error &&
        typeof value.error.message === "string"))
  );
}

function assertLobbyView(value: unknown): LobbyView {
  if (!isLobbyView(value)) {
    throw new BackendResponseShapeError("Backend lobby response shape is invalid.", value);
  }

  return value;
}

function assertCompactLobbyView(value: unknown): CompactLobbyView {
  if (!isCompactLobbyView(value)) {
    throw new BackendResponseShapeError("Backend compact lobby response shape is invalid.", value);
  }

  return value;
}

function isLobbyView(value: unknown): value is LobbyView {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const lobby = value as Partial<LobbyView>;

  return (
    typeof lobby.id === "string" &&
    typeof lobby.code === "string" &&
    typeof lobby.guildId === "string" &&
    typeof lobby.channelId === "string" &&
    typeof lobby.discordGuildId === "string" &&
    typeof lobby.discordChannelId === "string" &&
    Object.values(GameMode).includes(lobby.mode as GameMode) &&
    Object.values(GameVariant).includes(lobby.variant as GameVariant) &&
    typeof lobby.playerCount === "number" &&
    Object.values(LobbyStatus).includes(lobby.status as LobbyStatus) &&
    (typeof lobby.scheduledAt === "string" || lobby.scheduledAt === null) &&
    (typeof lobby.seatsLockedAt === "string" || lobby.seatsLockedAt === null) &&
    typeof lobby.createdByDiscordId === "string" &&
    typeof lobby.host === "object" &&
    lobby.host !== null &&
    typeof lobby.host.discordId === "string" &&
    typeof lobby.joinedPlayersCount === "number" &&
    Array.isArray(lobby.participants) &&
    lobby.participants.every(isLobbyParticipantView) &&
    Array.isArray(lobby.noShowParticipants) &&
    lobby.noShowParticipants.every(isLobbyNoShowParticipantView) &&
    isLobbyDissolutionVoteView(lobby.dissolutionVote)
  );
}

function isLobbyParticipantView(value: unknown): value is LobbyParticipantView {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const participant = value as Partial<LobbyParticipantView>;

  return (
    typeof participant.discordId === "string" &&
    Object.values(LobbyParticipantStatus).includes(participant.status as LobbyParticipantStatus) &&
    typeof participant.joinedAt === "string"
  );
}

function isCompactLobbyView(value: unknown): value is CompactLobbyView {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const lobby = value as Partial<CompactLobbyView>;

  return (
    typeof lobby.id === "string" &&
    Object.values(GameMode).includes(lobby.mode as GameMode) &&
    typeof lobby.playerCount === "number" &&
    Object.values(LobbyStatus).includes(lobby.status as LobbyStatus) &&
    typeof lobby.createdByDiscordId === "string" &&
    (typeof lobby.scheduledAt === "string" || lobby.scheduledAt === null) &&
    typeof lobby.participantCount === "number" &&
    Array.isArray(lobby.participants) &&
    lobby.participants.every(isLobbyParticipantView) &&
    typeof lobby.discordChannelId === "string"
  );
}

function isLobbyNoShowParticipantView(value: unknown): value is LobbyView["noShowParticipants"][number] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const participant = value as Partial<LobbyView["noShowParticipants"][number]>;

  return (
    typeof participant.discordId === "string" &&
    Object.values(LobbyParticipantStatus).includes(participant.status as LobbyParticipantStatus)
  );
}

function isLobbyDissolutionVoteView(value: unknown): value is LobbyView["dissolutionVote"] {
  if (value === null) {
    return true;
  }

  if (typeof value !== "object") {
    return false;
  }

  const vote = value as Partial<NonNullable<LobbyView["dissolutionVote"]>>;

  return (
    typeof vote.id === "string" &&
    typeof vote.status === "string" &&
    typeof vote.yesCount === "number" &&
    typeof vote.noCount === "number" &&
    typeof vote.threshold === "number" &&
    typeof vote.startedByDiscordId === "string" &&
    Array.isArray(vote.votes) &&
    vote.votes.every(
      (record) =>
        typeof record.discordId === "string" &&
        (record.vote === "YES" || record.vote === "NO")
    )
  );
}
