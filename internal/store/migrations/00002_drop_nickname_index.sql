-- Badge lookup no longer falls back to the Chzzk nickname (not unique, and
-- user-changeable: it let viewers impersonate linked users), so its index goes.

-- +goose Up
DROP INDEX users_chzzk_nickname_idx;

-- +goose Down
CREATE INDEX users_chzzk_nickname_idx ON users (chzzk_nickname);
