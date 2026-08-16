-- Per-user passkeys, replacing the single shared console password.
--
-- Until now the console had one identity: whoever knew UI_PASSWORD. There was
-- no user record to attach anything to, no way to revoke one person's access
-- without changing everybody's, and no answer to "who acknowledged this CVE".
-- These tables give the console real users, authenticated with WebAuthn.
--
-- Two deviations from the conventions elsewhere in this schema, both deliberate:
--
--   Identifiers are uuid, not identity columns. A credential id and a user id
--   travel in URLs and in audit records, where a guessable sequence leaks how
--   many accounts exist and lets one id be tried against another.
--
--   Binary is bytea, not base64 text. A credential id, a public key and a
--   session hash are byte strings; storing them as text means an encoding to
--   agree on, and two encodings of the same key that no longer compare equal.
--
-- The bootstrap flag lives in the existing `settings` table rather than in a
-- second key/value table, so there is one place to look for runtime state.
--
-- Rollback, verified by hand (the runner is forward-only by design):
--
--   DROP TABLE IF EXISTS auth_audit_log, recovery_codes, user_invites,
--                        sessions, webauthn_challenges, webauthn_credentials,
--                        users CASCADE;
--   DELETE FROM settings WHERE key LIKE 'auth.%';

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The WebAuthn user handle: 32 random bytes the authenticator stores
    -- alongside the credential. Deliberately not the primary key — the handle
    -- is given to every authenticator this user registers, so it must stay
    -- opaque and must never carry meaning that could change.
    handle        bytea NOT NULL UNIQUE,
    username      text NOT NULL,
    display_name  text NOT NULL,
    is_admin      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Disabling keeps the audit trail and the credentials; deleting the row
    -- would take both with it. Same reasoning as the soft deletes elsewhere.
    disabled_at   timestamptz
);

-- Case-insensitive uniqueness without depending on the citext extension, which
-- a managed Postgres role is not always allowed to create.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id    bytea NOT NULL UNIQUE,
    public_key       bytea NOT NULL,
    -- Counters are 32-bit in the specification, but a synced passkey reports
    -- zero forever and a hardware key can be replaced; bigint costs nothing and
    -- removes one way for this column to ever overflow.
    sign_count       bigint NOT NULL DEFAULT 0,
    transports       text[] NOT NULL DEFAULT '{}',
    aaguid           uuid,
    backup_eligible  boolean NOT NULL DEFAULT false,
    backup_state     boolean NOT NULL DEFAULT false,
    nickname         text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_used_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials (user_id);

-- Challenges are issued by this service and must come back unchanged, exactly
-- once. Keeping them in a table rather than in memory means a restart, a second
-- container or a load balancer cannot turn a replay into a valid ceremony.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge    bytea NOT NULL,
    -- 'registration' or 'authentication'. A challenge issued for one ceremony
    -- is not accepted by the other.
    ceremony     text NOT NULL,
    user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
    ON webauthn_challenges (challenge, ceremony);

-- Only the hash of the cookie value is stored. A dump of this table is not a
-- set of usable sessions, and revoking one is a row update rather than a
-- secret rotation that logs everybody out.
CREATE TABLE IF NOT EXISTS sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE,
    -- A recovery session may only enroll a passkey. Nothing else in the console
    -- accepts it, so a used recovery code cannot become general access.
    scope         text NOT NULL DEFAULT 'full',
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz,
    user_agent    text
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- A passkey lives inside a credential provider the user does not control. If
-- that provider is lost, these codes are the only way back in.
CREATE TABLE IF NOT EXISTS recovery_codes (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes (user_id);

-- After bootstrap, an account exists only because an admin invited it. The
-- token is stored hashed for the same reason a session is.
CREATE TABLE IF NOT EXISTS user_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  bytea NOT NULL UNIQUE,
    username    text NOT NULL,
    display_name text NOT NULL,
    is_admin    boolean NOT NULL DEFAULT false,
    invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_invites_expiry ON user_invites (expires_at);

-- Every authentication decision, including the ones that failed. An identity
-- system that cannot say what happened is not one anybody can trust after an
-- incident.
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    event      text NOT NULL,
    metadata   jsonb NOT NULL DEFAULT '{}',
    ip         inet,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_log_created ON auth_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user ON auth_audit_log (user_id, created_at DESC);
