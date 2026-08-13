# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
# package-lock.json MUST exist — `npm ci` refuses to run without it and the
# whole point of a lockfile is a deterministic install. The `*` glob let a
# missing lockfile slip through silently for too long.
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S agentos && adduser -S agentos -G agentos

COPY --from=builder /app/public ./public
COPY --from=builder --chown=agentos:agentos /app/.next/standalone ./
COPY --from=builder --chown=agentos:agentos /app/.next/static ./.next/static
# worker + drizzle tooling run through tsx with full node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# Migration runner needs: drizzle.config.ts + package.json (for DATABASE_URL),
# drizzle/ directory (SQL files to apply), and scripts/migrate.ts (the runner).
# Without drizzle/ the migrator has no SQL files to apply and fails silently.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts

USER agentos
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
