export enum GameMode {
  Competitive = "COMPETITIVE",
  Casual = "CASUAL",
  Training = "TRAINING"
}

export enum GameVariant {
  Standard = "STANDARD",
  StandardMeta = "STANDARD_META",
  Freeplay = "FREEPLAY",
  Mayhem = "MAYHEM"
}

export enum PlayerColor {
  Red = "RED",
  Blue = "BLUE",
  Green = "GREEN",
  Yellow = "YELLOW",
  Orange = "ORANGE",
  Purple = "PURPLE",
  Brown = "BROWN",
  White = "WHITE",
  Black = "BLACK",
  Pink = "PINK"
}

export enum LobbyStatus {
  Open = "OPEN",
  Ready = "READY",
  GameStarting = "GAME_STARTING",
  InProgress = "IN_PROGRESS",
  Cancelled = "CANCELLED",
  Expired = "EXPIRED",
  Dissolved = "DISSOLVED",
  CancelledMissingPlayers = "CANCELLED_MISSING_PLAYERS",
  Ended = "ENDED",
  Voided = "VOIDED"
}

export enum LobbyParticipantStatus {
  Joined = "JOINED",
  Left = "LEFT",
  NoShow = "NO_SHOW",
  RemovedNoShow = "REMOVED_NO_SHOW",
  RemovedByHost = "REMOVED_BY_HOST",
  RemovedByMod = "REMOVED_BY_MOD",
  ReleasedByMod = "RELEASED_BY_MOD"
}

export enum LobbyDissolutionVoteStatus {
  Open = "OPEN",
  Passed = "PASSED",
  Failed = "FAILED",
  Cancelled = "CANCELLED"
}

export enum LobbyDissolutionVoteChoice {
  Yes = "YES",
  No = "NO"
}

export enum MatchStatus {
  Created = "CREATED",
  Started = "STARTED",
  InProgress = "IN_PROGRESS",
  Ended = "ENDED",
  UnderReview = "UNDER_REVIEW",
  Completed = "COMPLETED",
  LockedPendingReview = "LOCKED_PENDING_REVIEW",
  Voided = "VOIDED"
}

export enum ReviewStatus {
  None = "NONE",
  Pending = "PENDING",
  InReview = "IN_REVIEW",
  Resolved = "RESOLVED",
  Dismissed = "DISMISSED"
}

export enum MatchEventType {
  MatchCreated = "MATCH_CREATED",
  LobbyCreated = "LOBBY_CREATED",
  PlayerJoinedLobby = "PLAYER_JOINED_LOBBY",
  MatchStarted = "MATCH_STARTED",
  SeatColorLocked = "SEAT_COLOR_LOCKED",
  PlayerSnapshotTaken = "PLAYER_SNAPSHOT_TAKEN",
  DiceColorLocked = "DICE_COLOR_LOCKED",
  GovernmentNominated = "GOVERNMENT_NOMINATED",
  PresidentTurnStarted = "PRESIDENT_TURN_STARTED",
  PresidentPass = "PRESIDENT_PASS",
  ChancellorSelected = "CHANCELLOR_SELECTED",
  SoftValidationWarning = "SOFT_VALIDATION_WARNING",
  RuleViolationWarning = "RULE_VIOLATION_WARNING",
  VoteRecorded = "VOTE_RECORDED",
  VoteFailed = "VOTE_FAILED",
  ClaimsSubmitted = "CLAIMS_SUBMITTED",
  PolicyPhaseStarted = "POLICY_PHASE_STARTED",
  PolicyEnacted = "POLICY_ENACTED",
  PowerResolved = "POWER_RESOLVED",
  CardDrawn = "CARD_DRAWN",
  CardFlipped = "CARD_FLIPPED",
  CardDiscarded = "CARD_DISCARDED",
  CardSentToChancellor = "CARD_SENT_TO_CHANCELLOR",
  PolicyResultDetected = "POLICY_RESULT_DETECTED",
  PolicyResultConfirmed = "POLICY_RESULT_CONFIRMED",
  ChancellorClaimSubmitted = "CHANCELLOR_CLAIM_SUBMITTED",
  PresidentClaimSubmitted = "PRESIDENT_CLAIM_SUBMITTED",
  RoundLogged = "ROUND_LOGGED",
  DeckShuffled = "DECK_SHUFFLED",
  SpecialPowerUsed = "SPECIAL_POWER_USED",
  PlayerKilled = "PLAYER_KILLED",
  PlayerDisconnected = "PLAYER_DISCONNECTED",
  PlayerReconnected = "PLAYER_RECONNECTED",
  HostOverride = "HOST_OVERRIDE",
  ModAuditCorrection = "MOD_AUDIT_CORRECTION",
  MatchEnded = "MATCH_ENDED",
  MatchCompleted = "MATCH_COMPLETED",
  RolecheckStarted = "ROLECHECK_STARTED",
  RolecheckCompleted = "ROLECHECK_COMPLETED",
  RoleMismatch = "ROLE_MISMATCH",
  MatchConfirmationSent = "MATCH_CONFIRMATION_SENT",
  PlayerConfirmationSubmitted = "PLAYER_CONFIRMATION_SUBMITTED",
  MatchConfirmed = "MATCH_CONFIRMED",
  MatchDisputed = "MATCH_DISPUTED",
  ReportSubmitted = "REPORT_SUBMITTED",
  RiskSignalCreated = "RISK_SIGNAL_CREATED",
  AuditCorrectionSubmitted = "AUDIT_CORRECTION_SUBMITTED",
  ReviewStatusChanged = "REVIEW_STATUS_CHANGED"
}

export enum MatchEventSource {
  System = "SYSTEM",
  Host = "HOST",
  Player = "PLAYER",
  Moderator = "MODERATOR",
  Tabletop = "TABLETOP",
  DiscordBot = "DISCORD_BOT"
}

export enum TrustWeight {
  Low = "LOW",
  Medium = "MEDIUM",
  High = "HIGH",
  VeryHigh = "VERY_HIGH"
}

export enum ReportCategory {
  Late = "LATE",
  NoShow = "NO_SHOW",
  RageQuit = "RAGE_QUIT",
  RoleReveal = "ROLE_REVEAL",
  ToxicBehavior = "TOXIC_BEHAVIOR",
  GamethrowSuspicion = "GAMETHROW_SUSPICION",
  RuleAbuse = "RULE_ABUSE",
  HostAbuse = "HOST_ABUSE",
  IncorrectLogEntry = "INCORRECT_LOG_ENTRY",
  CollusionSuspicion = "COLLUSION_SUSPICION"
}

export type Steam64Id = string;
export type DiscordUserId = string;
export type MatchCode = string;
