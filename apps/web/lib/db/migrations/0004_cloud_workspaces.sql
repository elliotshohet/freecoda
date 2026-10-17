CREATE TABLE cloud_projects (
 id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,name text NOT NULL,
 status text NOT NULL CHECK(status IN ('creating','ready','suspended','failed','deleted')),sandbox_id text,snapshot_id text,
 app_directory text NOT NULL DEFAULT '/home/project/app',payload text NOT NULL,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE INDEX cloud_projects_owner ON cloud_projects(user_id,expires_at);
CREATE TABLE cloud_runs (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),workflow_id text,payload text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cloud_active_user ON cloud_runs(user_id) WHERE status IN ('queued','running');
CREATE INDEX cloud_runs_project ON cloud_runs(project_id,created_at);
CREATE TABLE cloud_events(id bigserial PRIMARY KEY,run_id uuid NOT NULL REFERENCES cloud_runs(id) ON DELETE CASCADE,type text NOT NULL,payload text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX cloud_events_run ON cloud_events(run_id,id);
CREATE TABLE cloud_compute_buckets(scope text NOT NULL,period text NOT NULL,reserved_seconds integer NOT NULL DEFAULT 0,spent_seconds integer NOT NULL DEFAULT 0,PRIMARY KEY(scope,period));
CREATE TABLE cloud_compute_reservations(id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,project_id uuid NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,day text NOT NULL,month text NOT NULL,seconds integer NOT NULL,status text NOT NULL CHECK(status IN('active','settled')),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX cloud_compute_one_user ON cloud_compute_reservations(user_id) WHERE status='active';
CREATE TABLE cloud_publications(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,idempotency_key text NOT NULL,review_hash text NOT NULL,status text NOT NULL,url text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,idempotency_key));
