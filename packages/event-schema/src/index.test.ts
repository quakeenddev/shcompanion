import { describe, expect, it } from "vitest";
import {
  MatchEventSource,
  MatchEventType,
  MatchStatus,
  TrustWeight
} from "@shc/shared-types";
import {
  isValidMatchEventType,
  resolveDefaultTrustWeight,
  resolveMatchStatusForEvent
} from "./index.js";

describe("match event schema helpers", () => {
  it("recognizes valid and invalid event types", () => {
    expect(isValidMatchEventType(MatchEventType.VoteRecorded)).toBe(true);
    expect(isValidMatchEventType("NOPE")).toBe(false);
  });

  it("resolves default trust weight by source", () => {
    expect(resolveDefaultTrustWeight(MatchEventSource.Moderator)).toBe(TrustWeight.VeryHigh);
    expect(resolveDefaultTrustWeight(MatchEventSource.Tabletop)).toBe(TrustWeight.High);
    expect(resolveDefaultTrustWeight(MatchEventSource.Host)).toBe(TrustWeight.Medium);
    expect(resolveDefaultTrustWeight(MatchEventSource.Player)).toBe(TrustWeight.Low);
  });

  it("moves CREATED matches to STARTED on MATCH_STARTED", () => {
    expect(resolveMatchStatusForEvent(MatchStatus.Created, MatchEventType.MatchStarted)).toBe(
      MatchStatus.Started
    );
  });

  it("moves matches to ENDED on MATCH_ENDED", () => {
    expect(resolveMatchStatusForEvent(MatchStatus.Started, MatchEventType.MatchEnded)).toBe(
      MatchStatus.Ended
    );
  });
});
