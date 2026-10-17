ALTER TABLE cloud_compute_reservations
 ADD COLUMN actual_seconds integer CHECK(actual_seconds>=0 AND actual_seconds<=seconds),
 ADD COLUMN settled_at timestamptz,
 ADD COLUMN settlement_reason text CHECK(settlement_reason IN ('confirmed_stop','hard_timeout','no_resource_created','legacy_reserved'));
-- Existing settlements charged their full reservation; their stop time was not recorded.
UPDATE cloud_compute_reservations SET actual_seconds=seconds,settlement_reason='legacy_reserved' WHERE status='settled';
