from django.contrib import admin

from .models import VarchiveToken


@admin.register(VarchiveToken)
class VarchiveTokenAdmin(admin.ModelAdmin):
    list_display = ("varchive_nickname", "varchive_user_no", "user", "is_active", "updated_at")
    search_fields = ("varchive_nickname",)
