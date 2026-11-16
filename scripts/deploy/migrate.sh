#!/usr/bin/env bash
# Mise en service de la base (idempotent : à rejouer à chaque déploiement).
#   1. rôles : propriétaire des tables (migrations) et rôle applicatif, tous deux NON superuser et sans BYPASSRLS
#   2. base de données, schéma public, droits
#   3. `prisma migrate deploy` avec le rôle propriétaire
#   4. droits du rôle applicatif (GRANT + ALTER DEFAULT PRIVILEGES pour les tables des futures migrations)
#   5. prisma/sql/rls.sql (Row Level Security) — rejoué à chaque fois
#   6. seed de la plateforme (SuperAdmin + plans) si aucun compte plateforme n'existe
#   7. contrôles : rôle applicatif sans privilège, RLS active et forcée sur toutes les tables à `tenantId`
#
# POURQUOI un rôle applicatif restreint : PostgreSQL n'applique JAMAIS la RLS aux superusers ni aux rôles BYPASSRLS. Une API qui se
# connecterait avec le compte administrateur ignorerait l'isolation entre restaurants. Le propriétaire des tables, lui, est soumis à
# la RLS (FORCE) mais reçoit `app.bypass_rls = on` au niveau du rôle pour que les migrations de données voient toutes les lignes.
#
# Variables (obligatoires sauf mention) :
#   PGHOST (postgres) PGPORT (5432)  PG_ADMIN_USER (postgres) PG_ADMIN_PASSWORD   compte d'administration du serveur (superuser)
#   DB_NAME (restaurant)             DB_OWNER_USER (restaurant_owner) DB_OWNER_PASSWORD
#   DB_APP_USER (restaurant_app)     DB_APP_PASSWORD
#   SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD   (seed uniquement ; mot de passe obligatoire si la base est vide)
# Les mots de passe ne contiennent que des caractères d'URL sûrs [A-Za-z0-9._~-] (ex. `openssl rand -hex 24`).
set -euo pipefail
cd "$(dirname "$0")/../../apps/api"

: "${PG_ADMIN_PASSWORD:?PG_ADMIN_PASSWORD est obligatoire}" "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD est obligatoire}" "${DB_APP_PASSWORD:?DB_APP_PASSWORD est obligatoire}"
export PGHOST="${PGHOST:-postgres}" PGPORT="${PGPORT:-5432}" PGOPTIONS="-c client_min_messages=warning"
ADMIN="${PG_ADMIN_USER:-postgres}" DB="${DB_NAME:-restaurant}" OWNER="${DB_OWNER_USER:-restaurant_owner}" APP="${DB_APP_USER:-restaurant_app}"
for v in "$ADMIN" "$DB" "$OWNER" "$APP"; do [[ "$v" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "Nom invalide « $v » (minuscules, chiffres, _)" >&2; exit 1; }; done
for v in "$PG_ADMIN_PASSWORD" "$DB_OWNER_PASSWORD" "$DB_APP_PASSWORD"; do
  [[ "$v" =~ ^[A-Za-z0-9._~-]{16,}$ ]] || { echo "Mot de passe de base : 16 caractères minimum parmi [A-Za-z0-9._~-] (ex. openssl rand -hex 24)" >&2; exit 1; }
done
[ "$OWNER" != "$APP" ] || { echo "DB_OWNER_USER et DB_APP_USER doivent être distincts" >&2; exit 1; }
url() { echo "postgresql://$1:$2@${PGHOST}:${PGPORT}/${DB}"; }
admin_psql() { PGPASSWORD="$PG_ADMIN_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U "$ADMIN" "$@"; }
owner_psql() { PGPASSWORD="$DB_OWNER_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U "$OWNER" -d "$DB" "$@"; }
step() { echo "▶ $*"; }

step "Attente de PostgreSQL ($PGHOST:$PGPORT)"
for i in $(seq 1 60); do pg_isready -q -h "$PGHOST" -p "$PGPORT" && break; [ "$i" = 60 ] && { echo "PostgreSQL ne répond pas" >&2; exit 1; }; sleep 1; done

step "Rôles, base et schéma"
admin_psql -d postgres -v owner="$OWNER" -v app="$APP" -v db="$DB" -v ownerpw="$DB_OWNER_PASSWORD" -v apppw="$DB_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'owner') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app')   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app') \gexec
-- Mots de passe resynchronisés à chaque exécution ; aucun privilège : ni superuser, ni BYPASSRLS, ni création de rôle / base.
SELECT format('ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'owner', :'ownerpw') \gexec
SELECT format('ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app', :'apppw') \gexec
-- Les migrations (propriétaire) ignorent la RLS ; l'application, jamais.
SELECT format('ALTER ROLE %I SET app.bypass_rls = %L', :'owner', 'on') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'owner') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'app') \gexec
SQL
admin_psql -d "$DB" -v owner="$OWNER" -v app="$APP" <<'SQL'
ALTER SCHEMA public OWNER TO :"owner";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
SQL

step "Migrations Prisma (rôle $OWNER)"
DATABASE_URL="$(url "$OWNER" "$DB_OWNER_PASSWORD")" npx --no-install prisma migrate deploy

step "Droits du rôle applicatif $APP"
owner_psql -v app="$APP" <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";
REVOKE ALL ON TABLE "_prisma_migrations" FROM :"app";
-- Tables et séquences créées par les futures migrations (exécutées par le propriétaire).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL

step "Row Level Security (prisma/sql/rls.sql)"
owner_psql -f prisma/sql/rls.sql

step "Seed de la plateforme"
if [ "$(owner_psql -tA -c 'SELECT count(*) FROM "PlatformUser"')" = "0" ]; then
  DATABASE_URL="$(url "$OWNER" "$DB_OWNER_PASSWORD")" NODE_ENV=production npx --no-install tsx prisma/seed.ts
else
  echo "  (compte plateforme déjà présent : rien à faire)"
fi

step "Contrôles"
# Tables protégées attendues = celles que déclare rls.sql (les rares tables à tenantId volontairement exemptées sont justifiées dans test/rls.e2e-spec.ts).
expected="$(grep -c 'ENABLE ROW LEVEL SECURITY' prisma/sql/rls.sql)"
checks="$(PGPASSWORD="$DB_APP_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -v expected="$expected" -U "$APP" -d "$DB" -tA <<'SQL'
SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ECHEC : le rôle applicatif contourne la RLS' ELSE 'rôle applicatif : sans privilège (ni superuser ni BYPASSRLS)' END FROM pg_roles WHERE rolname = current_user;
WITH t AS (SELECT count(*) AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity)
SELECT 'RLS : ' || n || ' tables protégées (attendu : ' || :expected || ')' FROM t;
SELECT CASE WHEN NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user)
             AND (SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
                   WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity) >= :expected
            THEN 'OK' ELSE 'ECHEC' END;
SQL
)"
echo "$checks" | sed '$d' | sed 's/^/  /'
[ "$(echo "$checks" | tail -n 1)" = OK ] || { echo "✘ Contrôles en échec : la base n'est pas conforme" >&2; exit 1; }
echo "✔ Base prête : rôle applicatif « $APP » (non superuser), RLS active."
