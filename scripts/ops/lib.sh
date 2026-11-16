# shellcheck shell=bash
# Fonctions communes aux scripts de sauvegarde / restauration (à sourcer).
log() { printf '{"time":"%s","level":"%s","context":"backup","msg":"%s"}\n' "$(date -u +%FT%TZ)" "${2:-info}" "$1" >&2; }
die() { log "$1" error; exit 1; }

# Chiffrement : age (clé publique, recommandé : la clé privée reste hors du serveur) ou phrase secrète (openssl AES-256, PBKDF2).
encrypt() { # stdin -> stdout
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then age -r "$BACKUP_AGE_RECIPIENT"
  else BACKUP_PASS="$(secret)" openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASS; fi
}
decrypt() { # $1 = fichier chiffré, stdout = clair
  case "$1" in
    *.age) [ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ] || die "BACKUP_AGE_IDENTITY_FILE (clé privée age) est obligatoire pour lire un fichier .age"
            age -d -i "$BACKUP_AGE_IDENTITY_FILE" "$1" ;;
    *.enc) BACKUP_PASS="$(secret)" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASS -in "$1" ;;
    *) die "Extension inconnue : $1 (attendu .age ou .enc)" ;;
  esac
}
secret() {
  if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then cat "$BACKUP_PASSPHRASE_FILE"
  elif [ -n "${BACKUP_PASSPHRASE:-}" ]; then printf '%s' "$BACKUP_PASSPHRASE"
  else die "Aucune clé de chiffrement : définissez BACKUP_AGE_RECIPIENT (age) ou BACKUP_PASSPHRASE / BACKUP_PASSPHRASE_FILE"; fi
}
ext() { if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then echo age; else echo enc; fi; }
