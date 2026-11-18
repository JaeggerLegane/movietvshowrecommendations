#!/bin/sh
# Runs Next Watch on the Synology NAS and keeps it up to date with GitHub.
# Started by nas/docker-compose.yml. Every few minutes it checks GitHub; when there is a
# new version it downloads it and restarts the app by itself. Your data in /data
# is never touched by an update.
set -u
CODE_DIR="${CODE_DIR:-/code}"
cd "$CODE_DIR" || exit 1
git config --global --add safe.directory "$CODE_DIR"
export NPM_CONFIG_UPDATE_NOTIFIER=false
REMOTE="${REPO_URL:-https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git}"
git remote set-url origin "$REMOTE"

if git fetch -q origin main && git reset -q --hard origin/main; then
  echo "Code is up to date: $(git log -1 --format='%h %s')"
else
  echo "Could not reach GitHub (check GITHUB_TOKEN); starting the version that is already here."
fi

# Install the app's packages the first time, and again whenever they change.
LOCK_HASH="$(md5sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "Installing packages..."
  if npm ci --omit=dev --no-audit --no-fund --loglevel=error; then
    echo "$LOCK_HASH" > node_modules/.lock-hash
  else
    echo "Installing packages failed; trying to start anyway."
  fi
fi

# Shown on the Status page, so you can see which version is running.
APP_VERSION="$(git log -1 --format='%h' 2>/dev/null)"
APP_VERSION_TITLE="$(git log -1 --format='%s' 2>/dev/null)"
APP_VERSION_DATE="$(git log -1 --format='%cI' 2>/dev/null)"
export APP_VERSION APP_VERSION_TITLE APP_VERSION_DATE

node server.js &
PID=$!
trap 'kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; exit 0' TERM INT

while true; do
  sleep "${UPDATE_EVERY:-300}" &
  wait $!
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "The app stopped; starting it again."
    exec sh "$CODE_DIR/nas/run.sh"
  fi
  if git fetch -q origin main 2>/dev/null && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "New version on GitHub: $(git log -1 --format='%h %s' origin/main). Updating."
    git reset -q --hard origin/main
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
    exec sh "$CODE_DIR/nas/run.sh"
  fi
done
