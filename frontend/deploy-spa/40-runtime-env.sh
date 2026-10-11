#!/bin/sh
set -eu

valid_label() {
  [ -n "$1" ] || return 1
  case "$1" in
    -*|*-|*[!a-z0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

if [ -z "${API_URL:-}" ]; then
  : "${APP_NAME:?APP_NAME must be provided by the infra platform}"
  : "${APP_ENV:?APP_ENV must be provided by the infra platform}"
  : "${INFRA_DOMAIN:?INFRA_DOMAIN must be provided by the infra platform}"
  valid_label "$APP_NAME" || { echo "Invalid APP_NAME for API URL derivation" >&2; exit 1; }
  valid_label "$APP_ENV" || { echo "Invalid APP_ENV for API URL derivation" >&2; exit 1; }
  case "$INFRA_DOMAIN" in
    ''|.*|*.|*..*|*[!a-z0-9.-]*)
      echo "Invalid INFRA_DOMAIN for API URL derivation" >&2
      exit 1
      ;;
  esac
  api_host="api-${APP_NAME}"
  if [ "$APP_ENV" != prod ]; then
    api_host="${api_host}-${APP_ENV}"
  fi
  API_URL="https://${api_host}.${INFRA_DOMAIN}/api"
fi

case "$API_URL" in
  https://*|http://*) ;;
  *)
    echo "API_URL must be an absolute HTTP(S) URL" >&2
    exit 1
    ;;
esac

escaped_api_url=$(printf '%s' "$API_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.__ENV__ = {"API_URL":"%s"};\n' "$escaped_api_url" \
  > /usr/share/nginx/html/env.js
