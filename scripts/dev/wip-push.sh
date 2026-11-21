#!/usr/bin/env bash
# Sauvegarde le travail en cours (fichiers suivis, modifiés et nouveaux, hors .gitignore) sur la branche distante wip/<ID>,
# SANS toucher à la branche courante, à l'index ni à l'arbre de travail (index temporaire + commit-tree).
#   bash scripts/dev/wip-push.sh X5B "point d'étape : API push terminée"
# Chaque appel ajoute un commit sur wip/<ID> (historique des instantanés). La CI ignore les branches wip/**.
# Reprise : git fetch origin wip/<ID> && git checkout origin/wip/<ID> -- . (ou git diff HEAD origin/wip/<ID>)
set -euo pipefail
ID="${1:?Usage : wip-push.sh <ID du sous-projet> [message]}"
MSG="${2:-instantané}"
[[ "$ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ID invalide : $ID" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)"
BRANCH="wip/$ID"
TMP_INDEX="$(mktemp)"; trap 'rm -f "$TMP_INDEX"' EXIT
cp .git/index "$TMP_INDEX" 2>/dev/null || true
export GIT_INDEX_FILE="$TMP_INDEX"
git add -A
TREE="$(git write-tree)"
unset GIT_INDEX_FILE
# Parent : le dernier instantané s'il existe (historique continu), sinon HEAD.
PARENT="$(git ls-remote --heads origin "$BRANCH" | cut -f1)"
if [ -n "$PARENT" ]; then git fetch -q origin "$BRANCH" || PARENT=""; fi
[ -n "$PARENT" ] || PARENT="$(git rev-parse HEAD)"
COMMIT="$(git commit-tree "$TREE" -p "$PARENT" -m "WIP $ID : $MSG (base $(git rev-parse --short HEAD))")"
for delay in 0 2 4 8 16; do
  sleep "$delay"
  if git push -q origin "$COMMIT:refs/heads/$BRANCH"; then echo "Instantané poussé : $BRANCH ($(git rev-parse --short "$COMMIT"))"; exit 0; fi
done
echo "Échec du push vers $BRANCH" >&2; exit 1
