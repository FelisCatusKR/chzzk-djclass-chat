from django.contrib.auth.backends import BaseBackend

from .models import User


class ChzzkBackend(BaseBackend):
    """Authenticate a user by Chzzk channel id (identity already proven by OAuth)."""

    def authenticate(self, request, chzzk_id=None, **kwargs):
        if not chzzk_id:
            return None
        try:
            return User.objects.get(chzzk_id=chzzk_id, is_active=True)
        except User.DoesNotExist:
            return None

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
