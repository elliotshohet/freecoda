CREATE TABLE maintenance_status (
 id text PRIMARY KEY CHECK(id='daily'),started_at timestamptz NOT NULL,
 finished_at timestamptz,status text NOT NULL CHECK(status IN('running','ok','failed')),
 counts jsonb NOT NULL DEFAULT '{}'
);
