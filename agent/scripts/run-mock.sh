#!/bin/sh
# Локальный запуск без Docker и без Бэкенда 1:
# имитация API (:8080) + MCP (:8082) + агент (:8081) в mock-режиме.
# Только синтетические данные. Остановить — Ctrl+C.
set -e
cd "$(dirname "$0")/.."

./bin/fakeapi &
FAKEAPI_PID=$!
sleep 0.5
API_BASE_URL=http://localhost:8080 ./bin/mcp &
MCP_PID=$!
sleep 0.5
API_BASE_URL=http://localhost:8080 MCP_URL=http://localhost:8082 LLM_PROVIDER="${LLM_PROVIDER:-mock}" ./bin/agent &
AGENT_PID=$!

stop() {
  kill "$FAKEAPI_PID" "$MCP_PID" "$AGENT_PID" 2>/dev/null || true
}
trap stop INT TERM EXIT

echo "fakeapi :8080, mcp :8082, agent :8081 — токен Анны: fake.intern_anna.token"
wait
