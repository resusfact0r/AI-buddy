#!/bin/sh
set -eu
: "${DATABASE_URL:?Set DATABASE_URL to the Postgres connection URL}"
: "${CORP_TOKEN:?Set CORP_TOKEN}"
[ "${#JWT_SECRET}" -ge 32 ] || { echo 'JWT_SECRET must have at least 32 characters' >&2; exit 1; }
migrate -path /migrations -database "$DATABASE_URL" up
sh /runtime-env.sh
children=""
stop() {
  trap - TERM INT EXIT
  for pid in $children; do kill "$pid" 2>/dev/null || true; done
  wait || true
}
trap stop EXIT
trap 'exit 0' TERM INT
for service in corp-mock api mcp agent; do
  "$service" &
  children="$children $!"
done
nginx -g 'daemon off;' &
children="$children $!"
while :; do
  for pid in $children; do kill -0 "$pid" 2>/dev/null || exit 1; done
  sleep 1
done
