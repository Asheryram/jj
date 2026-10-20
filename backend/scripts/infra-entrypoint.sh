#!/bin/sh
set -eu

valid_label() {
  [ -n "$1" ] || return 1
  case "$1" in
    -*|*-|*[!a-z0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

if { [ -z "${PUBLIC_APP_URL:-}" ] || [ -z "${CORS_ORIGINS:-}" ]; } &&
   [ -n "${APP_NAME:-}" ] && [ -n "${APP_ENV:-}" ] && [ -n "${INFRA_DOMAIN:-}" ]; then
  valid_label "$APP_NAME" || { echo "Invalid APP_NAME for public URL derivation" >&2; exit 1; }
  valid_label "$APP_ENV" || { echo "Invalid APP_ENV for public URL derivation" >&2; exit 1; }
  case "$INFRA_DOMAIN" in
    ''|.*|*.|*..*|*[!a-z0-9.-]*)
      echo "Invalid INFRA_DOMAIN for public URL derivation" >&2
      exit 1
      ;;
  esac

  app_host=$APP_NAME
  if [ "$APP_ENV" != prod ]; then
    app_host="${APP_NAME}-${APP_ENV}"
  fi
  app_url="https://${app_host}.${INFRA_DOMAIN}"
  export PUBLIC_APP_URL="${PUBLIC_APP_URL:-$app_url}"
  export CORS_ORIGINS="${CORS_ORIGINS:-$app_url}"
fi

# Prisma reads a direct (un-pooled) connection for migrations from DIRECT_URL. The platform's own Postgres has no pooler in
# front of it, so the direct URL is simply DATABASE_URL. An explicit DIRECT_URL (for example a managed database behind a
# pooler) still wins.
if [ -z "${DIRECT_URL:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  export DIRECT_URL="$DATABASE_URL"
fi

exec "$@"
