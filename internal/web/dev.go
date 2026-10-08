package web

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// Dev mode lets you see badges render without going live (Chzzk only allows
// chatting during a broadcast): demo viewers are seeded into the DB and
// /dev injects chat as them into an open widget's channel. The injected
// messages go through the real resolver → batch → SSE → widget.js path.

type devSender struct {
	ID, Nickname, Label string
}

var devSenders = []devSender{
	{"dev-showstopper", "DEV 쇼스토퍼", "연동됨: 4B SS II / 8B HL I (선호 8B)"},
	{"dev-theory", "DEV 이론치", "연동됨: 5B LoD 이론치"},
	{"dev-beginner", "DEV 비기너", "연동됨: 6B BEGINNER"},
	{"dev-unsynced", "DEV 동기화전", "연동됨, DJ CLASS 없음"},
	{"dev-unlinked", "DEV 미인증", "미인증 (DB에 없음)"},
}

// SeedDev upserts the demo viewers. Idempotent.
func SeedDev(ctx context.Context, s *store.Store) error {
	f := func(v float64) *float64 { return &v }
	classes := map[string][]db.UpsertDjClassParams{
		"dev-showstopper": {
			{Button: 4, DjClass: "SHOWSTOPPER II", DjPowerConversion: f(9810)},
			{Button: 8, DjClass: "HEADLINER I", DjPowerConversion: f(9660)},
		},
		"dev-theory":   {{Button: 5, DjClass: "THE LORD OF DJMAX", DjPowerConversion: f(9999.9847)}},
		"dev-beginner": {{Button: 6, DjClass: "BEGINNER", DjPowerConversion: f(120.5)}},
		"dev-unsynced": nil,
	}
	return s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		for _, d := range devSenders {
			rows, linked := classes[d.ID]
			if !linked {
				continue
			}
			u, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: d.ID, ChzzkNickname: d.Nickname})
			if err != nil {
				return err
			}
			if err := q.UpsertVarchiveLink(ctx, db.UpsertVarchiveLinkParams{UserID: u.ID, VarchiveNickname: d.Nickname}); err != nil {
				return err
			}
			for _, row := range rows {
				row.UserID = u.ID
				if err := q.UpsertDjClass(ctx, row); err != nil {
					return err
				}
			}
			if d.ID == "dev-showstopper" {
				pref := int64(8)
				if err := q.SetPreferredButton(ctx, db.SetPreferredButtonParams{PreferredButton: &pref, ID: u.ID}); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (s *Server) devPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, http.StatusOK, "dev.html", struct {
		Channel, Flash string
		Senders        []devSender
	}{r.URL.Query().Get("channel"), r.URL.Query().Get("flash"), devSenders})
}

func (s *Server) devChat(w http.ResponseWriter, r *http.Request) {
	channel, senderID, text := r.FormValue("channel"), r.FormValue("sender"), r.FormValue("text")
	flash := "위젯이 열려 있지 않은 채널입니다. 먼저 위젯을 여세요."
	for _, d := range devSenders {
		if d.ID != senderID {
			continue
		}
		ok := s.Hub.Inject(channel, realtime.ChatMessage{
			ChannelID: channel, SenderChannelID: d.ID, Nickname: d.Nickname,
			Content: text, MessageTime: time.Now().UnixMilli(), Emojis: map[string]string{},
		})
		if ok {
			flash = d.Nickname + " 이름으로 보냈습니다."
		}
	}
	q := url.Values{"channel": {channel}, "flash": {flash}}
	http.Redirect(w, r, "/dev?"+q.Encode(), http.StatusSeeOther)
}
