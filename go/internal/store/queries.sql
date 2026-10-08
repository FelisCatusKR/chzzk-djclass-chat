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

-- Several users can share a nickname; take the oldest, deterministically.
-- name: GetUserByNickname :one
SELECT * FROM users WHERE chzzk_nickname = ? ORDER BY id LIMIT 1;

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
