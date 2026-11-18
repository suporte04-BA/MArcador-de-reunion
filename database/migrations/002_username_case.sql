-- 002: usernames case-sensitive (preserva maiúsculas/minúsculas)
-- Remove o CHECK que forçava minúsculas e troca a unique key por uma
-- case-insensitive (lower) para manter unicidade sem forçar o case.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_check;

DROP INDEX IF EXISTS users_username_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci_key ON users (lower(username));
