"""Daily V-ARCHIVE DJ CLASS sync for all active links. Scheduled by host cron at
18:00 UTC (= 03:00 KST), per the master design §4.7. Port of src/worker/sync-djclass.ts.
"""

from django.core.management.base import BaseCommand

from djclass_overlay.djclass.sync import sync_user
from djclass_overlay.viewers.models import VarchiveToken


class Command(BaseCommand):
    help = "Sync DJ CLASS from V-ARCHIVE for every active link."

    def handle(self, *args, **options):
        links = VarchiveToken.objects.filter(is_active=True).select_related("user")
        success = failed = 0
        for link in links:
            try:
                result = sync_user(link)
            except Exception as exc:  # noqa: BLE001 — one bad link must not stop the batch
                failed += 1
                self.stderr.write(f"[sync_djclass] {link.varchive_nickname}: {exc}")
                continue
            if result["ok"]:
                success += 1
            else:
                failed += 1
                self.stderr.write(
                    f"[sync_djclass] {link.varchive_nickname}: "
                    f"no data (stale={result['stale']})"
                )
        self.stdout.write(f"[sync_djclass] synced={success} failed={failed}")
