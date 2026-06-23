from datetime import UTC
from datetime import datetime

import pytest
from asgiref.sync import async_to_sync

from djclass_overlay.overlay import scheduler


@pytest.mark.parametrize(
    ("now_h", "now_m", "expect_h"),
    [(10, 0, 8), (17, 30, 0.5), (18, 0, 24), (19, 0, 23)],  # hours until next 18:00 UTC
)
def test_seconds_until_next_run(now_h: int, now_m: int, expect_h: float) -> None:
    now = datetime(2026, 6, 23, now_h, now_m, tzinfo=UTC)
    assert scheduler._seconds_until(18, now) == pytest.approx(expect_h * 3600)  # noqa: SLF001 — testing internal helper directly


def test_run_sync_invokes_sync_all(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, bool] = {}

    def fake_sync_all() -> tuple[int, int]:
        calls["ran"] = True
        return (3, 1)

    monkeypatch.setattr(scheduler, "sync_all_active_links", fake_sync_all)

    async def scenario() -> None:
        await scheduler._run_sync()  # noqa: SLF001 — testing internal helper directly

    async_to_sync(scenario)()
    assert calls["ran"] is True
