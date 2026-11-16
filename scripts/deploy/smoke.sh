#!/usr/bin/env bash
# Contrôle après déploiement (et en CI) : la pile répond, les en-têtes de sécurité sont là, la connexion SuperAdmin fonctionne.
#   BASE_URL=https://app.monapp.com SMOKE_SUPERADMIN_EMAIL=… SMOKE_SUPERADMIN_PASSWORD=… bash scripts/deploy/smoke.sh
# BASE_URL : défaut http://127.0.0.1:8080. Sans identifiants, la connexion n'est pas testée. Code de sortie 0 = tout est conforme.
set -uo pipefail
URL="${BASE_URL:-http://127.0.0.1:8080}"; fail=0
ok() { echo "✔ $1"; }; ko() { echo "✘ $1"; fail=1; }
hdr() { curl -sSI --max-time 10 "$URL$1" | tr -d '\r'; }

body="$(curl -sS --max-time 10 "$URL/api/v1/health")"
echo "$body" | grep -q '"status":"ok"' && ok "health : $body" || ko "health : $body"
echo "$body" | grep -q '"redis":"up"' && ok "Redis joignable (file des notifications)" || ko "Redis non joignable"

h="$(hdr /)"
for want in "content-security-policy: default-src 'self'; script-src 'self'" "permissions-policy: camera=()" "referrer-policy: strict-origin-when-cross-origin" "x-content-type-options: nosniff" "x-frame-options: DENY"; do
  grep -qiF "$want" <<<"$h" && ok "en-tête : ${want%%:*}" || ko "en-tête manquant : $want"
done
grep -qi "frame-ancestors 'none'" <<<"$h" && ok "CSP : frame-ancestors 'none'" || ko "CSP sans frame-ancestors 'none'"
grep -qiE "^HTTP/[0-9.]+ 200" <<<"$h" && ok "page d'accueil servie" || ko "page d'accueil en erreur"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/r/demo/login")" = 200 ] && ok "repli SPA (route inconnue → index.html)" || ko "repli SPA absent"
hsts="$(curl -sSI --max-time 10 -H 'X-Forwarded-Proto: https' "$URL/" | grep -ci '^strict-transport-security')"
[ "$hsts" = 1 ] && ok "HSTS présent derrière un terminateur TLS" || ko "HSTS absent (X-Forwarded-Proto: https)"
js="$(curl -s "$URL/" | grep -o '/assets/[^"]*\.js' | head -1)"
hdr "$js" | grep -qi "cache-control: public, max-age=31536000, immutable" && ok "assets en cache long" || ko "cache des assets"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL$js.map")" = 404 ] && ok "pas de cartes de sources" || ko "cartes de sources exposées"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/docs")" != 200 ] && ok "Swagger fermé" || ko "Swagger ouvert en production"
echo "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H 'content-type: application/json' -d '{"email":"x","password":"x"}' "$URL/api/v1/platform/auth/login")" | grep -qE '^(400|401|429)$' && ok "connexion plateforme : refuse des identifiants invalides" || ko "connexion plateforme : réponse inattendue"

if [ -n "${SMOKE_SUPERADMIN_EMAIL:-}" ] && [ -n "${SMOKE_SUPERADMIN_PASSWORD:-}" ]; then
  payload="$(printf '{"email":"%s","password":"%s"}' "$SMOKE_SUPERADMIN_EMAIL" "$SMOKE_SUPERADMIN_PASSWORD")"
  code="$(curl -sS -o /tmp/smoke-login.$$ -w '%{http_code}' --max-time 10 -H 'content-type: application/json' -H 'X-Session-Transport: cookie' -d "$payload" "$URL/api/v1/platform/auth/login")"
  [ "$code" = 200 ] && ok "connexion SuperAdmin (HTTP 200)" || ko "connexion SuperAdmin : HTTP $code"
  rm -f /tmp/smoke-login.$$
fi
[ "$fail" = 0 ] && echo "Tout est conforme." || echo "Des contrôles ont échoué."
exit "$fail"
