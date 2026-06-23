from django.conf import settings
from django.db import models


class VarchiveToken(models.Model):
    """A viewer's verified V-ARCHIVE link. Token-less: the 조회토큰 is used once at
    link time to capture (varchive_user_no, varchive_nickname) and is NOT stored;
    sync fetches DJ CLASS by the public nickname endpoint. (Table name kept for
    migration continuity.)"""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    varchive_nickname = models.CharField(max_length=255)
    # Immutable V-ARCHIVE identity (불변값). Null for rows migrated before Plan 7.
    varchive_user_no = models.BigIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "varchive_tokens"
