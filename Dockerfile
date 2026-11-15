FROM golang:1.26-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /out/ ./cmd/api ./cmd/corp-mock

FROM golang:1.26-alpine AS agent
WORKDIR /src
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN CGO_ENABLED=0 go build -o /out/ ./cmd/agent ./cmd/mcp

FROM node:22-alpine AS web
WORKDIR /app
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM migrate/migrate:v4.18.1 AS migrations
FROM nginx:1.27-alpine
COPY --from=api /out/ /usr/local/bin/
COPY --from=agent /out/ /usr/local/bin/
COPY --from=migrations /usr/local/bin/migrate /usr/local/bin/migrate
COPY backend/migrations/ /migrations/
COPY --from=web /app/dist/ /usr/share/nginx/html/
COPY web/docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i -e '/resolver 127.0.0.11/d' -e 's@http://api:8080@http://127.0.0.1:8080@g' -e 's@http://agent:8081@http://127.0.0.1:8081@g' /etc/nginx/conf.d/default.conf
COPY web/docker/40-runtime-env.sh /runtime-env.sh
COPY deploy/railway/start.sh /start.sh
ENV API_URL=/api/v1 AGENT_URL=/api/v1 USE_MOCKS=false LLM_PROVIDER=mock CORP_MOCK_URL=http://127.0.0.1:8090 CORP_MOCK_FAIL_RATE=0 TZ=Europe/Moscow
EXPOSE 3000
ENTRYPOINT ["sh","/start.sh"]
