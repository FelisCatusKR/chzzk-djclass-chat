class SecurityHeadersMiddleware:
    """Set response security headers Django has no built-in setting for.
    (X-Frame-Options/nosniff/Referrer-Policy/HSTS come from Django's own
    middleware; only Permissions-Policy needs setting here.)"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        return response
