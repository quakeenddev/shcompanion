# Secret Hitler Companion System

Project name: Secret Hitler Companion System.

This is a TypeScript monorepo for a Discord + Tabletop Simulator companion system. The game itself must remain sandbox/tabletop-based. Do not turn it into a Discord game or full automated rule engine.

## Repository Goals

- Discord bot handles identity, lobbies, Steam64 ID mapping, match code creation, DM confirmations, reports.
- Backend API handles match state, event ingestion, audit logs, risk scoring, statistics, moderation review.
- PostgreSQL + Prisma stores all persistent data.
- Tabletop Lua integration sends structured events to backend and writes a short public note inside the game.
- Admin web panel is planned later, not part of MVP.

## Core Product Constraints

- Competitive games initially support only 7 players.
- Casual games support 7, 9, and 10 players.
- 10-player casual games are variant MAYHEM.
- Training games only track training count and trainer activity.
- Only competitive games affect elo.
- Competitive games require Discord ID <-> Steam64 ID mapping.
- Seat color is locked after match start. Players must finish with the color they started with.
- Claims are collected Chancellor first, then President, but public log displays President claim first.
- Public log format: President > Chancellor: President Claim > Chancellor Claim > Result.
- Vote details are backend-only. Public note shows only total count.
- Full audit data must be backend-only.
- Host overrides are allowed but must always be logged.
- Bot must never automatically punish or accuse players; it only creates risk signals.

## Code Conventions

- Use TypeScript strict mode.
- Prefer small services and explicit types.
- Put shared enums/types in packages/shared-types.
- Put game-specific rule helpers in packages/game-rules.
- Put event schemas in packages/event-schema.
- Use Prisma migrations for database changes.
- Keep API payloads typed.
- Add tests for pure logic where possible.
- Do not hardcode secrets.
- Do not implement features outside the current task without asking.

## Definition Of Done

- Code compiles.
- Prisma schema is valid.
- Basic tests pass when added.
- New commands or endpoints are documented in comments or README.
- No unrelated changes.
