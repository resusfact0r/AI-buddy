FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /api ./cmd/api && CGO_ENABLED=0 go build -o /corp-mock ./cmd/corp-mock
FROM alpine:3.21
RUN adduser -D -u 10001 app
COPY --from=build /api /corp-mock /usr/local/bin/
USER app
CMD ["api"]
