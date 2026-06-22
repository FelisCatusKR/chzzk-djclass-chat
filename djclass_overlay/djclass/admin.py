from django.contrib import admin

from .models import DjClass


@admin.register(DjClass)
class DjClassAdmin(admin.ModelAdmin):
    list_display = ("user", "button", "dj_class", "synced_at")
    list_filter = ("button",)
