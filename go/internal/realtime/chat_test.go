package realtime

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Ported from djclass_overlay/overlay/tests/test_ingestor_parse.py.

func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestExtractChatFullPayload(t *testing.T) {
	got := ExtractChat(decode(t, `{
		"profile": {"nickname": "Streamer", "senderChannelId": "snd1"},
		"content": "hello {:cat:}",
		"channelId": "chan1",
		"messageTime": 1700000000000,
		"emojis": {"cat": "https://ssl.pstatic.net/static/cat.png", "bad": 123}
	}`), "chan1")
	want := ChatMessage{
		ChannelID:       "chan1",
		SenderChannelID: "snd1",
		Nickname:        "Streamer",
		Content:         "hello {:cat:}",
		MessageTime:     1700000000000,
		Emojis:          map[string]string{"cat": "https://ssl.pstatic.net/static/cat.png"}, // non-string dropped
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestExtractChatFallbacks(t *testing.T) {
	got := ExtractChat(decode(t, `{"nickname": "Top", "content": "hi"}`), "chanX")
	if got.Nickname != "Top" || got.ChannelID != "chanX" || got.SenderChannelID != "" ||
		got.Emojis == nil || len(got.Emojis) != 0 || got.MessageTime != 0 {
		t.Errorf("got %+v", got)
	}
	// profile wins over top level; empty profile values fall back
	got = ExtractChat(decode(t, `{"profile": {"nickname": ""}, "nickname": "Top", "senderChannelId": "s"}`), "c")
	if got.Nickname != "Top" || got.SenderChannelID != "s" {
		t.Errorf("got %+v", got)
	}
	// odd shapes don't panic
	got = ExtractChat(decode(t, `{"profile": "x", "emojis": [1], "messageTime": "42", "content": 7}`), "c")
	if got.MessageTime != 42 || got.Content != "7" {
		t.Errorf("got %+v", got)
	}
}

func TestEmojiURLsLimitedToNaverCDN(t *testing.T) {
	got := ExtractChat(decode(t, `{"emojis": {
		"ok1": "https://ssl.pstatic.net/a.png",
		"ok2": "https://NNG-PHINF.PSTATIC.NET/b.gif",
		"ok3": "https://x.naver.net/c.png",
		"http": "http://ssl.pstatic.net/a.png",
		"js": "javascript:alert(1)",
		"data": "data:image/png;base64,AAAA",
		"other": "https://evil.example/a.png",
		"suffix": "https://pstatic.net.evil.example/a.png",
		"lookalike": "https://evilpstatic.net/a.png",
		"userinfo": "https://ssl.pstatic.net@evil.example/a.png"
	}}`), "c")
	want := map[string]string{
		"ok1": "https://ssl.pstatic.net/a.png",
		"ok2": "https://NNG-PHINF.PSTATIC.NET/b.gif",
		"ok3": "https://x.naver.net/c.png",
	}
	if !reflect.DeepEqual(got.Emojis, want) {
		t.Errorf("emojis = %v", got.Emojis)
	}
}
