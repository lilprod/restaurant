#!/usr/bin/env bash
# Prépare PostgreSQL pour le développement et les tests dans un conteneur neuf (idempotent).
#   bash scripts/dev/setup-db.sh            → cluster local sur le port 5433, bases restaurant + restaurant_test,
#                                              migrations, RLS sur la base de test, seed plateforme, restaurant de démo « demo »
# Variables : PGPORT (5433), PGDATA_DIR (/var/lib/pgtest), DEMO_SLUG (demo).
set -euo pipefail
cd "$(dirname "$0")/../.."
PGPORT="${PGPORT:-5433}"
PGDATA_DIR="${PGDATA_DIR:-/var/lib/pgtest}"
DEMO_SLUG="${DEMO_SLUG:-demo}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
DEV_URL="postgresql://app:app@localhost:${PGPORT}/restaurant"
TEST_URL="postgresql://app:app@localhost:${PGPORT}/restaurant_test"

if ! pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then
  if [ -z "$BIN" ]; then echo "PostgreSQL n'est pas installé (paquet postgresql) ; utilisez docker compose up -d à la place." >&2; exit 1; fi
  mkdir -p "$PGDATA_DIR" && chown postgres "$PGDATA_DIR"
  if [ ! -f "$PGDATA_DIR/data/PG_VERSION" ]; then
    su postgres -c "$BIN/initdb -D $PGDATA_DIR/data -A trust >/dev/null"
  fi
  su postgres -c "$BIN/pg_ctl -D $PGDATA_DIR/data -o '-p $PGPORT -k $PGDATA_DIR' -l $PGDATA_DIR/log start" >/dev/null
  for _ in $(seq 1 20); do pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1 && break; sleep 0.5; done
fi

psql -h localhost -p "$PGPORT" -U postgres -qtAc "SELECT 1 FROM pg_roles WHERE rolname='app'" | grep -q 1 \
  || psql -h localhost -p "$PGPORT" -U postgres -qc "CREATE ROLE app LOGIN SUPERUSER PASSWORD 'app'"
for db in restaurant restaurant_test; do
  psql -h localhost -p "$PGPORT" -U postgres -qtAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || psql -h localhost -p "$PGPORT" -U postgres -qc "CREATE DATABASE $db OWNER app"
done

pnpm install --frozen-lockfile >/dev/null
pnpm --filter @restaurant/shared-types --filter @restaurant/utils --filter @restaurant/validation build >/dev/null
( cd apps/api
  DATABASE_URL=x npx prisma generate >/dev/null
  DATABASE_URL="$DEV_URL" npx prisma migrate deploy >/dev/null
  DATABASE_URL="$TEST_URL" npx prisma migrate deploy >/dev/null
  # Rôle non superuser pour vérifier la RLS dans les tests (TEST_DATABASE_URL=postgresql://app_rls:rls@…/restaurant_test)
  psql "$TEST_URL" -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rls') THEN CREATE ROLE app_rls LOGIN PASSWORD 'rls' NOSUPERUSER; END IF; END \$\$" >/dev/null
  psql "$TEST_URL" -qc "GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls" >/dev/null
  psql "$TEST_URL" -q -f prisma/sql/rls.sql >/dev/null 2>&1
  DATABASE_URL="$DEV_URL" pnpm seed >/dev/null
  DATABASE_URL="$DEV_URL" npx tsx prisma/seed-demo.ts "$DEMO_SLUG" --create
)
echo "Base prête : $DEV_URL (tests : $TEST_URL)"
echo "SuperAdmin : superadmin@restaurant.local / ChangeMe123! · Restaurant « $DEMO_SLUG » : admin|manager|waiter|kitchen@$DEMO_SLUG.demo / Demo-Resto-2026"
