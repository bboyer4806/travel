# Build on Node 24 so the server and SQLite runtime use the same release line.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.32.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Next's standalone output does not copy public or static assets automatically.
RUN mkdir -p public && pnpm build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=80 \
    TRAVEL_DATABASE_PATH=/data/travel.sqlite
RUN groupadd --system --gid 1001 travel \
    && useradd --system --uid 1001 --gid travel travel \
    && mkdir -p /data \
    && chown travel:travel /data
COPY --from=builder --chown=travel:travel /app/.next/standalone ./
COPY --from=builder --chown=travel:travel /app/.next/static ./.next/static
COPY --from=builder --chown=travel:travel /app/public ./public
COPY --chown=travel:travel scripts/start.mjs scripts/backup.mjs ./scripts/
USER travel
# Preserve the existing Dokku port mapping. No anonymous VOLUME is declared:
# /data must be explicitly mounted as described in docs/DEPLOYMENT.md.
EXPOSE 80
CMD ["node", "scripts/start.mjs"]
