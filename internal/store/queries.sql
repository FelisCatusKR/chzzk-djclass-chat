-- Queries for the realtime path (ingestor tokens, badge resolution) and login.
-- Link / sync / dashboard queries are added with those features.

-- name: UpsertUser :one
INSERT INTO users (chzzk_id, chzzk_nickname)
VALUES (?, ?)
ON CONFLICT (chzzk_id) DO UPDATE SET chzzk_nickname = excluded.chzzk_nickname
RETURNING *;

-- name: UpsertChannel :exec
INSERT INTO channels (user_id, chzzk_channel_id, access_token_encrypted, refresh_token_encrypted, token_expires_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET
    chzzk_channel_id        = excluded.chzzk_channel_id,
    access_token_encrypted  = excluded.access_token_encrypted,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    token_expires_at        = excluded.token_expires_at;

-- name: GetChannelByChzzkID :one
SELECT * FROM channels WHERE chzzk_channel_id = ?;

-- name: UpdateChannelTokens :exec
UPDATE channels
SET access_token_encrypted = ?, refresh_token_encrypted = ?, token_expires_at = ?
WHERE id = ?;

-- name: GetUserByChzzkID :one
SELECT * FROM users WHERE chzzk_id = ?;

-- name: HasActiveLink :one
SELECT EXISTS (
    SELECT 1 FROM varchive_links WHERE user_id = ? AND is_active = 1
) AS has_link;

-- name: ListDjClasses :many
SELECT * FROM dj_classes WHERE user_id = ? ORDER BY button;

-- name: UpsertVarchiveLink :exec
INSERT INTO varchive_links (user_id, varchive_nickname, varchive_user_no)
VALUES (?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET
    varchive_nickname = excluded.varchive_nickname,
    varchive_user_no  = excluded.varchive_user_no,
    is_active         = 1,
    updated_at        = unixepoch();

-- name: UpsertDjClass :exec
INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, button) DO UPDATE SET
    dj_class            = excluded.dj_class,
    dj_power_sum        = excluded.dj_power_sum,
    max_dj_power        = excluded.max_dj_power,
    dj_power_conversion = excluded.dj_power_conversion,
    synced_at           = unixepoch();

-- name: SetPreferredButton :exec
UPDATE users SET preferred_button = ? WHERE id = ?;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = ?;

-- Sessions (alexedwards/scs layout; expiry is a julianday REAL).

-- name: FindSession :one
SELECT data FROM sessions WHERE token = ? AND julianday('now') < expiry;

-- name: CommitSession :exec
REPLACE INTO sessions (token, data, expiry) VALUES (?, ?, julianday(?));

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token = ?;

-- name: DeleteExpiredSessions :exec
DELETE FROM sessions WHERE expiry < julianday('now');

-- name: GetActiveLink :one
SELECT * FROM varchive_links WHERE user_id = ? AND is_active = 1;

-- name: DeactivateLink :exec
UPDATE varchive_links SET is_active = 0, updated_at = unixepoch() WHERE user_id = ?;

-- name: DeleteDjClasses :exec
DELETE FROM dj_classes WHERE user_id = ?;

-- name: ListActiveLinks :many
SELECT l.user_id, l.varchive_nickname, u.chzzk_id, u.chzzk_nickname
FROM varchive_links l JOIN users u ON u.id = l.user_id
WHERE l.is_active = 1
ORDER BY l.user_id;
