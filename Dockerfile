FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 DATABASE_PATH=/app/.data/tripproof.db
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 1001 tripproof && useradd --uid 1001 --gid tripproof --create-home tripproof && mkdir /app/.data && chown 1001:1001 /app/.data
# The worker and web process share the same SQLite volume and runtime modules.
COPY --from=build --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=build --chown=1001:1001 /app/.next ./.next
COPY --from=build --chown=1001:1001 /app/package.json /app/tsconfig.json /app/next.config.ts ./
COPY --from=build --chown=1001:1001 /app/lib ./lib
COPY --from=build --chown=1001:1001 /app/db ./db
COPY --from=build --chown=1001:1001 /app/data ./data
COPY --from=build --chown=1001:1001 /app/scripts ./scripts
USER tripproof
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "scripts/start.ts"]
