import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from djclass_overlay.common import crypto
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


def _enc(value):
    return crypto.encrypt(value) if value else None


class Command(BaseCommand):
    help = "Import legacy data from the Node export JSON (re-encrypts tokens)."

    def add_arguments(self, parser):
        parser.add_argument("json_path")

    @transaction.atomic
    def handle(self, *args, **opts):
        with Path(opts["json_path"]).open(encoding="utf-8") as f:
            data = json.load(f)

        for row in data:
            user, created = User.objects.update_or_create(
                chzzk_id=row["chzzk_id"],
                defaults={
                    "chzzk_nickname": row["chzzk_nickname"],
                    "preferred_button": row.get("preferred_button"),
                },
            )
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])

            ch = row.get("channel")
            if ch:
                Channel.objects.update_or_create(
                    user=user,
                    defaults={
                        "chzzk_channel_id": ch["chzzk_channel_id"],
                        "chzzk_access_token_encrypted": _enc(ch.get("access_token")),
                        "chzzk_refresh_token_encrypted": _enc(ch.get("refresh_token")),
                        "token_expires_at": ch.get("token_expires_at"),
                    },
                )

            vt = row.get("varchive_token")
            if vt:
                VarchiveToken.objects.update_or_create(
                    user=user,
                    defaults={
                        # Token-less (Plan 7): the legacy V-ARCHIVE token is dropped,
                        # not re-encrypted — sync uses the public nickname endpoint.
                        # (userNo isn't in the legacy export, so it stays null.)
                        "varchive_nickname": vt["varchive_nickname"],
                        "is_active": vt["is_active"],
                    },
                )

            for d in row.get("dj_classes", []):
                DjClass.objects.update_or_create(
                    user=user,
                    button=d["button"],
                    defaults={
                        "dj_class": d["dj_class"],
                        "dj_power_sum": d.get("dj_power_sum"),
                        "max_dj_power": d.get("max_dj_power"),
                        "dj_power_conversion": d.get("dj_power_conversion"),
                    },
                )

        self.stdout.write(self.style.SUCCESS(f"Imported {len(data)} users"))
