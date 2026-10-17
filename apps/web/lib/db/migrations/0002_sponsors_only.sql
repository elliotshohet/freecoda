-- Business model changed before launch: one free plan funded by direct sponsors.
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS checkouts;
DROP TABLE IF EXISTS wallet_ledger;
ALTER TABLE profiles DROP COLUMN IF EXISTS wallet_micros;
ALTER TABLE profiles DROP COLUMN IF EXISTS paid_enabled;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS campaigns (id text PRIMARY KEY,sponsor text NOT NULL,headline text NOT NULL,description text NOT NULL,url text NOT NULL,placement text NOT NULL CHECK(placement IN ('web','terminal','both')),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT false,impression_limit bigint NOT NULL DEFAULT 0,impressions bigint NOT NULL DEFAULT 0,clicks bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS ad_events (nonce text PRIMARY KEY,campaign_id text NOT NULL REFERENCES campaigns(id),impressed boolean NOT NULL DEFAULT false,clicked boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sponsor_inquiries (id text PRIMARY KEY,business text NOT NULL,email text NOT NULL,website text NOT NULL,message text NOT NULL,status text NOT NULL DEFAULT 'new',created_at timestamptz NOT NULL DEFAULT now());
