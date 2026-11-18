-- ============================================================
-- 001_init — Agenda Corporativa | BA Elétrica
-- Esquema completo: usuários, sessões, tokens, reuniões,
-- outbox de notificações e trilha de auditoria.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------ Usuários ------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             text NOT NULL,
  username              text NOT NULL,
  email                 text NOT NULL,
  password_hash         text,
  role                  text NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN','USER')),
  status                text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','INACTIVE')),
  avatar_path           text,
  must_change_password  boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  invitation_token_hash text,
  invitation_expires_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz,
  CHECK (username = lower(username)),
  CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_username_key ON users (username);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_role_idx ON users (role);

-- ------------------------------ Sessões ------------------------------
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            text,
  user_agent    text
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ------------------------------ Reuniões ------------------------------
CREATE TABLE meetings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  responsible_name      text NOT NULL,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  description           text NOT NULL,
  observations          text,
  status                text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CANCELLED')),
  created_by_user_id    uuid NOT NULL REFERENCES users(id),
  updated_by_user_id    uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  cancelled_at          timestamptz,
  cancelled_by_user_id  uuid REFERENCES users(id),
  CHECK (ends_at > starts_at)
);

CREATE INDEX meetings_starts_at_idx ON meetings (starts_at, ends_at);
CREATE INDEX meetings_creator_idx ON meetings (created_by_user_id, starts_at);
CREATE INDEX meetings_status_starts_idx ON meetings (status, starts_at);

-- Bloqueio de sobreposição no próprio banco (intervalos [início, fim)).
-- Reuniões consecutivas são permitidas: tstzrange com fim exclusivo.
-- Reuniões canceladas liberam o horário (criterio WHERE).
ALTER TABLE meetings
  ADD CONSTRAINT meetings_no_active_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');

-- ------------------------- Tokens de acesso -------------------------
CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('INVITE','PASSWORD_RESET')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

-- ----------------------- Fila de notificações -----------------------
CREATE TABLE notification_outbox (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type                text NOT NULL,
  meeting_id                uuid REFERENCES meetings(id) ON DELETE SET NULL,
  event_key                 text NOT NULL,
  recipient_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email_snapshot  text NOT NULL,
  recipient_name_snapshot   text NOT NULL,
  subject                   text NOT NULL,
  text_body                 text NOT NULL,
  html_body                 text NOT NULL,
  status                    text NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','SENDING','SENT','RETRYING','FAILED')),
  attempt_count             integer NOT NULL DEFAULT 0,
  next_attempt_at           timestamptz NOT NULL DEFAULT now(),
  last_error                text,
  provider_message_id       text,
  sent_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, recipient_user_id)
);

CREATE INDEX notification_outbox_status_idx ON notification_outbox (status, next_attempt_at);
CREATE INDEX notification_outbox_meeting_idx ON notification_outbox (meeting_id);

-- -------------------------- Auditoria ------------------------------
CREATE TABLE audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name    text,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  entity_label  text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
