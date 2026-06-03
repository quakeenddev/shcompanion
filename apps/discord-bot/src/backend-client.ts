import { GameMode, GameVariant, LobbyStatus, PlayerColor } from "@shc/shared-types";

export type LobbyParticipantView = {
  discordId: string;
  username?: string | null;
  selectedColor: PlayerColor;
  status?: string;
};

export type LobbyView = {
  id: string;
  code: string;
  guildId: string;
  channelId: string;
  mode: GameMode;
  variant: GameVariant;
  playerCount: number;
  status: LobbyStatus;
  scheduledAt: string;
  seatsLockedAt: string;
  createdByDiscordId: string;
  host: {
    discordId: string;
    username?: string | null;
  };
  joinedPlayersCount: number;
  participants: LobbyParticipantView[];
  match: {
    id: string;
    matchCode: string;
    status: string;
  } | null;
};

type SuccessResponse<T> = {
  success: true;
} & T;

type ErrorResponse = {
  success: false;
  error: string;
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
    scheduledAt: string;
  }): Promise<LobbyView> {
    const response = await this.request<SuccessResponse<{ lobby: unknown }>>("/lobbies", {
      method: "POST",
      body: input
    });

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
    selectedColor: PlayerColor;
  }): Promise<void> {
    await this.request<SuccessResponse<Record<string, unknown>>>(
      `/lobbies/${input.lobbyId}/participants`,
      {
        method: "POST",
        body: {
          discordId: input.discordId,
          username: input.username,
          selectedColor: input.selectedColor
        }
      }
    );
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

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
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
        status: response.status,
        responseBody: data
      });

      const message = isErrorResponse(data) ? data.error : "Backend request failed.";
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
    typeof value.error === "string"
  );
}

function assertLobbyView(value: unknown): LobbyView {
  if (!isLobbyView(value)) {
    throw new BackendResponseShapeError("Backend lobby response shape is invalid.", value);
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
    Object.values(GameMode).includes(lobby.mode as GameMode) &&
    Object.values(GameVariant).includes(lobby.variant as GameVariant) &&
    typeof lobby.playerCount === "number" &&
    Object.values(LobbyStatus).includes(lobby.status as LobbyStatus) &&
    typeof lobby.scheduledAt === "string" &&
    typeof lobby.seatsLockedAt === "string" &&
    typeof lobby.createdByDiscordId === "string" &&
    typeof lobby.host === "object" &&
    lobby.host !== null &&
    typeof lobby.host.discordId === "string" &&
    typeof lobby.joinedPlayersCount === "number" &&
    Array.isArray(lobby.participants) &&
    lobby.participants.every(isLobbyParticipantView)
  );
}

function isLobbyParticipantView(value: unknown): value is LobbyParticipantView {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const participant = value as Partial<LobbyParticipantView>;

  return (
    typeof participant.discordId === "string" &&
    Object.values(PlayerColor).includes(participant.selectedColor as PlayerColor)
  );
}
