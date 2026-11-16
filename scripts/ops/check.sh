#!/usr/bin/env bash
# Supervision minimale : à lancer toutes les 5 minutes (cron) ou depuis un moniteur externe. Code de sortie 0 = tout va bien.
#   */5 * * * * cd /opt/restaurant && ./scripts/ops/check.sh >> /var/log/restaurant-check.log 2>&1
# Contrôles : réponse de /api/v1/health à travers nginx (base + Redis), état des conteneurs, âge de la dernière sauvegarde, espace disque.
# Variables : CHECK_URL (http://127.0.0.1:8080)  COMPOSE_FILE (docker-compose.prod.yml)  ENV_FILE (.env)  DISK_PATH (/var/lib/docker)
#   DISK_MAX_PERCENT (85)  ALERT_WEBHOOK_URL (POST JSON {"text","content"} : Slack, Mattermost, Discord… ; vide = pas d'alerte)
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
URL="${CHECK_URL:-http://127.0.0.1:8080}"; COMPOSE=(docker compose -f "${COMPOSE_FILE:-docker-compose.prod.yml}" --env-file "${ENV_FILE:-.env}")
problems=()

health="$(curl -sS --max-time 10 "$URL/api/v1/health" 2>&1)" || true
echo "$health" | grep -q '"status":"ok"' || problems+=("health KO : ${health:0:200}")

while read -r svc state health; do
  [ -n "$svc" ] || continue
  case "$svc:$state" in migrate:exited) continue ;; esac
  [ "$state" = running ] || problems+=("conteneur $svc : $state")
  [ "$health" != unhealthy ] || problems+=("conteneur $svc : unhealthy")
done < <("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)

msg="$("${COMPOSE[@]}" exec -T backup /ops/backup-status.sh 2>&1)" || problems+=("sauvegarde : $msg")

used="$(df --output=pcent "${DISK_PATH:-/var/lib/docker}" 2>/dev/null | tail -1 | tr -dc 0-9)"
[ -z "$used" ] || [ "$used" -lt "${DISK_MAX_PERCENT:-85}" ] || problems+=("disque plein à ${used} %")

if [ "${#problems[@]}" -eq 0 ]; then echo "$(date -u +%FT%TZ) OK"; exit 0; fi
text="[restaurant] $(hostname) : $(IFS=';'; echo "${problems[*]}")"
echo "$(date -u +%FT%TZ) ALERTE $text"
[ -z "${ALERT_WEBHOOK_URL:-}" ] || curl -sS --max-time 10 -H 'content-type: application/json' -d "$(printf '{"text":"%s","content":"%s"}' "${text//\"/\'}" "${text//\"/\'}")" "$ALERT_WEBHOOK_URL" >/dev/null || true
exit 1
