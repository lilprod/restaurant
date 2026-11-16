#!/usr/bin/env bash
# Planificateur du conteneur « backup » : une sauvegarde par jour à BACKUP_AT (HH:MM, UTC), et une tout de suite s'il n'en existe aucune.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
DIR="${BACKUP_DIR:-/backups}"; AT="${BACKUP_AT:-02:30}"
[[ "$AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "BACKUP_AT invalide (HH:MM)"
[ -n "${BACKUP_AGE_RECIPIENT:-}${BACKUP_PASSPHRASE:-}${BACKUP_PASSPHRASE_FILE:-}" ] || die "Aucune clé de chiffrement : définissez BACKUP_PASSPHRASE ou BACKUP_AGE_RECIPIENT"
[ -f "$DIR/last-success" ] || /ops/backup.sh || log "Première sauvegarde échouée" error
while true; do
  now="$(date -u +%s)"; next="$(date -u -d "today $AT" +%s)"; [ "$next" -gt "$now" ] || next="$(date -u -d "tomorrow $AT" +%s)"
  log "Prochaine sauvegarde dans $((next - now)) s"
  sleep "$((next - now))"
  /ops/backup.sh || log "Sauvegarde échouée" error
done
