export interface TunnelRecord {
  subdomain: string;
  tunnelId: string;
  dnsRecordId: string;
  createdAt: number;
  lastSeen: number;
  secretHash: string;
}

interface Row {
  subdomain: string;
  tunnel_id: string;
  dns_record_id: string;
  created_at: number;
  last_seen: number;
  secret_hash: string;
}

const DAY_MS = 86_400_000;

/** Timestamps are kept at day granularity: enough for expiry, no usage pattern. */
export function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function fromRow(r: Row): TunnelRecord {
  return {
    subdomain: r.subdomain,
    tunnelId: r.tunnel_id,
    dnsRecordId: r.dns_record_id,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
    secretHash: r.secret_hash,
  };
}

export async function insertTunnel(db: D1Database, t: TunnelRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tunnels (subdomain, tunnel_id, dns_record_id, created_at, last_seen, secret_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(t.subdomain, t.tunnelId, t.dnsRecordId, t.createdAt, t.lastSeen, t.secretHash)
    .run();
}

export async function findByTunnelId(db: D1Database, tunnelId: string): Promise<TunnelRecord | null> {
  const row = await db.prepare(`SELECT * FROM tunnels WHERE tunnel_id = ?`).bind(tunnelId).first<Row>();
  return row ? fromRow(row) : null;
}

export async function touch(db: D1Database, subdomain: string, lastSeen: number): Promise<void> {
  await db
    .prepare(`UPDATE tunnels SET last_seen = ? WHERE subdomain = ? AND last_seen < ?`)
    .bind(lastSeen, subdomain, lastSeen)
    .run();
}

export async function countTunnels(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM tunnels`).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listStale(db: D1Database, before: number, limit: number): Promise<TunnelRecord[]> {
  const { results } = await db
    .prepare(`SELECT * FROM tunnels WHERE last_seen < ? ORDER BY last_seen LIMIT ?`)
    .bind(before, limit)
    .all<Row>();
  return results.map(fromRow);
}

export async function deleteRecord(db: D1Database, subdomain: string): Promise<void> {
  await db.prepare(`DELETE FROM tunnels WHERE subdomain = ?`).bind(subdomain).run();
}
