"""
Diagnostic script — run inside backend container:
  docker compose exec backend .venv/bin/python /tmp/diag_mcp.py

Outputs:
  1. Available MCP tools (tools/list)
  2. Full raw JSON of the FIRST candidate from offset=0
"""
import asyncio
import json
import sys
import httpx

# Inline settings to avoid importing app.config
MCP_URL = "http://172.31.174.11:8765/mcp"

# Try to load token from env / .env file
import os

TOKEN = os.environ.get("CLEVERSTAFF_MCP_TOKEN", "")
if not TOKEN:
    for path in (".env", "../.env"):
        try:
            for line in open(path):
                if line.startswith("CLEVERSTAFF_MCP_TOKEN="):
                    TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        except FileNotFoundError:
            pass

TIMEOUT = 30


async def _handshake(client, headers):
    r = await client.post(MCP_URL, headers=headers, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "diag", "version": "1.0"}},
    })
    r.raise_for_status()
    session_id = r.headers.get("Mcp-Session-Id")
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    await client.post(MCP_URL, headers=headers, json={
        "jsonrpc": "2.0", "method": "notifications/initialized",
    })
    return headers


async def list_tools(client, headers):
    r = await client.post(MCP_URL, headers={**headers, "Accept": "application/json"}, json={
        "jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {},
    })
    r.raise_for_status()
    data = r.json()
    tools = data.get("result", {}).get("tools", [])
    return tools


async def fetch_sample(client, headers):
    r = await client.post(MCP_URL, headers={**headers, "Accept": "application/json"}, json={
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": {"name": "search_candidates", "arguments": {"limit": 3, "offset": 0}},
    })
    r.raise_for_status()
    raw_text = r.json()["result"]["content"][0]["text"]
    return json.loads(raw_text)


async def main():
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        headers = await _handshake(client, headers)

        # 1. Tools list
        print("=" * 60)
        print("MCP TOOLS AVAILABLE:")
        print("=" * 60)
        tools = await list_tools(client, headers)
        for t in tools:
            name = t.get("name", "?")
            desc = t.get("description", "")[:80]
            schema = t.get("inputSchema", {})
            props = list(schema.get("properties", {}).keys())
            print(f"\n  {name}")
            print(f"    desc: {desc}")
            print(f"    params: {props}")

        # 2. Sample candidate dump
        print("\n" + "=" * 60)
        print("SAMPLE CANDIDATE (offset=0, limit=3):")
        print("=" * 60)
        result = await fetch_sample(client, headers)
        total = result.get("total")
        candidates = result.get("candidates", [])
        print(f"\nTotal: {total}, Got: {len(candidates)}")

        if candidates:
            c = candidates[0]
            print(f"\nFirst candidate keys: {list(c.keys())}")
            print("\nFull first candidate JSON:")
            # Truncate base64 fields to avoid huge output
            safe = {}
            for k, v in c.items():
                if isinstance(v, list) and k == "documents":
                    safe_docs = []
                    for d in v:
                        safe_d = {dk: (dv[:80] + "…" if isinstance(dv, str) and len(dv) > 80 else dv)
                                  for dk, dv in d.items()}
                        safe_docs.append(safe_d)
                    safe[k] = safe_docs
                elif isinstance(v, str) and len(v) > 200:
                    safe[k] = v[:200] + "…"
                else:
                    safe[k] = v
            print(json.dumps(safe, ensure_ascii=False, indent=2))
        else:
            print("No candidates returned!")


asyncio.run(main())
