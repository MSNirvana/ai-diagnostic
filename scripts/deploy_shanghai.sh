#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

REMOTE_HOST="${REMOTE_HOST:-111.231.168.75}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/ubuntu/ai-diagnostic}"
REMOTE_FRONTEND_STAGE_DIR="${REMOTE_FRONTEND_STAGE_DIR:-/home/ubuntu/ai-diagnostic-frontend}"
REMOTE_FRONTEND_PUBLIC_DIR="${REMOTE_FRONTEND_PUBLIC_DIR:-/var/www/ai-diagnostic}"
REMOTE_BACKEND_SERVICE="${REMOTE_BACKEND_SERVICE:-ai-diagnostic.service}"

usage() {
  cat <<'EOF'
Usage:
  DEPLOY_PASSWORD='your-password' ./scripts/deploy_shanghai.sh

Optional environment variables:
  REMOTE_HOST                  Default: 111.231.168.75
  REMOTE_USER                  Default: ubuntu
  REMOTE_APP_DIR               Default: /home/ubuntu/ai-diagnostic
  REMOTE_FRONTEND_STAGE_DIR    Default: /home/ubuntu/ai-diagnostic-frontend
  REMOTE_FRONTEND_PUBLIC_DIR   Default: /var/www/ai-diagnostic
  REMOTE_BACKEND_SERVICE       Default: ai-diagnostic.service
  SKIP_TESTS=1                 Skip local backend/frontend checks
  SKIP_BUILD=1                 Skip frontend build (requires existing frontend/dist)
  SKIP_BACKEND_PIP=1           Skip remote backend pip install -e ".[dev]"
  RSYNC_DELETE=0               Do not delete remote files during rsync

Notes:
  1. Password is read from DEPLOY_PASSWORD and is never stored in the repo.
  2. Requires local tools: sshpass, rsync, npm, and backend .venv.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Missing dependency: sshpass" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Missing dependency: rsync" >&2
  exit 1
fi

if [[ -z "${DEPLOY_PASSWORD:-}" ]]; then
  echo "DEPLOY_PASSWORD is required." >&2
  usage
  exit 1
fi

RSYNC_DELETE_FLAG="--delete"
if [[ "${RSYNC_DELETE:-1}" == "0" ]]; then
  RSYNC_DELETE_FLAG=""
fi

export SSHPASS="$DEPLOY_PASSWORD"

run_local_checks() {
  echo "[1/6] Running local checks..."
  if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
    (
      cd "$FRONTEND_DIR"
      npx tsc --noEmit
    )
    (
      cd "$BACKEND_DIR"
      .venv/bin/python -m pytest -q
    )
  else
    echo "  - Local checks skipped"
  fi
}

build_frontend() {
  echo "[2/6] Building frontend..."
  if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
    (
      cd "$FRONTEND_DIR"
      npx vite build
    )
  else
    echo "  - Frontend build skipped"
  fi
}

sync_backend() {
  echo "[3/6] Syncing backend/app repo files to server..."
  ssh-keyscan -T 5 -t ed25519 "$REMOTE_HOST" 2>/dev/null >> "$HOME/.ssh/known_hosts" || true
  sshpass -e rsync -az ${RSYNC_DELETE_FLAG} \
    --exclude '.git' \
    --exclude 'backend/.venv' \
    --exclude 'backend/.pytest_cache' \
    --exclude 'frontend/node_modules' \
    --exclude 'frontend/dist' \
    --exclude 'frontend/tsconfig.tsbuildinfo' \
    --exclude '.pytest_cache' \
    --exclude '__pycache__' \
    --exclude '.DS_Store' \
    --exclude 'data/*.db' \
    --exclude 'backend/data' \
    --exclude 'data/uploads' \
    "$ROOT_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_APP_DIR/"
}

sync_frontend() {
  echo "[4/6] Syncing frontend static assets..."
  sshpass -e rsync -av ${RSYNC_DELETE_FLAG} \
    "$FRONTEND_DIR/dist/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_FRONTEND_STAGE_DIR/"

  sshpass -e ssh "$REMOTE_USER@$REMOTE_HOST" \
    "sudo rsync -av ${RSYNC_DELETE_FLAG} '$REMOTE_FRONTEND_STAGE_DIR/' '$REMOTE_FRONTEND_PUBLIC_DIR/' \
      && sudo chown -R www-data:www-data '$REMOTE_FRONTEND_PUBLIC_DIR'"
}

restart_backend() {
  echo "[5/6] Restarting backend service..."
  local pip_cmd="true"
  if [[ "${SKIP_BACKEND_PIP:-0}" != "1" ]]; then
    pip_cmd="cd '$REMOTE_APP_DIR/backend' && .venv/bin/pip install -e \".[dev]\" >/tmp/ai_diagnostic_pip.log 2>&1"
  fi

  sshpass -e ssh "$REMOTE_USER@$REMOTE_HOST" "
    set -e
    $pip_cmd
    sudo systemctl restart '$REMOTE_BACKEND_SERVICE'
    sleep 2
    sudo systemctl is-active '$REMOTE_BACKEND_SERVICE'
  "
}

verify_remote() {
  echo "[6/6] Verifying remote service..."
  sshpass -e ssh "$REMOTE_USER@$REMOTE_HOST" "
    set -e
    sudo systemctl status '$REMOTE_BACKEND_SERVICE' --no-pager -l | sed -n '1,40p'
    echo '---'
    curl -sSf http://127.0.0.1:8000/docs >/dev/null && echo 'backend_ok'
    echo '---'
    ls -la '$REMOTE_FRONTEND_PUBLIC_DIR/assets' | sed -n '1,20p'
  "

  curl -I --max-time 10 "http://$REMOTE_HOST/" >/dev/null
  echo "deploy_ok"
}

run_local_checks
build_frontend
sync_backend
sync_frontend
restart_backend
verify_remote

