from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.http import require_POST

from djclass_overlay.djclass import badges
from djclass_overlay.djclass.models import DjClass

from .models import VarchiveToken


def _link_context(user, message=None, message_type=None):
    """Build the /link state: the active link, the preferred-button picker options
    (auto + one per synced button, each with a compact badge), and an optional flash."""
    link = VarchiveToken.objects.filter(user=user, is_active=True).first()
    rows = list(DjClass.objects.filter(user=user).order_by("button")) if link else []
    options = []
    if rows:
        auto = badges.resolve_displayed_class(rows, None, "auto")
        options.append({
            "label": "자동 (최고 클래스)", "value": "auto",
            "badge": badges.build_badge(auto), "checked": user.preferred_button is None,
        })
        for row in rows:
            options.append({
                "label": f"{row.button}버튼", "value": str(row.button),
                "badge": badges.build_badge(row),
                "checked": user.preferred_button == row.button,
            })
    return {
        "link": link,
        "varchive_nickname": link.varchive_nickname if link else None,
        "options": options,
        "message": message,
        "message_type": message_type,
    }


def _render_card(request, message=None, message_type=None):
    """Render just the #link-card partial for an hx-post swap (Django 6.0 partials)."""
    return render(request, "viewers/link.html#link_card",
                  _link_context(request.user, message, message_type))


@login_required
def link_page(request):
    return render(request, "viewers/link.html", _link_context(request.user))


@login_required
@require_POST
def link_connect(request):
    return _render_card(request)  # implemented in a later task


@login_required
@require_POST
def link_sync(request):
    return _render_card(request)  # implemented in a later task


@login_required
@require_POST
def link_unlink(request):
    return _render_card(request)  # implemented in a later task


@login_required
@require_POST
def link_preferred_button(request):
    return _render_card(request)  # implemented in a later task
