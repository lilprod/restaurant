# syntax=docker/dockerfile:1.7
# Image du site web : build Vite puis nginx non privilégié (port 8080). Contexte : la racine du dépôt.
#   docker build -f docker/web.Dockerfile --build-arg VITE_ROOT_DOMAIN=monapp.com -t restaurant-web .
ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "web..."
# Variables Vite : figées dans le JavaScript au moment du build.
#   VITE_ROOT_DOMAIN : domaine racine des sous-domaines de restaurants (ex. monapp.com) ; l'image est donc propre à un domaine.
#   VITE_API_URL     : laisser vide (API sur la même origine, /api/v1 relayé par nginx) ; une valeur vide ne doit pas atteindre Vite.
ARG VITE_ROOT_DOMAIN=localhost
ARG VITE_API_URL=
RUN if [ -z "$VITE_API_URL" ]; then unset VITE_API_URL; fi \
 && VITE_ROOT_DOMAIN="$VITE_ROOT_DOMAIN" pnpm --filter web build \
 && find apps/web/dist -name '*.map' -delete          # pas de cartes de sources en production

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS runtime
ENV API_UPSTREAM=http://api:3000 \
    RESOLVER=127.0.0.11 \
    NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|RESOLVER|CSP_)' \
    PUBLIC_API_URL=
COPY --chown=nginx:nginx docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chown=nginx:nginx docker/nginx/snippets/ /etc/nginx/templates/snippets/
COPY --chown=nginx:nginx --chmod=755 docker/nginx/10-csp.envsh /docker-entrypoint.d/10-csp.envsh
COPY --from=build --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
