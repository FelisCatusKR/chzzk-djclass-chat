# All four headers come from base.py (the SECURE_* settings + the clickjacking and
# common SecurityHeadersMiddleware), so they apply under any settings module.
def test_security_headers_present(client):
    resp = client.get("/")
    assert resp["X-Frame-Options"] == "DENY"
    assert resp["X-Content-Type-Options"] == "nosniff"
    assert resp["Referrer-Policy"] == "same-origin"
    assert resp["Permissions-Policy"] == "geolocation=(), microphone=(), camera=()"


def test_csp_report_only_header(client):
    resp = client.get("/")
    csp = resp["Content-Security-Policy-Report-Only"]
    assert "default-src 'self'" in csp
    assert "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net" in csp
    assert "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net" in csp
    assert "https://chzzk-djclass-assets.pages.dev" in csp   # cover image
    assert "connect-src 'self'" in csp                       # htmx + SSE
    assert "font-src https://cdn.jsdelivr.net" in csp        # Pretendard font
