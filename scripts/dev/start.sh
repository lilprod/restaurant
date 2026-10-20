#!/usr/bin/env bash
# Démarre l'API (:3000) et le web (:5173) en arrière-plan ; leurs PID sont écrits dans .dev-pids (arrêt : stop.sh).
# Ne jamais arrêter un serveur avec « pkill -f <motif> » : le motif correspond aussi au shell qui lance la commande.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGPORT="${PGPORT:-5433}"
LOGS="${DEV_LOG_DIR:-${TMPDIR:-/tmp}/restaurant-dev}"
mkdir -p "$LOGS/uploads"
( cd "$ROOT/apps/api" && pnpm build >/dev/null )

# « exec » : le PID enregistré est celui du serveur ; les redirections libèrent le terminal appelant.
( cd "$ROOT/apps/api" && exec env DATABASE_URL="postgresql://app:app@localhost:${PGPORT}/restaurant" \
    JWT_ACCESS_SECRET="dev-secret-dev-secret" PORT=3000 PUBLIC_API_URL="http://localhost:5173" UPLOAD_DIR="$LOGS/uploads" \
    node dist/main.js ) >"$LOGS/api.log" 2>&1 </dev/null &
echo $! >> "$ROOT/.dev-pids"
( cd "$ROOT/apps/web" && exec ./node_modules/.bin/vite --port 5173 --strictPort ) >"$LOGS/web.log" 2>&1 </dev/null &
echo $! >> "$ROOT/.dev-pids"

for _ in $(seq 1 60); do curl -fs http://localhost:3000/api/v1/public/branding >/dev/null 2>&1 && break; sleep 0.5; done
for _ in $(seq 1 60); do curl -fs http://localhost:5173/ >/dev/null 2>&1 && break; sleep 0.5; done
echo "API http://localhost:3000/api/v1 (docs /api/docs) · Web http://localhost:5173 · journaux $LOGS"
