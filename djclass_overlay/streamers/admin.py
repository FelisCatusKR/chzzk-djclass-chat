from django.contrib import admin

from .models import Channel


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ("chzzk_channel_id", "user", "token_expires_at", "created_at")
    search_fields = ("chzzk_channel_id",)
