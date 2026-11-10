# Агент AI-buddy: сборка, тесты, покрытие, evals.
GO ?= go
# Покрытие считается по нашему коду в internal/ (без cmd/main.go, зависимостей и тестов).
COVERPKG = ./internal/...

.PHONY: build test coverage lint evals run-mock fmt

build:
	$(GO) build -o bin/ ./cmd/...

test:
	$(GO) test ./...

coverage:
	$(GO) test -coverpkg=$(COVERPKG) -coverprofile=coverage.out ./...
	$(GO) tool cover -html=coverage.out -o coverage.html
	@$(GO) tool cover -func=coverage.out | tail -1

lint:
	@sh scripts/lint.sh

fmt:
	gofmt -w .

# Прогон eval-набора: без ключа — на mock, с LLM_API_KEY — на реальной модели.
evals:
	$(GO) run ./cmd/evals -cases ../evals/cases.json -report ../evals/report.md

# Локальный запуск без Docker и без Бэкенда 1: имитация API + MCP + агент в mock-режиме.
run-mock: build
	@sh scripts/run-mock.sh
