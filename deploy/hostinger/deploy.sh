#!/usr/bin/env bash
# Deploy admin → Hostinger VPS (/opt/sweetcrust/admin), same pattern as backend_v2.
#
#   ./deploy/hostinger/deploy.sh           # from laptop (rsync + remote compose)
#   ./deploy/hostinger/deploy.sh --ci      # GitHub Actions (SSH host: hostinger-vps)
#   ./deploy/hostinger/deploy.sh --local   # already on the VPS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-145.223.21.127}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/sweetcrust/admin}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
LOCAL=0
CI=0
SKIP_BUILD="${SKIP_BUILD:-0}"

for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    --ci) CI=1 ;;
    -h|--help)
      echo "Usage: $0 [--local|--ci]"
      exit 0
      ;;
  esac
done

need_env() {
  if [[ ! -f .env.production ]]; then
    echo "Missing .env.production — copy .env.production.example" >&2
    exit 1
  fi
  # Maps key is baked/served via NUXT_PUBLIC_* — empty key = blank live map in prod.
  local maps_key
  maps_key="$(grep -E '^NUXT_PUBLIC_GOOGLE_MAPS_API_KEY=' .env.production | head -1 | cut -d= -f2- | tr -d '\r' | tr -d "\"'")"
  if [[ -z "${maps_key}" ]]; then
    echo "NUXT_PUBLIC_GOOGLE_MAPS_API_KEY is empty in .env.production" >&2
    echo "Set it locally, or add GitHub secret NUXT_PUBLIC_GOOGLE_MAPS_API_KEY, then redeploy." >&2
    exit 1
  fi
}

compose_up() {
  need_env
  if [[ "$SKIP_BUILD" == "1" ]]; then
    "${COMPOSE[@]}" up -d --remove-orphans
  else
    "${COMPOSE[@]}" up -d --build --remove-orphans
  fi
  echo "Waiting for admin…"
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T admin wget -qO- --timeout=2 http://127.0.0.1:3000/ >/dev/null 2>&1; then
      echo "OK admin container responding"
      return 0
    fi
    sleep 3
  done
  echo "Admin health timed out — ${COMPOSE[*]} logs --tail=80 admin" >&2
  return 1
}

# Laptop: use hostinger_gha. CI: use Host hostinger-vps from ~/.ssh/config (no -i).
ssh_base() {
  if [[ "$CI" == "1" ]]; then
    echo ssh -o BatchMode=yes
  elif [[ -n "${DEPLOY_SSH_KEY:-}" && -f "${DEPLOY_SSH_KEY}" ]]; then
    echo ssh -o BatchMode=yes -i "${DEPLOY_SSH_KEY}"
  elif [[ -f "${HOME}/.ssh/hostinger_gha" ]]; then
    echo ssh -o BatchMode=yes -i "${HOME}/.ssh/hostinger_gha"
  else
    echo ssh -o BatchMode=yes
  fi
}

rsync_to() {
  local remote="$1"
  local ssh
  ssh="$(ssh_base)"
  $ssh "$remote" "mkdir -p '${DEPLOY_PATH}'"
  rsync -az --delete \
    -e "$ssh" \
    --exclude node_modules \
    --exclude .output \
    --exclude .nuxt \
    --exclude .data \
    --exclude .git \
    --exclude .env \
    --exclude '.env.*' \
    --exclude .DS_Store \
    ./ "${remote}:${DEPLOY_PATH}/"
  # scp uses same identity flags as ssh (strip leading "ssh ")
  local scp_flags="${ssh#ssh }"
  # shellcheck disable=SC2086
  scp $scp_flags .env.production "${remote}:${DEPLOY_PATH}/.env.production"
  $ssh "$remote" \
    "cd '${DEPLOY_PATH}' && chmod +x deploy/hostinger/*.sh && SKIP_BUILD=${SKIP_BUILD} ./deploy/hostinger/deploy.sh --local"
}

if [[ "$LOCAL" == "1" ]]; then
  compose_up
elif [[ "$CI" == "1" ]]; then
  need_env
  rsync_to hostinger-vps
else
  need_env
  rsync_to "${DEPLOY_USER}@${DEPLOY_HOST}"
fi

echo "Admin: https://admin.skbakery.in  (API: https://api.skbakery.in)"
