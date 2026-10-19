CREATE TABLE IF NOT EXISTS cloud_user_consents (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  version text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purpose, version)
);
