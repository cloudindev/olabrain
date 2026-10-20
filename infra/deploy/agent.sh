#!/usr/bin/env bash
# Deploys the voice worker to LiveKit Cloud (ADR-011).
#   infra/deploy/agent.sh create   # first time (registers the agent, writes livekit.toml)
#   infra/deploy/agent.sh deploy   # new version
#   infra/deploy/agent.sh secrets  # update secrets from .env.agent
# Needs LIVEKIT_URL (https://…livekit.cloud), LIVEKIT_API_KEY, LIVEKIT_API_SECRET in the
# environment (e.g. `set -a; . ./.env.production; set +a`) and secrets in .env.agent.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# A clean folder with only the Python worker, so the CLI detects a Python agent (the
# monorepo root has a package.json) and the build context stays small.
cp "$ROOT/apps/agent/pyproject.toml" "$ROOT/apps/agent/uv.lock" "$STAGE/"
cp -R "$ROOT/apps/agent/src" "$STAGE/src"
cp -R "$ROOT/config" "$STAGE/config"
cp "$ROOT/infra/deploy/agent/Dockerfile" "$ROOT/infra/deploy/agent/.dockerignore" "$STAGE/"
[ -f "$ROOT/infra/deploy/agent/livekit.toml" ] && cp "$ROOT/infra/deploy/agent/livekit.toml" "$STAGE/"
export LIVEKIT_URL="${LIVEKIT_URL/wss:\/\//https://}"

case "${1:-deploy}" in
  create) lk agent create --region eu-central --secrets-file "$ROOT/.env.agent" -y "$STAGE"
          cp "$STAGE/livekit.toml" "$ROOT/infra/deploy/agent/livekit.toml" ;;
  deploy) lk agent deploy -y "$STAGE" ;;
  secrets) (cd "$STAGE" && lk agent update-secrets --secrets-file "$ROOT/.env.agent" -y) ;;
  *) echo "usage: $0 create|deploy|secrets" >&2; exit 1 ;;
esac
