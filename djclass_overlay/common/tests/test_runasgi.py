"""runasgi must exit cleanly on Ctrl+C — no KeyboardInterrupt traceback.

The graceful shutdown runs inside _watch_exit (it reacts to uvicorn's should_exit),
but asyncio.run() re-raises the Ctrl+C KeyboardInterrupt after the loop finishes;
handle() has to swallow that so the process exits 0 without dumping a traceback.
"""

from djclass_overlay.common.management.commands import runasgi


def test_runasgi_swallows_keyboard_interrupt_on_shutdown(monkeypatch):
    def _fake_run(coro):
        coro.close()  # the real _serve() coroutine is never awaited under the mock
        raise KeyboardInterrupt  # what asyncio.run() does after a Ctrl+C shutdown

    monkeypatch.setattr(runasgi.asyncio, "run", _fake_run)
    # Must return without propagating KeyboardInterrupt.
    runasgi.Command().handle(host="127.0.0.1", port=8000, log_level="info")
