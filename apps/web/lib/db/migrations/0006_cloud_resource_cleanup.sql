-- Independent of account/project cascades so deletion never loses cleanup handles.
CREATE TABLE cloud_resource_cleanup (
 id uuid PRIMARY KEY,
 sandbox_ids jsonb NOT NULL DEFAULT '[]',
 snapshot_ids jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now()
);
