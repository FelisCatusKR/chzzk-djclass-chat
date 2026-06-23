from typing import Any
from typing import cast

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import HttpRequest
from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from djclass_overlay.common import ratelimit
from djclass_overlay.djclass import badges
from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.djclass.resolver import invalidate_user
from djclass_overlay.djclass.sync import sync_user
from djclass_overlay.users.models import User

from .models import VarchiveToken


def _link_context(
    user: User,
    message: str | None = None,
    message_type: str | None = None,
) -> dict[str, Any]:
    """Build the /link state: the active link, the preferred-button picker options
    (auto + one per synced button, each with a compact badge), and an optional flash."""
    link: VarchiveToken | None = VarchiveToken.objects.filter(
        user=user, is_active=True
    ).first()
    rows: list[DjClass] = (
        list(DjClass.objects.filter(user=user).order_by("button")) if link else []
    )
    options: list[dict[str, Any]] = []
    if rows:
        auto = badges.resolve_displayed_class(rows, None, "auto")
        if auto is not None:
            options.append(
                {
                    "label": "자동 (최고 클래스)",
                    "value": "auto",
                    "badge": badges.build_badge(auto),
                    "checked": user.preferred_button is None,
                }
            )
        options.extend(
            {
                "label": f"{row.button}버튼",
                "value": str(row.button),
                "badge": badges.build_badge(row),
                "checked": user.preferred_button == row.button,
            }
            for row in rows
        )
    return {
        "link": link,
        "varchive_nickname": link.varchive_nickname if link else None,
        "options": options,
        "message": message,
        "message_type": message_type,
    }


def _render_card(
    request: HttpRequest,
    message: str | None = None,
    message_type: str | None = None,
) -> HttpResponse:
    """Render just the #link-card partial for an hx-post swap (Django 6.0 partials)."""
    return render(
        request,
        "viewers/link.html#link_card",
        _link_context(cast("User", request.user), message, message_type),
    )


@login_required
def link_page(request: HttpRequest) -> HttpResponse:
    return render(
        request,
        "viewers/link.html",
        _link_context(cast("User", request.user)),
    )


@login_required
@require_POST
def link_connect(request: HttpRequest) -> HttpResponse:
    if not ratelimit.allow(request, scope="link", limit=5, window=60):
        return _render_card(
            request, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "error"
        )
    token: str = (request.POST.get("token") or "").strip()
    if not token:
        return _render_card(request, "조회토큰을 입력하세요.", "error")
    try:
        info = varchive.lookup_user(token)
    except varchive.InvalidTokenError:
        return _render_card(
            request, "조회토큰이 유효하지 않습니다. 다시 확인해주세요.", "error"
        )
    except varchive.VarchiveError:
        return _render_card(request, "네트워크 오류가 발생했습니다.", "error")
    user = cast("User", request.user)
    link, _ = VarchiveToken.objects.update_or_create(
        user=user,
        defaults={
            "varchive_nickname": info["nickname"],
            "varchive_user_no": info["user_no"],
            "is_active": True,
        },
    )
    sync_user(link)  # immediate first sync (empty result is fine — no badges yet)
    return _render_card(
        request, "연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다.", "success"
    )


@login_required
@require_POST
def link_sync(request: HttpRequest) -> HttpResponse:
    if not ratelimit.allow(request, scope="sync", limit=3, window=60):
        return _render_card(
            request, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "error"
        )
    user = cast("User", request.user)
    link: VarchiveToken | None = VarchiveToken.objects.filter(
        user=user, is_active=True
    ).first()
    if link is None:
        return _render_card(request, "먼저 V-ARCHIVE를 연동해주세요.", "error")
    result = sync_user(link)
    if not result["ok"]:
        # stale = had rows before but the fetch came back empty → the V-ARCHIVE
        # nickname likely changed; prompt a re-link instead of wiping good data.
        if result["stale"]:
            return _render_card(
                request,
                "DJ CLASS 정보를 찾을 수 없습니다. "
                "V-ARCHIVE 닉네임이 바뀌었다면 다시 연동해주세요.",
                "error",
            )
        return _render_card(request, "동기화할 DJ CLASS 정보가 없습니다.", "error")
    highest: DjClass | None = result["highest"]
    label: str = f"{highest.button}B {highest.dj_class}" if highest else "BEGINNER"
    return _render_card(request, f"DJ CLASS 동기화 완료: {label}", "success")


@login_required
@require_POST
def link_unlink(request: HttpRequest) -> HttpResponse:
    user = cast("User", request.user)
    link: VarchiveToken | None = VarchiveToken.objects.filter(
        user=user, is_active=True
    ).first()
    if link is not None:
        with transaction.atomic():
            link.is_active = False
            link.save()
            DjClass.objects.filter(user=user).delete()
            user.preferred_button = None
            user.save(update_fields=["preferred_button"])
        invalidate_user(user)
    return _render_card(request, "V-ARCHIVE 연동을 해제했습니다.", "success")


@login_required
@require_POST
def link_preferred_button(request: HttpRequest) -> HttpResponse:
    if not ratelimit.allow(request, scope="pref", limit=10, window=60):
        return _render_card(
            request, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "error"
        )
    user = cast("User", request.user)
    raw: str | None = request.POST.get("button")
    available: list[int] = list(
        DjClass.objects.filter(user=user).values_list("button", flat=True)
    )
    try:
        parsed: int | None = None if raw in (None, "", "auto") else int(raw or "")
    except (TypeError, ValueError):
        return _render_card(request, "잘못된 버튼 선택입니다.", "error")
    try:
        value: int | None = badges.validate_preferred_button(parsed, available)
    except ValueError:
        return _render_card(request, "잘못된 버튼 선택입니다.", "error")
    user.preferred_button = value
    user.save(update_fields=["preferred_button"])
    invalidate_user(user)
    return _render_card(request)
