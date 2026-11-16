#!/usr/bin/env bash
# Test de bout en bout de la sauvegarde : sauvegarde de $PGDATABASE → restauration dans une base temporaire → vérifications strictes,
# puis refus d'un fichier corrompu, d'une mauvaise clé et d'une cible non vide. Supprime seulement la base temporaire qu'il crée.
# Connexion : PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (base source, migrée, idéalement avec des données).
set -euo pipefail
cd "$(dirname "$0")"
SRC="${PGDATABASE:?PGDATABASE (base source) est obligatoire}"
TMPDB="${SRC}_restorecheck"; tmp="$(mktemp -d)"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $TMPDB" >/dev/null 2>&1; rm -rf "$tmp"' EXIT
export BACKUP_DIR="$tmp/backups" BACKUP_PASSPHRASE="phrase-de-test-$$-$RANDOM-aleatoire"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $TMPDB" >/dev/null

./backup.sh 2>/dev/null
f="$(ls "$BACKUP_DIR"/daily/*.dump.enc)"
[ -s "$f.sha256" ] && [ -s "$f.manifest" ] || { echo "ÉCHEC : sha256 ou manifeste absent"; exit 1; }
echo "✔ sauvegarde produite avec somme SHA-256 et manifeste"
! strings "$f" | grep -qi "PGDMP" || { echo "ÉCHEC : le fichier n'est pas chiffré"; exit 1; }

VERIFY_STRICT=1 ./restore.sh "$f" "$TMPDB" 2>&1 | tail -3
ok() { echo "✔ $1"; }; ko() { echo "ÉCHEC : $1"; exit 1; }
psql -X -At -d "$TMPDB" -c 'SELECT count(*) FROM "_prisma_migrations"' | grep -qv '^0$' && ok "base restaurée et vérifiée" || ko "migrations absentes"

expect() { local out; out="$("$@" 2>&1 || true)"; grep -q -- "$PATTERN" <<<"$out"; }   # sans pipe : grep -q + pipefail = faux échec (SIGPIPE)
PATTERN="n'est pas vide" expect ./restore.sh "$f" "$TMPDB" && ok "cible non vide refusée" || ko "cible non vide acceptée"
BACKUP_PASSPHRASE=autre-phrase PATTERN="Déchiffrement impossible" expect ./restore.sh "$f" "${TMPDB}_x" && ok "mauvaise clé refusée" || ko "mauvaise clé acceptée"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS ${TMPDB}_x" >/dev/null
cp "$f" "$tmp/c.dump.enc"; sed "s#restaurant-[0-9TZ]*\.dump\.enc#c.dump.enc#" "$f.sha256" > "$tmp/c.dump.enc.sha256"
printf 'X' | dd of="$tmp/c.dump.enc" bs=1 seek=64 conv=notrunc 2>/dev/null
PATTERN="corrompu" expect ./restore.sh "$tmp/c.dump.enc" "${TMPDB}_y" && ok "fichier corrompu refusé" || ko "fichier corrompu accepté"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS ${TMPDB}_y" >/dev/null
ok "sauvegarde / restauration : tous les contrôles passent"
