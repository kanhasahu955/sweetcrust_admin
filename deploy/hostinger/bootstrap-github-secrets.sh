#!/usr/bin/env bash
# Copy Hostinger SSH secrets into sweetcrust_admin (same keys as sweetcrust_api).
#
#   ./deploy/hostinger/bootstrap-github-secrets.sh
#   ./deploy/hostinger/bootstrap-github-secrets.sh --email support@bakerywala.cloud
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-kanhasahu955/sweetcrust_admin}"
SSH_KEY_FILE="${HOSTINGER_SSH_KEY_FILE:-$HOME/.ssh/hostinger_gha}"
HOST="${HOSTINGER_HOST:-145.223.21.127}"
USER="${HOSTINGER_USER:-root}"
EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email=*) EMAIL="${1#*=}"; shift ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --repo=*) REPO="${1#*=}"; shift ;;
    -h|--help)
      echo "Usage: $0 [--email you@domain.com] [--repo owner/repo]"
      exit 0
      ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

command -v gh >/dev/null || { echo "Install gh and run: gh auth login" >&2; exit 1; }
gh auth status >/dev/null

gh secret set HOSTINGER_HOST --repo "$REPO" --body "$HOST"
gh secret set HOSTINGER_USER --repo "$REPO" --body "$USER"
if [[ -f "$SSH_KEY_FILE" ]]; then
  gh secret set HOSTINGER_SSH_KEY --repo "$REPO" <"$SSH_KEY_FILE"
  echo "set HOSTINGER_SSH_KEY from $SSH_KEY_FILE"
else
  echo "Missing $SSH_KEY_FILE — set HOSTINGER_SSH_KEY manually in GitHub." >&2
  exit 1
fi
if [[ -n "$EMAIL" ]]; then
  gh secret set CERTBOT_EMAIL --repo "$REPO" --body "$EMAIL"
fi

# Optional repo variables (defaults are already in the workflow)
gh variable set NUXT_PUBLIC_API_BASE --repo "$REPO" --body "https://api.skbakery.in" 2>/dev/null || true
gh variable set NUXT_PUBLIC_SOCKET_BASE --repo "$REPO" --body "https://api.skbakery.in" 2>/dev/null || true

echo "Secrets ready on $REPO — push to main to deploy."
