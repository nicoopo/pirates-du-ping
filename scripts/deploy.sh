#!/bin/sh
set -eu

# L'identité SSH et le fichier known_hosts sont fournis par le poste ou le runner.
: "${DEPLOY_KEY:?Chemin de la clé SSH requis}"
: "${DEPLOY_KNOWN_HOSTS:?Chemin du fichier known_hosts requis}"
: "${DEPLOY_ENV_FILE:?Chemin du fichier .env de production requis}"
test -s "$DEPLOY_KEY"
test -s "$DEPLOY_KNOWN_HOSTS"
test -s "$DEPLOY_ENV_FILE"
DEPLOY_PULL_POLICY=${DEPLOY_PULL_POLICY:-always}
case "$DEPLOY_PULL_POLICY" in
  always|never) ;;
  *) echo 'DEPLOY_PULL_POLICY doit valoir always ou never' >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."

# Valider sans imprimer la configuration contenant les secrets.
docker compose --env-file "$DEPLOY_ENV_FILE" -f compose.prod.yml config --quiet

ssh -i "$DEPLOY_KEY" -p 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  root@localhost 'mkdir -p /srv/flotte && chmod 700 /srv/flotte'
scp -i "$DEPLOY_KEY" -P 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  compose.prod.yml root@localhost:/srv/flotte/compose.prod.yml
scp -i "$DEPLOY_KEY" -P 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  "$DEPLOY_ENV_FILE" root@localhost:/srv/flotte/.env
if [ -n "${DEPLOY_REGISTRY_TOKEN:-}" ]; then
  : "${DEPLOY_REGISTRY_USER:?Utilisateur du registre requis}"
  printf '%s' "$DEPLOY_REGISTRY_TOKEN" | ssh -i "$DEPLOY_KEY" -p 2222 -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
    root@localhost "docker --config /srv/flotte/.registry login ghcr.io --username '$DEPLOY_REGISTRY_USER' --password-stdin"
fi
ssh -i "$DEPLOY_KEY" -p 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  root@localhost sh -s -- "$DEPLOY_PULL_POLICY" <<'REMOTE'
    set -eu
    cd /srv/flotte
    if [ -d /srv/flotte/.registry ]; then
      export DOCKER_CONFIG=/srv/flotte/.registry
      trap 'rm -f /srv/flotte/.registry/config.json' EXIT
    fi
    chmod 600 .env
    docker compose -f compose.prod.yml config --quiet
    if [ "$1" = always ]; then
      docker compose -f compose.prod.yml pull
    else
      # Les trois images applicatives doivent déjà être chargées sur la cible.
      docker compose -f compose.prod.yml pull db
    fi
    docker compose -f compose.prod.yml up -d --no-build --pull never --wait --wait-timeout 30
    docker compose -f compose.prod.yml ps
REMOTE
