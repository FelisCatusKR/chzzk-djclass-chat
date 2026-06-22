from django.contrib import admin

from .models import User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("chzzk_id", "chzzk_nickname", "preferred_button", "created_at")
    search_fields = ("chzzk_id", "chzzk_nickname")
