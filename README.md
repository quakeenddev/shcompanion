# Secret Hitler Companion System

TypeScript monorepo for a Discord + Tabletop Simulator companion system. The game remains sandbox/tabletop-based; this project manages identity, lobbies, match codes, event ingestion, audit logs, risk signals, statistics, and moderation review.

## Stack

- pnpm workspaces
- TypeScript strict mode
- Discord.js v14
- Fastify
- PostgreSQL + Prisma

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Update `DATABASE_URL`, `DIRECT_URL`, and Discord values in `.env`.

4. Generate Prisma client:

```bash
pnpm prisma:generate
```

5. Register development guild slash commands:

```bash
pnpm --filter @shc/discord-bot register-commands
```

6. Run the backend API:

```bash
pnpm dev:backend
```

7. Run the Discord bot:

```bash
pnpm dev:bot
```

## Discord Local Development

Create a Discord application:

1. Go to the Discord Developer Portal.
2. Create a new application.
3. Open the Bot page and create a bot user.
4. Copy the bot token into `DISCORD_TOKEN` in `.env`.
5. Open the General Information page and copy Application ID into `DISCORD_CLIENT_ID`.
6. Enable Developer Mode in Discord, right-click your development server, and copy its ID into `DISCORD_GUILD_ID`.

Required bot environment values:

```bash
DISCORD_TOKEN="replace-with-discord-bot-token"
DISCORD_CLIENT_ID="replace-with-discord-application-client-id"
DISCORD_GUILD_ID="replace-with-development-server-id"
BOT_API_BASE_URL="http://localhost:3000/api/v1"
BOT_API_KEY="dev-local-bot-key"
BACKEND_PORT="3000"
BACKEND_BASE_URL="http://localhost:3000"
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST.REGION.aws.neon.tech/DBNAME?sslmode=require"
```

Invite the bot:

1. In the Developer Portal, open OAuth2 > URL Generator.
2. Select `bot` and `applications.commands` scopes.
3. Select the permissions needed for development, such as Send Messages.
4. Open the generated URL and invite the bot to your development server.

Register slash commands for the development guild:

```bash
pnpm --filter @shc/discord-bot register-commands
```

Run locally:

```bash
pnpm dev:backend
pnpm dev:bot
```

The registration script uses guild commands for faster local iteration. It does not register global commands.

## Using Neon Postgres

Create a Neon project and copy both connection strings into `.env`.

- Put the pooled connection string in `DATABASE_URL`.
- Put the direct connection string in `DIRECT_URL`.
- `DATABASE_URL` is used by the backend at runtime.
- `DIRECT_URL` is used by Prisma for schema changes.

After adding real Neon URLs to `.env`, run:

```bash
pnpm prisma:validate
pnpm exec prisma db push
pnpm typecheck
```

## Current Scope

- Backend API exposes a basic health endpoint.
- Discord bot supports `/steam64id`, `/lobi-olustur`, `/lobim`, lobby join/leave, lobby dissolution voting, no-show host tools, missing-player cancellation, and host match code creation.
- Shared packages define initial enums, event schema helpers, game-rule helpers, and elo placeholders.
- Prisma schema defines the first persistent models.
- Admin web and Tabletop Simulator Lua folders are placeholders.

## Sprint 1 API

- `POST /api/v1/users/:discordId/steam` registers or updates a user's Steam64 ID.
- `POST /api/v1/lobbies` creates an OPEN lobby.
- `POST /api/v1/lobbies/:lobbyId/participants` joins an OPEN lobby without Discord-side color selection.
- `POST /api/v1/lobbies/:lobbyId/leave` lets a participant leave an incomplete OPEN lobby.
- `POST /api/v1/lobbies/:lobbyId/dissolution-vote/start` starts a full-lobby dissolution vote.
- `POST /api/v1/lobbies/:lobbyId/dissolution-vote/vote` stores a participant dissolution vote.
- `POST /api/v1/lobbies/:lobbyId/participants/no-show` lets the host mark a player no-show near game time.
- `POST /api/v1/lobbies/:lobbyId/cancel-missing-players` cancels a lobby for missing participation and creates NO_SHOW records.
- `POST /api/v1/lobbies/:lobbyId/match` creates a CREATED match code once the lobby is full.

Sprint 1 does not implement MatchEvent ingestion, Tabletop Lua logic, elo, or the admin web panel.

## TODO Notes

- TODO: Add check-in system before game time.
- TODO: Add backup player system for replacement joins.
- TODO: Add production build/start scripts for Oracle deployment.
- TODO: Add moderator recovery commands for stuck lobbies and match flows.
