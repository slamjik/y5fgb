FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/relay-server ./cmd/relay-server
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM alpine:3.20

RUN addgroup -S app && adduser -S -G app -h /app app \
    && apk add --no-cache ca-certificates wget

WORKDIR /app
COPY --from=builder /out/relay-server /app/relay-server
COPY --from=builder /out/migrate /app/migrate

RUN mkdir -p /app/data/attachments \
    && chown -R app:app /app

USER app
EXPOSE 8080
ENTRYPOINT ["/app/relay-server"]
