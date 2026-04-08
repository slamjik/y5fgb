#!/bin/sh
set -eu

mkdir -p /app/data/attachments /app/data/media
chown app:app /app/data /app/data/attachments /app/data/media
touch /app/data/.permission-init
chown app:app /app/data/.permission-init

exec su-exec app /app/relay-server
