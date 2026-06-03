import { describe, expect, it } from "vitest";
import { LobbyParticipantStatus, LobbyStatus } from "@shc/shared-types";
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
  isActiveLobbyStatus,
  isBlockingParticipantStatus,
  isDissolutionVoteExpired,
  parseScheduledAtInput,
  resolvePlayerSlots,
  shouldExpireIncompleteLobby
} from "./index.js";

describe("lobby lifecycle helpers", () => {
  it("parses DD.MM.YYYY-HH.mm as Europe/Istanbul and stores UTC", () => {
    expect(parseScheduledAtInput("03.06.2026-21.00")?.toISOString()).toBe(
      "2026-06-03T18:00:00.000Z"
    );
  });

  it("rejects invalid schedule formats", () => {
    expect(parseScheduledAtInput("2026-06-03 21:00")).toBeNull();
    expect(parseScheduledAtInput("03.13.2026-21.00")).toBeNull();
  });

  it("allows incomplete lobby cancel inside the last hour", () => {
    expect(
      canCancelLobby({
        status: LobbyStatus.Open,
        participantCount: 3,
        playerCount: 7,
        scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
        now: new Date("2026-06-03T17:30:00.000Z")
      })
    ).toBe(true);
  });

  it("blocks full lobby cancel inside the last hour", () => {
    expect(
      canCancelLobby({
        status: LobbyStatus.Ready,
        participantCount: 7,
        playerCount: 7,
        scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
        now: new Date("2026-06-03T17:30:00.000Z")
      })
    ).toBe(false);
  });

  it("allows participant leave for incomplete open lobbies but blocks host leave", () => {
    expect(canLeaveLobby({ isHost: false, status: LobbyStatus.Open, participantCount: 2, playerCount: 7 })).toBe(true);
    expect(canLeaveLobby({ isHost: true, status: LobbyStatus.Open, participantCount: 2, playerCount: 7 })).toBe(false);
  });

  it("detects stale incomplete lobby expiration", () => {
    expect(
      shouldExpireIncompleteLobby({
        status: LobbyStatus.Open,
        participantCount: 4,
        playerCount: 7,
        scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
        now: new Date("2026-06-03T17:15:00.000Z")
      })
    ).toBe(true);
  });

  it("defines active blocker statuses clearly", () => {
    expect(isActiveLobbyStatus(LobbyStatus.Open)).toBe(true);
    expect(isActiveLobbyStatus(LobbyStatus.Ready)).toBe(true);
    expect(isActiveLobbyStatus(LobbyStatus.GameStarting)).toBe(true);
    expect(isActiveLobbyStatus(LobbyStatus.InProgress)).toBe(true);
    expect(isActiveLobbyStatus(LobbyStatus.Cancelled)).toBe(false);
    expect(isActiveLobbyStatus(LobbyStatus.Expired)).toBe(false);
    expect(isActiveLobbyStatus(LobbyStatus.Dissolved)).toBe(false);
    expect(isActiveLobbyStatus(LobbyStatus.CancelledMissingPlayers)).toBe(false);
    expect(isActiveLobbyStatus(LobbyStatus.Ended)).toBe(false);
    expect(isActiveLobbyStatus(LobbyStatus.Voided)).toBe(false);
  });

  it("only JOINED participants count toward lobby fullness and active blocking", () => {
    const participants = [
      { status: LobbyParticipantStatus.Joined },
      { status: LobbyParticipantStatus.NoShow },
      { status: LobbyParticipantStatus.RemovedNoShow },
      { status: LobbyParticipantStatus.Left }
    ];

    expect(countJoinedParticipants(participants)).toBe(1);
    expect(isBlockingParticipantStatus(LobbyParticipantStatus.Joined)).toBe(true);
    expect(isBlockingParticipantStatus(LobbyParticipantStatus.NoShow)).toBe(false);
  });

  it("resolves player slots by join order without colors", () => {
    const rows = resolvePlayerSlots(4, [
      { discordId: "1", username: "Koray", status: LobbyParticipantStatus.Joined },
      { discordId: "2", username: "Skarma", status: LobbyParticipantStatus.NoShow },
      { discordId: "3", username: "Solid", status: LobbyParticipantStatus.Joined }
    ]);

    expect(rows).toEqual([
      { index: 1, discordId: "1", username: "Koray" },
      { index: 2, discordId: "3", username: "Solid" },
      { index: 3, discordId: null, username: null },
      { index: 4, discordId: null, username: null }
    ]);
  });

  it("resolves dissolution thresholds", () => {
    expect(getDissolutionThreshold(7)).toBe(5);
    expect(getDissolutionThreshold(9)).toBe(6);
    expect(getDissolutionThreshold(10)).toBe(7);
  });

  it("allows dissolution vote only for full active lobbies without open vote", () => {
    expect(canStartDissolutionVote({ status: LobbyStatus.Open, participantCount: 7, playerCount: 7, hasOpenVote: false })).toBe(true);
    expect(canStartDissolutionVote({ status: LobbyStatus.Open, participantCount: 6, playerCount: 7, hasOpenVote: false })).toBe(false);
    expect(canStartDissolutionVote({ status: LobbyStatus.Open, participantCount: 7, playerCount: 7, hasOpenVote: true })).toBe(false);
  });

  it("passes dissolution vote when threshold is reached and expires after five minutes", () => {
    expect(hasDissolutionVotePassed({ yesCount: 4, playerCount: 7 })).toBe(false);
    expect(hasDissolutionVotePassed({ yesCount: 5, playerCount: 7 })).toBe(true);
    expect(isDissolutionVoteExpired({
      createdAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T18:05:00.000Z")
    })).toBe(true);
  });

  it("allows start game within scheduled window", () => {
    expect(canStartGame({
      isHost: true,
      participantCount: 7,
      playerCount: 7,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T17:50:00.000Z"),
      hasOpenDissolutionVote: false
    })).toEqual({ ok: true });
  });

  it("rejects start game too early, too late, non-host, and open vote", () => {
    const base = {
      isHost: true,
      participantCount: 7,
      playerCount: 7,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      hasOpenDissolutionVote: false
    };

    expect(canStartGame({ ...base, now: new Date("2026-06-03T17:40:00.000Z") })).toEqual({ ok: false, code: "START_TOO_EARLY" });
    expect(canStartGame({ ...base, now: new Date("2026-06-03T18:20:00.000Z") })).toEqual({ ok: false, code: "START_TOO_LATE" });
    expect(canStartGame({ ...base, isHost: false, now: new Date("2026-06-03T17:50:00.000Z") })).toEqual({ ok: false, code: "HOST_ONLY" });
    expect(canStartGame({ ...base, hasOpenDissolutionVote: true, now: new Date("2026-06-03T17:50:00.000Z") })).toEqual({ ok: false, code: "DISSOLUTION_VOTE_OPEN" });
  });

  it("allows no-show marking exactly 15 minutes before scheduled time", () => {
    expect(canMarkNoShow({
      isHost: true,
      status: LobbyStatus.Open,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T17:45:00.000Z")
    })).toEqual({ ok: true });
  });

  it("rejects no-show marking earlier than 15 minutes or without schedule", () => {
    expect(canMarkNoShow({
      isHost: true,
      status: LobbyStatus.Open,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T17:44:59.999Z")
    })).toEqual({ ok: false, code: "TOO_EARLY_FOR_NO_SHOW" });
    expect(canMarkNoShow({
      isHost: true,
      status: LobbyStatus.Open,
      scheduledAt: null,
      now: new Date("2026-06-03T17:45:00.000Z")
    })).toEqual({ ok: false, code: "LOBBY_NOT_SCHEDULED" });
  });

  it("allows missing-player cancellation at scheduled time", () => {
    expect(canCancelForMissingPlayers({
      isHost: true,
      status: LobbyStatus.Open,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T18:00:00.000Z"),
      missingCount: 1
    })).toEqual({ ok: true });
  });

  it("rejects missing-player cancellation before scheduled time and for non-host", () => {
    expect(canCancelForMissingPlayers({
      isHost: true,
      status: LobbyStatus.Open,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T17:59:59.999Z"),
      missingCount: 1
    })).toEqual({ ok: false, code: "TOO_EARLY_FOR_MISSING_CANCEL" });
    expect(canCancelForMissingPlayers({
      isHost: false,
      status: LobbyStatus.Open,
      scheduledAt: new Date("2026-06-03T18:00:00.000Z"),
      now: new Date("2026-06-03T18:00:00.000Z"),
      missingCount: 1
    })).toEqual({ ok: false, code: "HOST_ONLY" });
  });
});
