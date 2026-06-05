#!/bin/bash
set -e

HANA_HOME="${HANA_HOME:-/data}"
HANA_PORT="${HANA_PORT:-14500}"
HANA_HOST="${HANA_HOST:-0.0.0.0}"

# 确保数据目录存在
mkdir -p "$HANA_HOME"

# 初始化 server-network.json（Docker 中监听 0.0.0.0，LAN 模式）
NETWORK_CONFIG="$HANA_HOME/server-network.json"
if [ ! -f "$NETWORK_CONFIG" ]; then
    echo "[docker-entrypoint] Initializing server-network.json (host=$HANA_HOST, port=$HANA_PORT)"
    cat > "$NETWORK_CONFIG" <<EOF
{
  "schemaVersion": 1,
  "mode": "lan",
  "listenHost": "$HANA_HOST",
  "listenPort": $HANA_PORT,
  "customRemote": { "enabled": false, "baseUrl": null, "wsUrl": null },
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF
else
    echo "[docker-entrypoint] Using existing server-network.json"
fi

echo "[docker-entrypoint] Starting HanaAgent Server on $HANA_HOST:$HANA_PORT"
echo "[docker-entrypoint] Data directory: $HANA_HOME"

exec node server/index.js
