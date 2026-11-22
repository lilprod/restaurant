#!/usr/bin/env bash
# Sauvegarde chiffrée de la base PostgreSQL.
#   pg_dump (format custom, compressé) → chiffrement → $BACKUP_DIR/{daily,weekly,monthly}/restaurant-AAAAMMJJThhmmssZ.dump.{age|enc}
#   + somme SHA-256 + manifeste (nombre de lignes par table, politiques RLS, migrations) pour vérifier la restauration.
# Rotation : 7 quotidiennes, 4 hebdomadaires (dimanche UTC), 6 mensuelles (le 1er). Copie hors site si BACKUP_S3_BUCKET est défini.
# Variables : connexion libpq (PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE), BACKUP_DIR (./backups), chiffrement (voir lib.sh),
#   KEEP_DAILY/KEEP_WEEKLY/KEEP_MONTHLY, BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_PREFIX AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
umask 077
DIR="${BACKUP_DIR:-./backups}"; DB="${PGDATABASE:-restaurant}"; export PGDATABASE="$DB"
mkdir -p "$DIR/daily" "$DIR/weekly" "$DIR/monthly"
[ -n "${BACKUP_AGE_RECIPIENT:-}${BACKUP_PASSPHRASE:-}${BACKUP_PASSPHRASE_FILE:-}" ] || die "Aucune clé de chiffrement : définissez BACKUP_AGE_RECIPIENT (age) ou BACKUP_PASSPHRASE / BACKUP_PASSPHRASE_FILE"

ts="$(date -u +%Y%m%dT%H%M%SZ)"; name="restaurant-$ts.dump.$(ext)"
work="$(mktemp -d "$DIR/.work.XXXXXX")"; trap 'rm -rf "$work"' EXIT

log "Sauvegarde de « $DB » démarrée"
# Une sauvegarde faite avec un pg_dump plus récent que le serveur peut contenir des instructions que pg_restore refusera sur ce même
# serveur (ex. `SET transaction_timeout`, PostgreSQL 17+) : on refuse plutôt que de produire une sauvegarde impossible à restaurer.
server_major="$(psql -X -q -At -d "$DB" -c 'SHOW server_version_num' | cut -c1-2)"
client_major="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
[ "$client_major" -le "$server_major" ] || die "pg_dump $client_major plus récent que le serveur PostgreSQL $server_major : utilisez les outils clients $server_major (ex. /usr/lib/postgresql/$server_major/bin)"
# Manifeste calculé juste avant le dump (instantané cohérent entre ses propres lignes).
psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" > "$work/manifest" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'migrations' || E'\t' || count(*) FILTER (WHERE finished_at IS NOT NULL) FROM _prisma_migrations;
SELECT 'policies' || E'\t' || count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT 'rls_tables' || E'\t' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity;
SELECT 'rows:' || relname || E'\t' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY relname;
COMMIT;
SQL
# NB : le manifeste est calculé juste avant le dump ; sur une base très active, de légers écarts de comptage sont normaux.
pg_dump --format=custom --compress=6 --no-owner --no-acl "$DB" | encrypt > "$work/$name"
[ -s "$work/$name" ] || die "Sauvegarde vide"
( cd "$work" && sha256sum "$name" > "$name.sha256" )
mv "$work/$name" "$work/$name.sha256" "$DIR/daily/"
mv "$work/manifest" "$DIR/daily/$name.manifest"
size="$(du -h "$DIR/daily/$name" | cut -f1)"
log "Sauvegarde écrite : daily/$name ($size)"

[ "$(date -u +%u)" = 7 ] && cp "$DIR/daily/$name"* "$DIR/weekly/"
[ "$(date -u +%d)" = 01 ] && cp "$DIR/daily/$name"* "$DIR/monthly/"

# Rotation : on ne garde que les N plus récentes de chaque famille.
prune() { # $1 = dossier, $2 = nombre à garder (les noms portent l'horodatage : l'ordre alphabétique inverse = du plus récent au plus ancien)
  local f
  for f in "$DIR/$1"/restaurant-*.dump.age "$DIR/$1"/restaurant-*.dump.enc; do [ -e "$f" ] && echo "$f"; done | sort -r | tail -n +$(($2 + 1)) \
    | while read -r f; do rm -f "$f" "$f.sha256" "$f.manifest"; done || true
}
prune daily "${KEEP_DAILY:-7}"; prune weekly "${KEEP_WEEKLY:-4}"; prune monthly "${KEEP_MONTHLY:-6}"

# Copie hors site (compatible S3 : AWS, R2, MinIO…). La rétention distante se règle par une règle de cycle de vie du bucket.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID est obligatoire pour la copie S3}" "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY est obligatoire}"
  region="${AWS_DEFAULT_REGION:-us-east-1}"; endpoint="${BACKUP_S3_ENDPOINT:-https://s3.$region.amazonaws.com}"; prefix="${BACKUP_S3_PREFIX:-restaurant-backups}"
  for f in "$name" "$name.sha256" "$name.manifest"; do
    hash="$(sha256sum "$DIR/daily/$f" | cut -d' ' -f1)"
    curl -sS --fail --retry 3 --aws-sigv4 "aws:amz:$region:s3" --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
      -H "x-amz-content-sha256: $hash" -T "$DIR/daily/$f" "${endpoint%/}/$BACKUP_S3_BUCKET/$prefix/daily/$f" >/dev/null \
      || die "Copie S3 échouée : $f"
  done
  log "Copie hors site : $BACKUP_S3_BUCKET/$prefix/daily/$name"
fi
date -u +%s > "$DIR/last-success"
log "Sauvegarde terminée : $name"
