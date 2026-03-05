#!/bin/bash
set -euo pipefail

BASE_TITLE="Noctua Mail"
ENV_LABEL="${APP_ENV_LABEL:-}"

if [[ -n "$ENV_LABEL" ]]; then
  APP_TITLE="$BASE_TITLE ($ENV_LABEL)"
else
  APP_TITLE="$BASE_TITLE"
fi

js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

ESCAPED_TITLE="$(js_escape "$APP_TITLE")"
ESCAPED_ENV_LABEL="$(js_escape "$ENV_LABEL")"

cat > /app/public/runtime-config.js <<EOF
(function () {
  var config = {
    appTitle: "${ESCAPED_TITLE}",
    appEnvironmentLabel: "${ESCAPED_ENV_LABEL}"
  };
  window.__NOCTUA_RUNTIME_CONFIG__ = config;
  if (config.appTitle) {
    document.title = config.appTitle;
  }
})();
EOF

exec bun --bun server.js
