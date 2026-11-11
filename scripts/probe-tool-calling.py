#!/usr/bin/env python3
"""Phase 4 gate: direct tool-calling probe against Ollama (no Mastra involved).

Sends a Chat Completions request with one trivial tool (get_weather) and a
prompt that demands its use, then inspects message.tool_calls in the response.

Usage: python3 scripts/probe-tool-calling.py [model]
Default model: Swift-Qwen3.8-27B-Q4_K_S:latest
Exit 0 = well-formed tool_calls payload; exit 1 = gate failed.
"""

import json
import sys
import time
import urllib.request

BASE_URL = "http://localhost:11434/v1"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "Swift-Qwen3.8-27B-Q4_K_S:latest"

PAYLOAD = {
    "model": MODEL,
    "messages": [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant with access to tools. "
                "When asked about the weather, you MUST call the get_weather tool. "
                "Never answer a weather question without calling the tool."
            ),
        },
        {
            "role": "user",
            "content": "What is the weather in Amsterdam right now?",
        },
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather for a location.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "City name, e.g. 'Amsterdam'.",
                        },
                        "unit": {
                            "type": "string",
                            "enum": ["celsius", "fahrenheit"],
                            "description": "Temperature unit.",
                        },
                    },
                    "required": ["location"],
                },
            },
        }
    ],
    "tool_choice": "auto",
    "temperature": 0,
}


def main() -> int:
    body = json.dumps(PAYLOAD).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            raw = resp.read().decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        print(f"GATE FAILED: request error: {exc}")
        return 1

    elapsed = time.time() - started
    data = json.loads(raw)
    msg = data["choices"][0]["message"]
    tool_calls = msg.get("tool_calls") or []

    print(f"model:            {MODEL}")
    print(f"elapsed:          {elapsed:.1f}s")
    print(f"finish_reason:    {data['choices'][0].get('finish_reason')}")
    print(f"content:          {msg.get('content')!r}")
    print(f"tool_calls count: {len(tool_calls)}")

    if not tool_calls:
        print("GATE FAILED: no tool_calls in response")
        return 1

    ok = True
    for i, tc in enumerate(tool_calls):
        fn = tc.get("function", {})
        name = fn.get("name")
        args_raw = fn.get("arguments", "")
        try:
            args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
        except json.JSONDecodeError as exc:
            print(f"  [{i}] {name}: INVALID JSON arguments ({exc}): {args_raw!r}")
            ok = False
            continue
        print(f"  [{i}] id={tc.get('id')!r} name={name!r} args={json.dumps(args)}")
        if name != "get_weather":
            print(f"  [{i}] unexpected tool name {name!r}")
            ok = False
        elif not isinstance(args, dict) or "location" not in args:
            print(f"  [{i}] missing required 'location' arg")
            ok = False

    print("GATE PASSED: well-formed tool_calls payload" if ok else "GATE FAILED: malformed tool_calls")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
