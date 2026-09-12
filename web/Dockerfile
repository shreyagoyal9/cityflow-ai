# =============================================================================
# CityFlow AI — web application image
# =============================================================================
# Three stages, so the runtime image carries the built application and nothing
# else: no source, no dev dependencies, no build toolchain.
#
# This image exists for `docker compose` — running the whole stack (web, ML
# service, Postgres, Redis, Nginx) on one machine with one command. The
# production deployment on Vercel does not use it; Vercel builds from source.
# Both paths are supported on purpose: Compose is how a marker runs the project
# offline, Vercel is how it is actually hosted.
# =============================================================================

# ------------------------------------------------------------- dependencies
FROM node:22-alpine AS deps

WORKDIR /app

# Only the manifests, so this layer is cached until the dependencies change —
# not on every source edit.
COPY package.json package-lock.json ./

# `prisma generate` runs as a postinstall hook and needs the schema present.
COPY prisma ./prisma

RUN npm ci

# ------------------------------------------------------------------- builder
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js needs a DATABASE_URL at build time for `prisma generate`, but never
# connects. A placeholder keeps the build from requiring a live database.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ------------------------------------------------------------------- runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run as a non-root user. Nothing in a Next.js server needs root, and a
# container that has it is one container escape away from mattering.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `output: "standalone"` in next.config.ts produces a self-contained server with
# only the node_modules it actually uses — a fraction of the full tree.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# The Prisma client and its query engine are needed at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
