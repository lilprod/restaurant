#!/usr/bin/env bash
# Parcours navigateur Playwright de bout en bout, sur une base neuve (CI et local).
#   1. base : migrations, RLS, seed plateforme, restaurant de démonstration « demo »
#   2. API (:3000) avec clés VAPID jetables et PUSH_DRIVER=log (rien ne sort du serveur), limitation de débit coupée
#   3. build web + vite preview (:4173) : tous les parcours, service worker réel (hors ligne, push) compris
# Variables : E2E_DATABASE_URL (obligatoire, compte propriétaire de la base, ex. postgresql://app:app@localhost:5432/restaurant),
#   CHROMIUM_PATH (facultatif), E2E_LOG_DIR (journaux, défaut $TMPDIR/web-e2e). Arguments : filtres Playwright (facultatifs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${E2E_DATABASE_URL:?E2E_DATABASE_URL est obligatoire}"
LOGS="${E2E_LOG_DIR:-${TMPDIR:-/tmp}/web-e2e}"; mkdir -p "$LOGS/uploads"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
wait_http() { for _ in $(seq 1 120); do curl -fs "$1" >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "Délai dépassé : $1" >&2; return 1; }

echo "▶ Base de données"
( cd "$ROOT/apps/api"
  DATABASE_URL="$DB" npx prisma migrate deploy >/dev/null
  psql "$DB" -v ON_ERROR_STOP=1 -q -f prisma/sql/rls.sql >/dev/null
  DATABASE_URL="$DB" pnpm -s seed >/dev/null
  DATABASE_URL="$DB" pnpm -s exec tsx prisma/seed-demo.ts demo --create >/dev/null )

echo "▶ API :3000"
vapid="$(node "$ROOT/scripts/ops/gen-vapid-keys.mjs" | grep -E '^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=')"
( cd "$ROOT/apps/api" && exec env $vapid DATABASE_URL="$DB" JWT_ACCESS_SECRET="e2e-secret-e2e-secret-e2e-secret-0" PORT=3000 \
    PUBLIC_API_URL="http://localhost:4173" UPLOAD_DIR="$LOGS/uploads" PUSH_DRIVER=log DISABLE_THROTTLE=1 DISABLE_CRON=1 \
    node dist/main.js ) >"$LOGS/api.log" 2>&1 </dev/null &
pids+=($!)
wait_http http://localhost:3000/api/v1/health || { tail -30 "$LOGS/api.log"; exit 1; }

export E2E_DATABASE_URL="$DB"
status=0

# Tous les parcours sur le BUILD de production (vite preview, proxy /api vers :3000) : plus proche de la production que le
# serveur de développement, dont l'optimisation des dépendances au premier accès recharge la page en plein test (instable à froid).
echo "▶ Build web + preview :4173"
( cd "$ROOT/apps/web" && ./node_modules/.bin/vite build >"$LOGS/web-build.log" 2>&1 )
( cd "$ROOT/apps/web" && exec ./node_modules/.bin/vite preview --port 4173 --strictPort ) >"$LOGS/web-preview.log" 2>&1 </dev/null &
pids+=($!)
wait_http http://localhost:4173/
echo "▶ Parcours Playwright"
( cd "$ROOT/apps/web" && E2E_BASE_URL=http://localhost:4173 npx playwright test "$@" ) || status=1

[ "$status" -eq 0 ] && echo "✔ Parcours navigateur : tout passe" || echo "✘ Parcours navigateur en échec (journaux : $LOGS)"
exit "$status"
