def test_landing_renders(client):
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.content.decode()
    assert "Chzzk DJ CLASS 채팅 위젯" in body
    assert "스트리머이신가요?" in body
    assert "시청자이신가요?" in body
    assert 'href="/dashboard/"' in body
    assert 'href="/link/"' in body
    assert "DJMAX RESPECT V" in body  # footer disclaimer
