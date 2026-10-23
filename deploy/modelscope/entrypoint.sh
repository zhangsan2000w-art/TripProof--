#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ]; then
  tripproof_storage_dir=$(dirname "${DATABASE_PATH:?DATABASE_PATH must be set}")
  mkdir -p "$tripproof_storage_dir"
  chown tripproof:tripproof "$tripproof_storage_dir"
  exec gosu tripproof "$@"
fi
exec "$@"
