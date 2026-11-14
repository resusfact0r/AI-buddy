CREATE TABLE login_limits (
    login_hash text PRIMARY KEY,
    attempts integer NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX login_limits_expiry ON login_limits (expires_at);
