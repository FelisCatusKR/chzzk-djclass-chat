"""Run the ASGI app under uvicorn with graceful realtime shutdown.

Plain ``uvicorn config.asgi:application`` hangs on Ctrl+C whenever a widget SSE
stream is open — the stream loops forever, so uvicorn waits on it ("Waiting for
connections to close") until a second Ctrl+C force-quits, which dumps a
CancelledError / "Event loop stopped before Future completed" traceback.

This command embeds uvicorn and watches its ``should_exit`` flag: the instant a
shutdown signal arrives it ends the open streams and cancels the realtime
background tasks (see overlay.lifecycle.shutdown), so the connections close on
their own and uvicorn exits cleanly without a force-quit.

    python manage.py runasgi                 # 127.0.0.1:8000
    python manage.py runasgi --host 0.0.0.0 --port 8000

Note: auto-reload is not supported here (use plain `uvicorn --reload` for that).
"""

import asyncio

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run the ASGI server (uvicorn) with graceful realtime shutdown."

    def add_arguments(self, parser):
        parser.add_argument("--host", default="127.0.0.1")
        parser.add_argument("--port", type=int, default=8000)
        parser.add_argument("--log-level", default="info")

    def handle(self, *args, **options):
        import uvicorn

        from djclass_overlay.overlay import lifecycle

        config = uvicorn.Config(
            "config.asgi:application",
            host=options["host"],
            port=options["port"],
            log_level=options["log_level"],
            lifespan="off",                 # Django's ASGI app doesn't speak lifespan
            timeout_graceful_shutdown=5,    # backstop; the watcher normally closes streams first
        )
        server = uvicorn.Server(config)

        async def _serve():
            async def _watch_exit():
                # uvicorn's own signal handler flips should_exit; react before it
                # starts force-cancelling the (otherwise endless) SSE streams.
                while not server.should_exit:
                    await asyncio.sleep(0.1)
                await lifecycle.shutdown()

            watcher = asyncio.create_task(_watch_exit())
            try:
                await server.serve()
            finally:
                watcher.cancel()

        try:
            asyncio.run(_serve())
        except KeyboardInterrupt:
            # The realtime shutdown already ran in _watch_exit (it reacts to uvicorn's
            # should_exit flag); asyncio.run() nonetheless re-raises the Ctrl+C
            # KeyboardInterrupt after the loop finishes, so swallow it here for a
            # clean, traceback-free exit.
            pass
