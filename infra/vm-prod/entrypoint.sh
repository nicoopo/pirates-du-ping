#!/bin/sh
set -eu

test -s /run/deploy_key.pub || {
  echo 'Clé publique absente : monter deploy_key.pub dans /run/deploy_key.pub' >&2
  exit 1
}
cp /run/deploy_key.pub /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
ssh-keygen -A

dockerd --host=unix:///var/run/docker.sock &
docker_pid=$!
/usr/sbin/sshd -D -e &
ssh_pid=$!

trap 'kill "$ssh_pid" "$docker_pid" 2>/dev/null || true; wait' TERM INT
while kill -0 "$docker_pid" 2>/dev/null && kill -0 "$ssh_pid" 2>/dev/null; do
  sleep 1 &
  wait $! || true
done
kill "$ssh_pid" "$docker_pid" 2>/dev/null || true
wait || true
exit 1
