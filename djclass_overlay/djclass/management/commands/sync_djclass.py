"""Daily V-ARCHIVE DJ CLASS sync for all active links. Scheduled by host cron at
18:00 UTC (= 03:00 KST), per the master design §4.7. Port of src/worker/sync-djclass.ts.
"""

from typing import Any

from django.core.management.base import BaseCommand

from djclass_overlay.djclass.sync import sync_all_active_links


class Command(BaseCommand):
    help = "Sync DJ CLASS from V-ARCHIVE for every active link."

    def handle(self, *args: Any, **options: Any) -> None:
        success, failed = sync_all_active_links()
        self.stdout.write(f"[sync_djclass] synced={success} failed={failed}")
