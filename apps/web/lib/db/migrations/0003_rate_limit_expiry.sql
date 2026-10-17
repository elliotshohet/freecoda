-- Bucket numbers have different units for each rate window; retain an absolute expiry.
-- Legacy windows are at most one hour; this grace period preserves their limits.
ALTER TABLE request_limits ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour';
CREATE INDEX request_limits_expiry ON request_limits(expires_at);
