CREATE TABLE IF NOT EXISTS github_repository_settings (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(settings) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
