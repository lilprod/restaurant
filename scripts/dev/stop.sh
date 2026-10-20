#!/usr/bin/env bash
# Arrête les serveurs lancés par start.sh (PID enregistrés dans .dev-pids), processus enfants compris.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.dev-pids" ] || { echo "Aucun serveur enregistré."; exit 0; }
while read -r pid; do
  [ -n "$pid" ] || continue
  pkill -TERM -P "$pid" 2>/dev/null || true   # enfants éventuels (par PID parent, pas par motif)
  kill "$pid" 2>/dev/null || true
done < "$ROOT/.dev-pids"
rm -f "$ROOT/.dev-pids"
echo "Serveurs arrêtés."
