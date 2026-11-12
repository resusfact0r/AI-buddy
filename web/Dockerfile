# syntax=docker/dockerfile:1
# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-env.sh
COPY --from=build /app/dist /usr/share/nginx/html
# Адреса API подставляются при старте контейнера в /env.js (см. 40-runtime-env.sh)
ENV API_URL=http://localhost:8080/api/v1 \
    AGENT_URL=http://localhost:8081/api/v1 \
    USE_MOCKS=false
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
