#!/usr/bin/env bash
# Probe the NIPP portal MCP server and dump its tool list as JSON.
set -u
BASE="http://localhost:4112/api/mcp/nipp-portal/mcp"
HDRS=$(mktemp)

# 1. initialize — capture session id from response headers
INIT_BODY=$(curl -s -D "$HDRS" -X POST "$BASE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}')
SID=$(grep -i '^Mcp-Session-Id:' "$HDRS" | awk '{print $2}' | tr -d '\r')
echo "SESSION_ID: $SID" >&2

# 2. initialized notification (no response)
curl -s -o /dev/null -X POST "$BASE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  ${SID:+-H "Mcp-Session-Id: $SID"} \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. tools/list
curl -s -X POST "$BASE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  ${SID:+-H "Mcp-Session-Id: $SID"} \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' > /tmp/mcp_tools_raw.txt

rm -f "$HDRS"
echo "--- raw head ---" >&2
head -c 400 /tmp/mcp_tools_raw.txt >&2
