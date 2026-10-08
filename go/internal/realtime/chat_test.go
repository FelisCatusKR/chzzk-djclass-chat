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
		"emojis": {"cat": "https://e/cat.png", "bad": 123}
	}`), "chan1")
	want := ChatMessage{
		ChannelID:       "chan1",
		SenderChannelID: "snd1",
		Nickname:        "Streamer",
		Content:         "hello {:cat:}",
		MessageTime:     1700000000000,
		Emojis:          map[string]string{"cat": "https://e/cat.png"}, // non-string dropped
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
