CREATE TABLE IF NOT EXISTS synced_conversations (
 id uuid NOT NULL,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN ('chat','coding')),
 payload text,
 title_payload text,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 updated_at timestamptz(3) NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 PRIMARY KEY(user_id,id)
);
CREATE INDEX IF NOT EXISTS synced_conversations_list ON synced_conversations(user_id,mode,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
