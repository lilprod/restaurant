#!/usr/bin/env bash
# Sonde du conteneur « backup » : réussit si la dernière sauvegarde a moins de MAX_AGE_HOURS (26) heures.
f="${BACKUP_DIR:-/backups}/last-success"
[ -f "$f" ] || { echo "aucune sauvegarde réussie"; exit 1; }
age=$(( $(date -u +%s) - $(cat "$f") ))
[ "$age" -lt $(( ${MAX_AGE_HOURS:-26} * 3600 )) ] || { echo "dernière sauvegarde il y a $((age / 3600)) h"; exit 1; }
echo "dernière sauvegarde il y a $((age / 60)) min"
