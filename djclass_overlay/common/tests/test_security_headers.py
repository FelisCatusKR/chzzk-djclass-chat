# All four headers come from base.py (the SECURE_* settings + the clickjacking and
# common SecurityHeadersMiddleware), so they apply under any settings module.
def test_security_headers_present(client):
    resp = client.get("/")
    assert resp["X-Frame-Options"] == "DENY"
    assert resp["X-Content-Type-Options"] == "nosniff"
    assert resp["Referrer-Policy"] == "same-origin"
    assert resp["Permissions-Policy"] == "geolocation=(), microphone=(), camera=()"
