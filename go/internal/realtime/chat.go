package realtime

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ChatMessage is one normalized CHAT event waiting for the next flush.
type ChatMessage struct {
	ChannelID       string
	SenderChannelID string
	Nickname        string
	Content         string
	MessageTime     int64 // unix ms
	Emojis          map[string]string
}

// ExtractChat is a port of ingestor.extract_chat: it reads exactly the fields
// the Python/Node apps read, with the same fallbacks (profile → top level,
// payload channelId → the connection's), and drops non-string emoji URLs.
func ExtractChat(p map[string]any, channelID string) ChatMessage {
	profile, _ := p["profile"].(map[string]any)
	emojis := map[string]string{}
	if raw, ok := p["emojis"].(map[string]any); ok {
		for k, v := range raw {
			if s, ok := v.(string); ok && isNaverImage(s) {
				emojis[k] = s
			}
		}
	}
	return ChatMessage{
		ChannelID:       or(str(p["channelId"]), channelID),
		SenderChannelID: or(str(profile["senderChannelId"]), str(p["senderChannelId"])),
		Nickname:        or(str(profile["nickname"]), str(p["nickname"])),
		Content:         str(p["content"]),
		MessageTime:     toInt64(p["messageTime"]),
		Emojis:          emojis,
	}
}

// isNaverImage keeps only https URLs on Chzzk's (Naver's) image CDNs — the
// same hosts the widget CSP allows — so a payload can't point the streamer's
// OBS at an arbitrary server.
func isNaverImage(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return strings.HasSuffix(h, ".pstatic.net") || strings.HasSuffix(h, ".naver.net")
}

// str mirrors Python's str(x or ""): JSON falsy values become "".
func str(v any) string {
	switch v := v.(type) {
	case nil:
		return ""
	case string:
		return v
	case bool:
		if !v {
			return ""
		}
		return "True"
	case float64:
		if v == 0 {
			return ""
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return fmt.Sprint(v)
	}
}

func or(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// toInt64 mirrors int(x or 0) for the JSON shapes Chzzk sends.
func toInt64(v any) int64 {
	switch v := v.(type) {
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	}
	return 0
}
