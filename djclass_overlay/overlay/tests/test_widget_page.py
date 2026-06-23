import pytest


@pytest.mark.django_db
def test_widget_page_uses_data_attr_not_inline_script(client):
    # The channel id rides on a #chat data attribute (read by widget.js), NOT an
    # inline <script> — so the page works under an enforced CSP with no 'unsafe-inline'.
    body = client.get("/widget/abc123/").content.decode()
    assert 'data-channel-id="abc123"' in body
    assert "window.CHANNEL_ID" not in body
