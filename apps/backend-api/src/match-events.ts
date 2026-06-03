import { Prisma, type MatchEvent } from "@prisma/client";
import {
  isValidMatchEventSource,
  isValidMatchEventType,
  isValidReviewStatus,
  isValidTrustWeight,
  resolveDefaultTrustWeight,
  resolveMatchStatusForEvent,
  validateMatchEventPayloadBasic
} from "@shc/event-schema";
import {
  MatchEventSource,
  MatchEventType,
  MatchStatus,
  PlayerColor,
  ReviewStatus,
  TrustWeight
} from "@shc/shared-types";
import { prisma } from "./prisma.js";

export type AppendMatchEventInput = {
  matchId: string;
  clientEventId: string;
  type: MatchEventType;
  roundIndex?: number;
  actorUserId?: string;
  actorColor?: PlayerColor;
  source: MatchEventSource;
  trustWeight?: TrustWeight;
  payload: Record<string, unknown>;
};

export type AppendMatchEventResult = {
  event: MatchEvent;
  duplicated: boolean;
};

export type MatchEventValidationResult =
  | {
      ok: true;
      value: AppendMatchEventInput;
    }
  | {
      ok: false;
      message: string;
    };

type RawMatchEventBody = {
  clientEventId?: unknown;
  type?: unknown;
  roundIndex?: unknown;
  actorUserId?: unknown;
  actorColor?: unknown;
  source?: unknown;
  trustWeight?: unknown;
  payload?: unknown;
};

export function validateMatchEventPayloadBasicForRequest(
  matchId: string,
  body: RawMatchEventBody
): MatchEventValidationResult {
  if (typeof body.clientEventId !== "string" || body.clientEventId.trim().length === 0) {
    return {
      ok: false,
      message: "clientEventId is required."
    };
  }

  if (!isValidMatchEventType(body.type)) {
    return {
      ok: false,
      message: "Invalid match event type."
    };
  }

  if (!isValidMatchEventSource(body.source)) {
    return {
      ok: false,
      message: "Invalid match event source."
    };
  }

  if (body.trustWeight !== undefined && !isValidTrustWeight(body.trustWeight)) {
    return {
      ok: false,
      message: "Invalid trustWeight."
    };
  }

  if (
    body.roundIndex !== undefined &&
    (!Number.isInteger(body.roundIndex) || Number(body.roundIndex) < 0)
  ) {
    return {
      ok: false,
      message: "roundIndex must be a non-negative integer when provided."
    };
  }

  if (
    body.actorUserId !== undefined &&
    (typeof body.actorUserId !== "string" || body.actorUserId.trim().length === 0)
  ) {
    return {
      ok: false,
      message: "actorUserId must be a non-empty string when provided."
    };
  }

  if (
    body.actorColor !== undefined &&
    !Object.values(PlayerColor).includes(body.actorColor as PlayerColor)
  ) {
    return {
      ok: false,
      message: "actorColor is invalid."
    };
  }

  const payload = body.payload ?? {};

  if (!validateMatchEventPayloadBasic(payload)) {
    return {
      ok: false,
      message: "payload must be a JSON object."
    };
  }

  return {
    ok: true,
    value: {
      matchId,
      clientEventId: body.clientEventId,
      type: body.type,
      roundIndex: body.roundIndex as number | undefined,
      actorUserId: body.actorUserId as string | undefined,
      actorColor: body.actorColor as PlayerColor | undefined,
      source: body.source,
      trustWeight: (body.trustWeight as TrustWeight | undefined) ?? resolveDefaultTrustWeight(body.source),
      payload
    }
  };
}

export async function appendMatchEvent(input: AppendMatchEventInput): Promise<AppendMatchEventResult> {
  const existing = await prisma.matchEvent.findUnique({
    where: {
      matchId_clientEventId: {
        matchId: input.matchId,
        clientEventId: input.clientEventId
      }
    }
  });

  if (existing) {
    return {
      event: existing,
      duplicated: true
    };
  }

  const actor = input.actorUserId
    ? await prisma.user.findFirst({
        where: {
          OR: [
            {
              id: input.actorUserId
            },
            {
              discordId: input.actorUserId
            }
          ]
        }
      })
    : null;

  const event = await prisma.matchEvent.create({
    data: {
      matchId: input.matchId,
      clientEventId: input.clientEventId,
      type: input.type,
      roundIndex: input.roundIndex,
      actorUserId: actor?.id,
      actorColor: input.actorColor,
      source: input.source,
      trustWeight: input.trustWeight ?? resolveDefaultTrustWeight(input.source),
      payload: input.payload as Prisma.InputJsonObject
    }
  });

  await applyMatchEventSideEffects(input.matchId, input.type, input.payload);

  return {
    event,
    duplicated: false
  };
}

export async function applyMatchEventSideEffects(
  matchId: string,
  type: MatchEventType,
  payload: Record<string, unknown>
): Promise<void> {
  const match = await prisma.match.findUnique({
    where: {
      id: matchId
    },
    select: {
      status: true,
      reviewStatus: true
    }
  });

  if (!match) {
    return;
  }

  const nextStatus = resolveMatchStatusForEvent(match.status as MatchStatus, type);

  if (nextStatus) {
    await prisma.match.update({
      where: {
        id: matchId
      },
      data: {
        status: nextStatus,
        ...(nextStatus === MatchStatus.Started ? { startedAt: new Date() } : {}),
        ...(nextStatus === MatchStatus.Ended ? { completedAt: new Date() } : {})
      }
    });
  }

  if (type === MatchEventType.MatchDisputed) {
    await prisma.match.update({
      where: {
        id: matchId
      },
      data: {
        reviewStatus: ReviewStatus.Pending
      }
    });
  }

  if (type === MatchEventType.ReviewStatusChanged) {
    const reviewStatus = payload.reviewStatus;

    if (isValidReviewStatus(reviewStatus)) {
      await prisma.match.update({
        where: {
          id: matchId
        },
        data: {
          reviewStatus
        }
      });
    }
  }
}

export { resolveDefaultTrustWeight, validateMatchEventPayloadBasic };
