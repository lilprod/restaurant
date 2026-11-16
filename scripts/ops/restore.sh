#!/usr/bin/env bash
# Restaure une sauvegarde dans une base VIDE (créée si absente) puis vérifie sa cohérence. Ne supprime jamais rien.
#   scripts/ops/restore.sh <fichier.dump.{age|enc}> [base_cible]        (défaut : restaurant_restore)
# Connexion : PGHOST PGPORT PGUSER PGPASSWORD (compte pouvant créer une base). Déchiffrement : voir lib.sh.
# RESTORE_OWNER=<rôle> : propriétaire des objets restaurés (rôle propriétaire des tables en production).
# VERIFY_STRICT=1 : un écart de nombre de lignes avec le manifeste fait échouer la vérification (sauvegarde faite sans trafic).
# Procédure complète (restauration en production incluse) : scripts/ops/restore.md
set -euo pipefail
. "$(dirname "$0")/lib.sh"
umask 077
file="${1:?usage : restore.sh FICHIER_CHIFFRE [BASE_CIBLE]}"; target="${2:-restaurant_restore}"
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || die "Nom de base invalide"
[ -f "$file" ] || die "Fichier introuvable : $file"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [ -f "$file.sha256" ]; then ( cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" >/dev/null ) || die "Somme SHA-256 invalide : fichier corrompu"; log "Somme SHA-256 vérifiée"
else log "Pas de fichier .sha256 : intégrité non vérifiée" warn; fi

exists="$(psql -X -At -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [ -n "$exists" ]; then
  n="$(psql -X -At -d "$target" -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
  [ "$n" = 0 ] || die "La base « $target » n'est pas vide ($n tables) : restauration refusée"
else
  createdb ${RESTORE_OWNER:+-O "$RESTORE_OWNER"} "$target"; log "Base « $target » créée"
fi

decrypt "$file" > "$work/db.dump" || die "Déchiffrement impossible (mauvaise clé ?)"
ro=(); [ -n "${RESTORE_OWNER:-}" ] && ro=(--role="$RESTORE_OWNER")
pg_restore --no-owner --no-acl --exit-on-error "${ro[@]}" -d "$target" "$work/db.dump"
log "pg_restore terminé dans « $target »"

# ── Vérifications de cohérence ──
fail=0
q() { psql -X -At -d "$target" -c "$1"; }
mig="$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
unfinished="$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL")"
badfk="$(q "SELECT count(*) FROM pg_constraint WHERE NOT convalidated")"
pol="$(q "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")"
rls="$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity")"
echo "migrations appliquées : $mig · politiques RLS : $pol · tables sous RLS forcée : $rls · contraintes non validées : $badfk"
[ "$unfinished" = 0 ] || { echo "ÉCHEC : $unfinished migration(s) inachevée(s)"; fail=1; }
[ "$badfk" = 0 ] || { echo "ÉCHEC : contraintes non validées"; fail=1; }
[ "$rls" -gt 0 ] || { echo "ÉCHEC : aucune table sous RLS dans la base restaurée (rejouez scripts/deploy/migrate.sh)"; fail=1; }
# Clés étrangères : aucune ligne orpheline (validation explicite de chaque contrainte).
q "SELECT format('ALTER TABLE %s VALIDATE CONSTRAINT %I', conrelid::regclass, conname) FROM pg_constraint WHERE contype = 'f'" > "$work/validate.sql"
psql -X -q -v ON_ERROR_STOP=1 -d "$target" -f <(sed 's/$/;/' "$work/validate.sql") || { echo "ÉCHEC : clés étrangères invalides"; fail=1; }

manifest="$file.manifest"
if [ -f "$manifest" ]; then
  drift=0
  while IFS=$'\t' read -r key val; do
    case "$key" in
      migrations) [ "$val" = "$mig" ] || { echo "ÉCART migrations : sauvegarde $val, restauré $mig"; drift=1; } ;;
      rls_tables) [ "$val" = "$rls" ] || { echo "ÉCART tables sous RLS : sauvegarde $val, restauré $rls"; drift=1; } ;;
      policies)   [ "$val" = "$pol" ] || { echo "ÉCART politiques RLS : sauvegarde $val, restauré $pol"; drift=1; } ;;
      rows:*)     t="${key#rows:}"; got="$(q "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo manquante)"
                  [ "$val" = "$got" ] || { echo "ÉCART $t : sauvegarde $val, restauré $got"; drift=1; } ;;
    esac
  done < "$manifest"
  if [ "$drift" = 0 ]; then echo "Manifeste : tous les comptages correspondent"
  elif [ "${VERIFY_STRICT:-0}" = 1 ]; then fail=1; else echo "(écarts tolérés : sauvegarde faite sur une base active ; VERIFY_STRICT=1 pour les refuser)"; fi
else log "Pas de manifeste : comptages non comparés" warn; fi

[ "$fail" = 0 ] && echo "✔ Restauration vérifiée dans « $target »" || { echo "✘ Restauration NON conforme dans « $target »"; exit 3; }
