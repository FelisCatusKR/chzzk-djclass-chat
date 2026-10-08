# Go cutover checklist

Running list of what must be true before the Go server replaces Django in
production (stage 7). Stage 7 turns this into the step-by-step runbook.

## Verify before cutover

- [ ] **Live broadcast run**: during a real stream, run the Go server's widget
      next to the production widget in OBS (user sessions allow 3 sockets).
      Check real CHAT payloads (emoji URLs, nickname, `senderChannelId`), no
      dropped messages vs. production, and a full broadcast without stalls.
      Expect real viewers to show `미인증` until data is imported.
- [ ] **Import rehearsal**: `dumpdata` → Go import into a scratch SQLite file;
      every token decrypts, row counts match, and badges for a sample of
      linked viewers equal the Django resolver's output.
- [ ] Widget URLs (`/widget/<channelId>/`) and the OAuth callback path
      (`/api/auth/chzzk/callback`) unchanged, so OBS sources and the Chzzk app
      config keep working.

## Before switching

- [ ] Move widget assets (`chat.css`, `widget.js`) into `go/` and embed them
      (the server currently reads them from the Django tree via `DJANGO_DIR`).
- [x] Security headers / CSP (incl. Naver emoji CDN in `img-src`) — stage 5a.
- [ ] When moving `components.js` into `go/`, drop its hx-boost/initTree
      workarounds (the Go pages don't boost).
