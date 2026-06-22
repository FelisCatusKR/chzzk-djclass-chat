"""Allow DB access in worker threads (sync_to_async) for flush_once tests.

The two non-django_db flush_once tests call flush_once() which dispatches
build_batch via sync_to_async to a worker thread. build_batch calls the resolver,
which may hit the DB for unlinked/unknown senders. Unblocking here allows the
worker thread access; no data is written, so isolation is not a concern.
"""

import pytest


@pytest.fixture(autouse=True)
def _unblock_db_for_threads(django_db_blocker):
    with django_db_blocker.unblock():
        yield
