#!/bin/sh
# Линтер: gofmt + go vet, а при наличии — golangci-lint (конфиг .golangci.yml).
set -e
GO="${GO:-go}"
unformatted="$(gofmt -l .)"
if [ -n "$unformatted" ]; then
  echo "gofmt: неотформатированные файлы:"
  echo "$unformatted"
  exit 1
fi
"$GO" vet ./...
if command -v golangci-lint >/dev/null 2>&1; then
  golangci-lint run ./...
else
  echo "golangci-lint не установлен — выполнены gofmt и go vet"
fi
