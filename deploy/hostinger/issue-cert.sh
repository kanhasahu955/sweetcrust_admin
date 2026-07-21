#!/usr/bin/env bash
# Issue Let's Encrypt cert for admin.skbakery.in (uses backend_v2 certbot volumes + nginx).
# Run on the VPS after admin container is up and DNS points here.
set -euo pipefail

BACKEND="${BACKEND_PATH:-/opt/sweetcrust/backend_v2}"
DOMAIN="${ADMIN_DOMAIN:-admin.skbakery.in}"
EMAIL="${CERTBOT_EMAIL:-}"

if [[ -f /opt/sweetcrust/admin/.env.production ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/sweetcrust/admin/.env.production
  set +a
  DOMAIN="${ADMIN_DOMAIN:-$DOMAIN}"
  EMAIL="${CERTBOT_EMAIL:-$EMAIL}"
fi
if [[ -z "$EMAIL" && -f "${BACKEND}/.env.production" ]]; then
  # shellcheck disable=SC1091
  EMAIL="$(grep -E '^CERTBOT_EMAIL=' "${BACKEND}/.env.production" | head -1 | cut -d= -f2-)"
fi
if [[ -z "$EMAIL" || "$EMAIL" == CHANGE_ME@* ]]; then
  echo "Set CERTBOT_EMAIL in admin or backend .env.production" >&2
  exit 1
fi

cd "$BACKEND"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

# Ensure bootstrap/API nginx is serving ACME on :80
if ! curl -fsS --max-time 5 "http://127.0.0.1/" >/dev/null 2>&1 \
   && ! curl -fsS --max-time 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1/" | grep -qE '301|302|200|404'; then
  echo "HTTP :80 not reachable — start backend nginx first." >&2
  exit 1
fi

echo "Requesting certificate for ${DOMAIN}…"
"${COMPOSE[@]}" --profile certbot run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --cert-name "${DOMAIN}"

# Install combined nginx (API + admin) if present
ACTIVE="${BACKEND}/nginx/nginx.prod.active.conf"
COMBINED="${BACKEND}/nginx/nginx.prod.with-admin.conf"
if [[ -f "$COMBINED" ]]; then
  cp "$COMBINED" "$ACTIVE"
elif [[ -f "${BACKEND}/nginx/nginx.prod.conf" ]]; then
  # Append admin TLS server from snippet
  SNIPPET="${BACKEND}/nginx/admin.skbakery.in.conf"
  if [[ -f "$SNIPPET" ]]; then
    cat "${BACKEND}/nginx/nginx.prod.conf" "$SNIPPET" > "$ACTIVE"
  fi
fi

"${COMPOSE[@]}" up -d nginx
"${COMPOSE[@]}" exec -T nginx nginx -t
"${COMPOSE[@]}" exec -T nginx nginx -s reload

echo "TLS enabled → https://${DOMAIN}/"
curl -fsSI "https://${DOMAIN}/" | head -5
