from django.conf import settings
from django.db import models


class Channel(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    chzzk_channel_id = models.CharField(max_length=64, unique=True)
    chzzk_access_token_encrypted = models.TextField(null=True, blank=True)
    chzzk_refresh_token_encrypted = models.TextField(null=True, blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "channels"

    def __str__(self):
        return self.chzzk_channel_id
