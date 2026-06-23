# Chzzk Realtime Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the two riskiest assumptions of the Django migration before any real work — that Python `python-socketio` 4.x (on Python 3.13) connects to Chzzk's Socket.IO chat session and receives live `CHAT` events (R1), and that re-streaming them via SSE works locally and survives the Cloudflare Tunnel (R2).

**Architecture:** Throwaway proof-of-concept in a scratch directory (NOT in the repo). A small asyncio program connects to Chzzk via `python-socketio` AsyncClient, subscribes to chat, and (in the SSE variant) pushes messages into an `asyncio.Queue` that a Starlette SSE endpoint drains — exactly the single-process shape the real app will use.

**Tech Stack:** Python 3.13, `python-socketio[asyncio_client]==4.6.1` (Engine.IO 3 / Socket.IO v2 protocol), `httpx`, `starlette`, `uvicorn`, `cloudflared`.

---

> **Note — this is a spike, not TDD.** Its purpose is to answer go/no-go questions about external systems, so steps are *verify-by-observation* (run + inspect output), not red-green tests. The real Django code in Plans 2–7 **is** TDD. This plan and its scratch code are throwaway; only the recorded findings (Task 5) carry forward.
>
> Maps to spec `docs/superpowers/specs/2026-06-22-django-migration-design.md` §9 Step 0, and de-risks R1 & R2 in §10.

## Prerequisites (your environment)

- **Python 3.13** available as `python3.13`.
- **`cloudflared`** installed (you already run a tunnel in prod).
- **A valid Chzzk access token** (Bearer) for a channel you control. Obtain via the existing app's OAuth, or decrypt `chzzk_access_token_encrypted` from the prod DB with the existing crypto. Tokens expire in ~24h — use a fresh one. Export as `CHZZK_ACCESS_TOKEN`.
- **A live channel with chat activity** during the run (start a stream, or use a test stream, and type in its chat) — `CHAT` events only arrive for a live, chatted channel.

---

### Task 1: Python 3.13 env + dependency install (validates R1-A: does 4.x even run on 3.13?)

**Files:**
- Create: `~/chzzk-spike/` (scratch dir, outside the repo)

- [ ] **Step 1: Create scratch dir and venv**

```bash
mkdir -p ~/chzzk-spike && cd ~/chzzk-spike
python3.13 -m venv .venv && source .venv/bin/activate
python --version   # expect: Python 3.13.x
```

- [ ] **Step 2: Install the old-protocol Socket.IO client + SSE deps**

```bash
pip install "python-socketio[asyncio_client]==4.6.1" httpx starlette uvicorn
```

Expected: installs `python-socketio` 4.6.1, `python-engineio` 3.x, `aiohttp`, `httpx`, `starlette`, `uvicorn` with **no build/wheel error** on 3.13.

- [ ] **Step 3: Verify imports + protocol versions**

```bash
python -c "import socketio, engineio, aiohttp; print(socketio.__version__, engineio.__version__, aiohttp.__version__)"
```

Expected: prints `4.6.1 3.x.x <aiohttp>` with no import error.
**If install or import FAILS on 3.13** → that is the R1 signal. Re-run Task 1 with `python3.12`; if it works there, the fallback is Python 3.12 (Django 6.0 supports it). Record in Task 5.

---

### Task 2: Connect to Chzzk and receive live CHAT (validates R1-B: does the protocol actually work?)

**Files:**
- Create: `~/chzzk-spike/chzzk.py` (shared helpers)
- Create: `~/chzzk-spike/connect.py`

- [ ] **Step 1: Write the shared Chzzk helpers**

`~/chzzk-spike/chzzk.py`:

```python
import json, os
import httpx

TOKEN = os.environ["CHZZK_ACCESS_TOKEN"]
API = "https://openapi.chzzk.naver.com/open/v1"


async def get_session_url() -> str:
    async with httpx.AsyncClient(timeout=8) as c:
        r = await c.get(f"{API}/sessions/auth",
                        headers={"Authorization": f"Bearer {TOKEN}"})
        r.raise_for_status()
        d = r.json()
        url = (d.get("content") or d)["url"]
    if "?auth=" not in url:
        url += ("&" if "?" in url else "?") + f"auth={TOKEN}"
    return url


async def subscribe_chat(session_key: str) -> None:
    async with httpx.AsyncClient(timeout=8) as c:
        r = await c.post(f"{API}/sessions/events/subscribe/chat",
                         params={"sessionKey": session_key},
                         headers={"Authorization": f"Bearer {TOKEN}"})
        r.raise_for_status()


def parse(data):
    if isinstance(data, str):
        try:
            return json.loads(data)
        except Exception:
            return {}
    return data if isinstance(data, dict) else {}
```

- [ ] **Step 2: Write the connect script**

`~/chzzk-spike/connect.py`:

```python
import asyncio
import socketio
import chzzk

sio = socketio.AsyncClient(reconnection=False)


@sio.on("connect")
async def on_connect():
    print("[socket] connected sid=", sio.sid)


@sio.on("SYSTEM")
async def on_system(data):
    p = chzzk.parse(data)
    print("[SYSTEM]", p.get("type"))
    if p.get("type") == "connected":
        key = (p.get("data") or {}).get("sessionKey")
        if key:
            await chzzk.subscribe_chat(key)
            print("[subscribe] sent")


@sio.on("CHAT")
async def on_chat(data):
    p = chzzk.parse(data)
    prof = p.get("profile") or {}
    print("[CHAT]", prof.get("nickname") or p.get("nickname"), ":", p.get("content"))


@sio.on("disconnect")
async def on_disconnect():
    print("[socket] disconnected")


async def main():
    url = await chzzk.get_session_url()
    print("[session]", url[:55], "...")
    await sio.connect(url, transports=["websocket"])
    await sio.wait()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: Run against a live, chatted channel**

```bash
export CHZZK_ACCESS_TOKEN="<your fresh token>"
python connect.py
```

Expected (type in the live channel's chat to generate events):

```
[socket] connected sid= ...
[SYSTEM] connected
[subscribe] sent
[SYSTEM] subscribed
[CHAT] <nickname> : <message text>
```

**If `connect` never fires or errors** → check `socketio_path` (Chzzk may not use the default `/socket.io`); pass `socketio_path=...` to `sio.connect`. **If connect works but no CHAT** → confirm the channel is live + you typed in its chat, and that `[subscribe] sent` printed. Record outcome + any quirks in Task 5.

---

### Task 3: Re-stream via SSE locally (validates the single-process socketio-client + SSE shape)

**Files:**
- Create: `~/chzzk-spike/sse_app.py`

- [ ] **Step 1: Write the SSE app (socketio client + SSE endpoint in one uvicorn process)**

`~/chzzk-spike/sse_app.py`:

```python
import asyncio, json
import socketio
from starlette.applications import Starlette
from starlette.responses import HTMLResponse, StreamingResponse
from starlette.routing import Route
import chzzk

queue: asyncio.Queue = asyncio.Queue()
sio = socketio.AsyncClient(reconnection=False)


@sio.on("SYSTEM")
async def on_system(data):
    p = chzzk.parse(data)
    if p.get("type") == "connected":
        key = (p.get("data") or {}).get("sessionKey")
        if key:
            await chzzk.subscribe_chat(key)


@sio.on("CHAT")
async def on_chat(data):
    p = chzzk.parse(data)
    prof = p.get("profile") or {}
    await queue.put({"nickname": prof.get("nickname"), "content": p.get("content")})


async def sse(request):
    async def gen():
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=15)
                yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"  # heartbeat to survive proxy idle timeout
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def index(request):
    return HTMLResponse(
        '<!doctype html><meta charset="utf-8"><pre id="o"></pre>'
        '<script>new EventSource("/sse").onmessage=e=>{'
        'document.getElementById("o").textContent+=e.data+"\\n"}</script>'
    )


async def startup():
    url = await chzzk.get_session_url()
    await sio.connect(url, transports=["websocket"])


app = Starlette(routes=[Route("/", index), Route("/sse", sse)], on_startup=[startup])
```

- [ ] **Step 2: Run and view in a browser**

```bash
uvicorn sse_app:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`. Expected: chat lines appear live in the browser as they are typed in the channel; the connection stays open (a `: keepalive` is emitted every 15s of silence).

---

### Task 4: SSE through the Cloudflare Tunnel (validates R2)

- [ ] **Step 1: Expose the local SSE app via a quick tunnel** (keep `sse_app` running from Task 3)

```bash
cloudflared tunnel --url http://localhost:8000
```

- [ ] **Step 2: Open the printed `https://<random>.trycloudflare.com` URL in a browser**

Expected: chat streams through the tunnel just like local. Leave it open for 1–2 minutes of chat silence to confirm the `: keepalive` heartbeat keeps Cloudflare from closing the idle stream.
**If the stream stalls/closes through the tunnel** → confirm `text/event-stream` + `X-Accel-Buffering: no` are present and that the heartbeat interval is short enough; record the working configuration in Task 5.

---

### Task 5: Record findings + go/no-go decision

**Files:**
- Modify: this plan file (fill the Results block below), then carry the decision into the spec's R1/R3 (§10, §11.3).

- [ ] **Step 1: Fill in the results**

```
## Results (fill in)
- [ ] R1-A: python-socketio 4.6.1 installs + imports on Python 3.13?   yes / no →
- [ ] R1-B: connect → SYSTEM connected → subscribe → CHAT received?    yes / no →
- [ ] Quirks (socketio_path, payload str-vs-dict, auth param):
- [ ] SSE renders live in a local browser?                            yes / no
- [ ] R2: SSE survives the Cloudflare Tunnel with keepalive?          yes / no →
- [ ] DECISION: proceed on Python 3.13  /  fall back to 3.12  /  blocked (detail):
```

- [ ] **Step 2: Propagate the decision**

If the decision is "fall back to 3.12," update spec §11.3 (Python version) and §10 R1. If "proceed on 3.13," mark R1/R2 retired. Either way, Plan 2 (Scaffold + Models + Migration) is then unblocked.

- [ ] **Step 3: Tear down the scratch dir** (throwaway): `rm -rf ~/chzzk-spike` and `rm get-token.ts`. The findings live in this plan; no spike code is kept.

---

## Spike Result — 2026-06-22 (PASSED ✅)

- **R1-A** ✅ `python-socketio 4.6.1` / `python-engineio 3.14.2` (EIO3) / `aiohttp 3.14.1` install + import on **Python 3.13.5 (aarch64)** from prebuilt wheels — no compile, no 3.12 fallback.
- **R1-B** ✅ Connected to Chzzk + received live `CHAT` end-to-end (chat streamed all the way to the SSE browser).
- **SSE local** ✅ (after the fix below). **R2** ✅ verified through the **real Cloudflare Tunnel** `dev-chatoverlay.felis.kr → :3000` (stronger than a quick tunnel), with keepalive + `X-Accel-Buffering: no`.
- **Quirk:** Starlette 1.3.1 removed `on_startup`/`on_shutdown` → use a `lifespan` async context manager. Spike-only — the real app uses Django `StreamingHttpResponse`, not Starlette.
- **Carry forward:** pin `python-socketio ~=4.6`, `python-engineio ~=3.14`; the spike's `chzzk.py` flow (session-auth → `?auth=` → ws connect → SYSTEM `connected` → subscribe → CHAT) is the validated reference for the real ingestor.
- **DECISION: PROCEED on Python 3.13.** R1 & R2 retired (spec §10).
