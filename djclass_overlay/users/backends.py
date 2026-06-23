from typing import Any

from django.contrib.auth.backends import BaseBackend
from django.http import HttpRequest

from .models import User


class ChzzkBackend(BaseBackend):
    """Authenticate a user by Chzzk channel id (identity already proven by OAuth)."""

    def authenticate(
        self,
        request: HttpRequest | None,
        chzzk_id: str | None = None,
        **kwargs: Any,
    ) -> User | None:
        if not chzzk_id:
            return None
        try:
            return User.objects.get(chzzk_id=chzzk_id, is_active=True)
        except User.DoesNotExist:
            return None

    def get_user(self, user_id: int) -> User | None:
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
