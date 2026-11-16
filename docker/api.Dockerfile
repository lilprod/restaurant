# syntax=docker/dockerfile:1.7
# Image de l'API. Contexte de build : la racine du dépôt.
#   docker build -f docker/api.Dockerfile --target runtime -t restaurant-api .   # API (défaut)
#   docker build -f docker/api.Dockerfile --target tools   -t restaurant-tools . # migrations + seed (job ponctuel)
ARG NODE_VERSION=22

# ── Base : Node + OpenSSL (requis par le moteur de requêtes Prisma) ──
FROM node:${NODE_VERSION}-bookworm-slim AS node-base
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Compilation : paquets partagés + API, client Prisma ──
FROM node-base AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "api..."
RUN DATABASE_URL=x pnpm --filter api prisma:generate \
 && pnpm --filter "api..." build
# Dépendances de production seules, dans /out, avec leur propre client Prisma généré.
# hadolint ignore=DL3003
RUN pnpm --filter api --prod deploy /out \
 && cp -r apps/api/prisma /out/prisma \
 && cd /out && DATABASE_URL=x /app/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ── Outils : migrations, rls.sql, seed (jamais exposé) ──
FROM build AS tools
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/api
ENV NODE_ENV=production
COPY scripts/deploy /app/scripts/deploy
CMD ["bash", "/app/scripts/deploy/migrate.sh"]

# ── Exécution : image minimale, utilisateur non root ──
FROM node-base AS runtime
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/data/uploads
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
