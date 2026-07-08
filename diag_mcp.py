"""
Diagnostic script — run inside backend container:
  docker compose exec backend .venv/bin/python /tmp/diag_mcp.py

Outputs:
  1. Full search_candidates input schema (all available parameters)
  2. Test with limit=1  — do documents appear?
  3. Test with limit=5  — do documents appear?
  4. Test without limit/offset — server default
"""
import asyncio
import json
import os
import httpx

MCP_URL = "http://172.31.174.11:8765/mcp"
PROTOCOL = "2025-11-25"
TIMEOUT = 120

TOKEN = os.environ.get("CLEVERSTAFF_MCP_TOKEN", "")
if not TOKEN:
    for path in (".env", "../.env", "/app/.env"):
        try:
            for line in open(path):
                if line.startswith("CLEVERSTAFF_MCP_TOKEN="):
                    TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        except FileNotFoundError:
            pass


async def _handshake(client, headers):
    r = await client.post(MCP_URL, headers=headers, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": PROTOCOL, "capabilities": {},
                   "clientInfo": {"name": "diag", "version": "1.0"}},
    })
    r.raise_for_status()
    session_id = r.headers.get("Mcp-Session-Id")
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    headers["mcp-protocol-version"] = PROTOCOL
    await client.post(MCP_URL, headers=headers, json={
        "jsonrpc": "2.0", "method": "notifications/initialized",
    })
    return headers


async def list_tools(client, headers):
    r = await client.post(MCP_URL, headers=headers, json={
        "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
    })
    r.raise_for_status()
    return r.json().get("result", {}).get("tools", [])


async def search(client, headers, arguments: dict, label: str):
    print(f"\n{'='*60}")
    print(f"TEST: {label}")
    print(f"arguments: {json.dumps(arguments, ensure_ascii=False)}")
    print("="*60)
    r = await client.post(MCP_URL, headers=headers, json={
        "jsonrpc": "2.0", "id": 10, "method": "tools/call",
        "params": {"name": "search_candidates", "arguments": arguments},
    })
    print(f"HTTP status: {r.status_code}  content-type: {r.headers.get('content-type','')}")
    r.raise_for_status()
    raw_text = r.json()["result"]["content"][0]["text"]
    result = json.loads(raw_text)
    candidates = result.get("candidates", [])
    print(f"total={result.get('total')}  count={result.get('count')}  returned={len(candidates)}")
    for i, c in enumerate(candidates):
        docs = c.get("documents") or []
        note = c.get("documents_note", "")
        has_b64 = any(d.get("data_base64") for d in docs)
        has_url = any(d.get("open_url") for d in docs)
        print(f"  [{i}] id={c.get('candidate_id')} name={c.get('full_name')!r}")
        print(f"       docs={len(docs)}  has_open_url={has_url}  has_data_base64={has_b64}")
        if note:
            print(f"       documents_note: {note}")
        for d in docs:
            print(f"       doc: filename={d.get('filename')}  open_url={d.get('open_url')}  "
                  f"zipped={d.get('zipped')}  b64_len={len(d.get('data_base64',''))}")


async def main():
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json, text/event-stream",
        "Accept-Encoding": "gzip, deflate",
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        headers = await _handshake(client, headers)

        # 1. Full schema
        print("="*60)
        print("search_candidates FULL INPUT SCHEMA:")
        print("="*60)
        tools = await list_tools(client, headers)
        for t in tools:
            if t.get("name") == "search_candidates":
                schema = t.get("inputSchema", {})
                print(json.dumps(schema, indent=2, ensure_ascii=False))
                break

        # 2. Tests with different limits
        await search(client, headers, {}, "NO limit/offset (server default)")
        await search(client, headers, {"limit": 1, "offset": 0}, "limit=1")
        await search(client, headers, {"limit": 5, "offset": 0}, "limit=5")
        await search(client, headers, {"limit": 10, "offset": 0}, "limit=10")


asyncio.run(main())
