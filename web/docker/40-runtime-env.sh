#!/bin/sh
# Генерирует /env.js из переменных окружения контейнера — один образ для любых адресов бэкендов.
set -eu
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
cat > /usr/share/nginx/html/env.js <<EOF2
window.__ENV__ = {
  API_URL: "$(esc "${API_URL:-}")",
  AGENT_URL: "$(esc "${AGENT_URL:-}")",
  USE_MOCKS: "$(esc "${USE_MOCKS:-false}")"
};
EOF2
echo "runtime env.js: API_URL=${API_URL:-} AGENT_URL=${AGENT_URL:-} USE_MOCKS=${USE_MOCKS:-false}"
