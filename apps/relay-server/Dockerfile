FROM golang:1.26.2-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/relay-server ./cmd/relay-server

FROM alpine:3.22

RUN addgroup -S app && adduser -S -G app -h /app app \
    && apk upgrade --no-cache \
    && apk add --no-cache ca-certificates wget su-exec

WORKDIR /app
COPY --from=builder /out/relay-server /app/relay-server
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/data/attachments /app/data/media \
    && chown -R app:app /app

USER root
EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
