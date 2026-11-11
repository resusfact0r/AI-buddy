# Один образ для двух сервисов: agent (:8081) и mcp (:8082).
# Сборка из корня репозитория:  docker build -t ai-buddy-agent ./agent
ARG GO_VERSION=1.26

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/agent ./cmd/mcp ./cmd/fakeapi

FROM alpine:3.20
RUN adduser -D -u 10001 app
COPY --from=build /out/agent /out/mcp /out/fakeapi /usr/local/bin/
USER app
EXPOSE 8081 8082
# По умолчанию — агент; для MCP-сервера в compose задаётся command: ["mcp"].
CMD ["agent"]
