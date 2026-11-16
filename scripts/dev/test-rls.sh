#!/usr/bin/env bash
# Rejoue TOUTE la suite e2e de l'API sous le rôle non superuser `app_rls` (la RLS s'applique vraiment).
#   bash scripts/dev/test-rls.sh                 → toute la suite
#   bash scripts/dev/test-rls.sh test/staff      → seulement certains fichiers (arguments passés à jest)
# Étapes : migrations (compte propriétaire), rôle app_rls + droits, rls.sql, puis jest avec TEST_DATABASE_URL=app_rls.
# Variables : PGPORT (5433), ADMIN_URL (postgresql://app:app@localhost:$PGPORT/restaurant_test).
set -euo pipefail
cd "$(dirname "$0")/../../apps/api"
PGPORT="${PGPORT:-5433}"
ADMIN_URL="${ADMIN_URL:-postgresql://app:app@localhost:${PGPORT}/restaurant_test}"
RLS_URL="$(node -e 'const u=new URL(process.argv[1]);u.username="app_rls";u.password="rls";console.log(u.toString())' "$ADMIN_URL")"

DATABASE_URL="$ADMIN_URL" npx prisma migrate deploy >/dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rls') THEN CREATE ROLE app_rls LOGIN PASSWORD 'rls' NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_rls;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_rls;
SQL
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -f prisma/sql/rls.sql

TEST_DATABASE_URL="$RLS_URL" TEST_ADMIN_DATABASE_URL="$ADMIN_URL" npx jest --config test/jest-e2e.json --runInBand "$@"
