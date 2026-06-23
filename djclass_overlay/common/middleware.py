from collections.abc import Callable

from django.http import HttpRequest
from django.http import HttpResponse


class SecurityHeadersMiddleware:
    """Set response security headers Django has no built-in setting for.
    (X-Frame-Options/nosniff/Referrer-Policy/HSTS come from Django's own
    middleware; only Permissions-Policy needs setting here.)"""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        response.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        return response
