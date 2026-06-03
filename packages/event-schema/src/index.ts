import {
  MatchEventSource,
  MatchEventType,
  MatchStatus,
  ReviewStatus,
  TrustWeight
} from "@shc/shared-types";

export type MatchEventPayload = Record<string, unknown>;

export interface MatchEventEnvelope {
  clientEventId: string;
  type: MatchEventType;
  matchId: string;
  roundIndex?: number;
  actorUserId?: string;
  actorColor?: string;
  source: MatchEventSource;
  trustWeight: TrustWeight;
  payload: MatchEventPayload;
}

export function isValidMatchEventType(value: unknown): value is MatchEventType {
  return Object.values(MatchEventType).includes(value as MatchEventType);
}

export function isValidMatchEventSource(value: unknown): value is MatchEventSource {
  return Object.values(MatchEventSource).includes(value as MatchEventSource);
}

export function isValidTrustWeight(value: unknown): value is TrustWeight {
  return Object.values(TrustWeight).includes(value as TrustWeight);
}

export function isValidReviewStatus(value: unknown): value is ReviewStatus {
  return Object.values(ReviewStatus).includes(value as ReviewStatus);
}

export function resolveDefaultTrustWeight(source: MatchEventSource): TrustWeight {
  if (source === MatchEventSource.Moderator) {
    return TrustWeight.VeryHigh;
  }

  if (source === MatchEventSource.Tabletop || source === MatchEventSource.DiscordBot) {
    return TrustWeight.High;
  }

  if (source === MatchEventSource.Host || source === MatchEventSource.System) {
    return TrustWeight.Medium;
  }

  return TrustWeight.Low;
}

export function validateMatchEventPayloadBasic(payload: unknown): payload is MatchEventPayload {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}

export function resolveMatchStatusForEvent(
  currentStatus: MatchStatus,
  eventType: MatchEventType
): MatchStatus | null {
  if (eventType === MatchEventType.MatchStarted && currentStatus === MatchStatus.Created) {
    return MatchStatus.Started;
  }

  if (eventType === MatchEventType.MatchEnded) {
    return MatchStatus.Ended;
  }

  if (eventType === MatchEventType.MatchDisputed) {
    return MatchStatus.UnderReview;
  }

  return null;
}
