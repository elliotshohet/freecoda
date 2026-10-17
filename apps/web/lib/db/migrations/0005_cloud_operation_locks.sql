ALTER TABLE cloud_projects ALTER COLUMN app_directory SET DEFAULT '/home/project/app';
ALTER TABLE cloud_projects ADD COLUMN operation_token text;
ALTER TABLE cloud_projects ADD COLUMN operation_expires_at timestamptz;
