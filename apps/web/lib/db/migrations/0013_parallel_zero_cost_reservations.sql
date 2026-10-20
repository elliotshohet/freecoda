-- Parallel admission remains bounded to three verified zero-cost pending rows
-- by usage.reserve under the existing free-budget transaction advisory lock.
-- This replaces the older unconditional one-request index; indexes alone do
-- not enforce the cap or forbid mixed zero/costly rows. reserve is the sole
-- application insertion path and must retain that serialized admission check.
CREATE INDEX IF NOT EXISTS active_reservations_by_user
  ON reservations(user_id)
  WHERE status IN ('pending','uncertain');

-- Keep a database defense against multiple nonzero or unverified active costs.
-- The immutable reservation tuple is the original cost proof; do not consult a
-- mutable model catalog to reclassify outstanding requests.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_costly_reservation
  ON reservations(user_id)
  WHERE status IN ('pending','uncertain')
    AND NOT (
      source='free'
      AND model='reflection/beam-free'
      AND max_cost_micros=0
    );

DROP INDEX IF EXISTS one_active_reservation;

-- An uncertain zero-cost row still blocks NEW admission in usage.reserve until
-- reconciled (including the existing bounded stale-free recovery). Excluding it
-- from the costly index does not grant admission or convert it back to pending.
-- Source migration only: apply through the normal reviewed deployment process.
