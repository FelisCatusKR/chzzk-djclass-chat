# All four headers come from base.py (the SECURE_* settings + the clickjacking and
# common SecurityHeadersMiddleware), so they apply under any settings module.
def test_security_headers_present(client):
    resp = client.get("/")
    assert resp["X-Frame-Options"] == "DENY"
    assert resp["X-Content-Type-Options"] == "nosniff"
    assert resp["Referrer-Policy"] == "same-origin"
    assert resp["Permissions-Policy"] == "geolocation=(), microphone=(), camera=()"


def test_csp_header(client):
    resp = client.get("/")
    csp = resp["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net" in csp
    assert "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net" in csp
    assert "https://chzzk-djclass-assets.pages.dev" in csp  # cover image
    assert "connect-src 'self'" in csp  # htmx + SSE
    assert "font-src https://cdn.jsdelivr.net" in csp  # Pretendard font


def test_csp_img_src_allows_chzzk_emoji_cdn(client):
    # Chzzk (a Naver service) serves chat emoticon images from Naver's image CDN
    # (*.pstatic.net / *.naver.net); the overlay renders them as <img> in widget.js.
    # img-src MUST allowlist those hosts or the browser blocks every emoji as a CSP
    # violation. The legacy next.config.js allowed them; the Django port dropped them.
    resp = client.get("/")
    csp = resp["Content-Security-Policy"]
    assert "https://*.pstatic.net" in csp
    assert "https://*.naver.net" in csp
