-- One row per provisioned tunnel. Nothing else about a student is stored.
-- Timestamps are milliseconds since epoch, truncated to the UTC day.
CREATE TABLE tunnels (
  subdomain     TEXT PRIMARY KEY,
  tunnel_id     TEXT NOT NULL UNIQUE,
  dns_record_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  secret_hash   TEXT NOT NULL
);

CREATE INDEX tunnels_last_seen ON tunnels (last_seen);
