import hmac
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import login
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import HttpRequest
from django.http import HttpResponse
from django.shortcuts import redirect
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_POST

from djclass_overlay.common import chzzk
from djclass_overlay.common import crypto
from djclass_overlay.common import ratelimit
from djclass_overlay.common.safe_redirect import safe_next_path
from djclass_overlay.streamers.models import Channel

from .models import User

logger = logging.getLogger(__name__)

_BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def chzzk_login(request: HttpRequest) -> HttpResponse:
    state = secrets.token_hex(32)  # 64 hex chars, like Node randomBytes(32).hex()
    request.session["oauth_state"] = state
    request.session["oauth_next"] = request.GET.get("next") or ""
    return redirect(chzzk.get_oauth_url(state))


def chzzk_callback(request: HttpRequest) -> HttpResponse:
    if not ratelimit.allow(request, scope="auth", limit=10, window=60):
        return HttpResponse(
            "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", status=429
        )
    code: str | None = request.GET.get("code")
    state: str | None = request.GET.get("state")
    stored: str | None = request.session.get("oauth_state")
    if not code or not state or not stored or not hmac.compare_digest(state, stored):
        logger.warning("[OAuth] state mismatch or missing parameters")
        return redirect("/?error=auth_failed")

    try:
        tokens = chzzk.exchange_code_for_token(code, state)
        info = chzzk.get_user_info(tokens["access_token"])
        expires_at = timezone.now() + timedelta(seconds=tokens["expires_in"])

        with transaction.atomic():
            user, created = User.objects.update_or_create(
                chzzk_id=info["user_id"],
                defaults={"chzzk_nickname": info["nickname"]},
            )
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])
            Channel.objects.update_or_create(
                user=user,
                defaults={
                    "chzzk_channel_id": info["user_id"],
                    "chzzk_access_token_encrypted": crypto.encrypt(
                        tokens["access_token"]
                    ),
                    "chzzk_refresh_token_encrypted": crypto.encrypt(
                        tokens["refresh_token"]
                    ),
                    "token_expires_at": expires_at,
                },
            )
        # NOTE: unlike the Node callback, login deliberately does NOT auto-sync DJ
        # CLASS — token-less sync makes up to 4 sequential V-ARCHIVE calls (per
        # button), too slow for the login hot path. Freshness is covered by the
        # daily sync_djclass cron, the first sync at link time (link_connect), and
        # the manual "동기화" button on /link. Migrated users keep their classes.

        next_path = safe_next_path(request.session.pop("oauth_next", None))
        request.session.pop("oauth_state", None)
        login(request, user, backend=_BACKEND)
        return redirect(next_path)
    except Exception:
        logger.exception("[OAuth] callback failed")
        return redirect("/?error=auth_failed")


def login_page(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("/dashboard/")
    next_param: str | None = request.GET.get("next")
    next_path = safe_next_path(next_param or "")
    context = {
        "/dashboard/": "위젯 설정을 위해",
        "/link/": "DJ CLASS 연동을 위해",
    }.get(next_param or "")
    return render(request, "users/login.html", {"next": next_path, "context": context})


@require_POST
def logout_view(request: HttpRequest) -> HttpResponse:
    logout(request)
    return redirect("/")


@login_required
def dashboard(request: HttpRequest) -> HttpResponse:
    channel: Channel | None = getattr(request.user, "channel", None)
    widget_base_url = ""
    if channel:
        widget_base_url = f"{settings.BASE_URL}/widget/{channel.chzzk_channel_id}/"
    return render(request, "users/dashboard.html", {"widget_base_url": widget_base_url})
