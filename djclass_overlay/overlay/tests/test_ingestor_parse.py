from djclass_overlay.overlay import ingestor


def test_parse_handles_dict_string_and_garbage():
    assert ingestor.parse({"a": 1}) == {"a": 1}
    assert ingestor.parse('{"a": 1}') == {"a": 1}
    assert ingestor.parse("not json") == {}
    assert ingestor.parse(123) == {}


def test_extract_chat_full_payload():
    raw = {
        "profile": {"nickname": "Streamer", "senderChannelId": "snd1"},
        "content": "hello {:cat:}",
        "channelId": "chan1",
        "messageTime": 1700000000000,
        "emojis": {"cat": "https://e/cat.png", "bad": 123},
    }
    msg = ingestor.extract_chat(raw, "chan1")
    assert msg == {
        "channelId": "chan1",
        "senderChannelId": "snd1",
        "nickname": "Streamer",
        "content": "hello {:cat:}",
        "messageTime": 1700000000000,
        "emojis": {"cat": "https://e/cat.png"},  # non-string emoji value dropped
    }


def test_extract_chat_fallbacks():
    # nickname falls back to top-level; channelId falls back to the connection's id;
    # missing emojis → {}
    msg = ingestor.extract_chat({"nickname": "Top", "content": "hi"}, "chanX")
    assert msg["nickname"] == "Top"
    assert msg["channelId"] == "chanX"
    assert msg["senderChannelId"] == ""
    assert msg["emojis"] == {}
