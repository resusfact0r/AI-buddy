#!/bin/sh
set -eu
go vet ./...
go test ./... -count=1 -coverpkg=./... -coverprofile=coverage.out
go tool cover -html=coverage.out -o coverage.html
go tool cover -func=coverage.out > coverage.txt
cat coverage.txt
awk '/^total:/ {gsub(/%/, "", $3); if (($3+0) <= 80) exit 1; found=1} END {if (!found) exit 1}' coverage.txt
