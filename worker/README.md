# Am I Cooked tunnel provisioner

A Cloudflare Worker that gives each student's laptop its own Cloudflare named
tunnel and hostname (`<id>.amicooked.app`), so ChatGPT can reach the local Am I
Cooked MCP server. `amicooked setup` calls this Worker once, gets a
`tunnelToken`, and runs `cloudflared tunnel run --token <tunnelToken>`. The
Cloudflare API token never leaves the Worker.

No student data passes through here. MCP traffic goes ChatGPT → Cloudflare edge
→ tunnel → laptop. The Worker only creates and deletes tunnels.

## API

Every request needs a `User-Agent` that starts with `amicooked/<semver>`
(for example `amicooked/0.1.0 (darwin; node 22)`). Anything else gets `403`.

### `POST /tunnels`

No body. Creates a config-managed tunnel whose ingress sends
`<id>.amicooked.app` to `http://127.0.0.1:8787`, plus a proxied CNAME
`<id>.amicooked.app → <tunnelId>.cfargotunnel.com`.

`201`:

```json
{
  "subdomain": "k3x9q2mfa7bz4wde",
  "url": "https://k3x9q2mfa7bz4wde.amicooked.app",
  "tunnelId": "c0ffee00-1234-4abc-8def-0123456789ab",
  "tunnelToken": "eyJhIjoi…",
  "heartbeatSecret": "s3cr3t…"
}
```

`subdomain` is 16 random base32 characters (80 bits). The client must keep
`tunnelToken` and `heartbeatSecret`. They are shown once and can't be fetched
again (the Worker stores only a SHA-256 of the secret).

| Status | `error` | Meaning |
|---|---|---|
| 400 | `missing_client_ip` | No `CF-Connecting-IP` (not called through Cloudflare) |
| 429 | `rate_limited` | Over `RATE_LIMIT_PER_DAY` for this IP; see `Retry-After` |
| 503 | `at_capacity` | `MAX_TUNNELS` reached |
| 502 | `provision_failed` | Cloudflare API failed; partial resources were rolled back |

### `POST /tunnels/heartbeat`

```
Authorization: Bearer <heartbeatSecret>
Content-Type: application/json

{"tunnelId": "<tunnelId>"}
```

`204` on success. `tunnelId` is also inside the tunnel token (the `t` field of
its base64 JSON). `401` = wrong secret. `404` = the tunnel was cleaned up, so
the client should call `POST /tunnels` again and restart `cloudflared` with the
new token. `lastSeen` is kept at day granularity, so one heartbeat a day (for
example on service start and then every 12–24 h) is plenty.

### Daily cron

At 04:17 UTC, tunnels with no heartbeat for `STALE_AFTER_DAYS` (30) days are
removed: DNS record, then live connections, then the tunnel, then the row. At
most `CLEANUP_BATCH_SIZE` per run. Failures stay in the table and are retried
the next day. Resources that are already gone (404) count as deleted.

## What is stored

One D1 row per tunnel: `subdomain`, `tunnel_id`, `dns_record_id`,
`created_at`, `last_seen` (both truncated to the UTC day), `secret_hash`.
Nothing else.

The rate limiter is a Durable Object per (IP, UTC day). Its name is an HMAC of
the day and IP, so the IP itself is never stored. It holds only a counter and
deletes its storage when the day ends. Worker observability (request logs) is
off in `wrangler.toml`, and the code logs only error status codes and cleanup
counts.

## Setup

Needs a Cloudflare account with `amicooked.app` (or whatever domain you use)
added as a zone.

```bash
cd worker
npm install
```

1. **D1 database.** Create it and paste the printed `database_id` into
   `wrangler.toml`:

   ```bash
   npx wrangler d1 create amicooked-tunnels
   npx wrangler d1 migrations apply amicooked-tunnels --remote
   ```

2. **Account.** Uncomment `account_id` in `wrangler.toml`, or export
   `CLOUDFLARE_ACCOUNT_ID`.

3. **Domain.** Set `TUNNEL_DOMAIN` in `wrangler.toml` if it isn't
   `amicooked.app`. To serve the API from your own hostname instead of
   `*.workers.dev`, uncomment `routes`.

4. **API token.** In the dashboard go to *My Profile → API Tokens → Create
   Token → Custom token* and grant only:

   | Scope | Permission | Resource |
   |---|---|---|
   | Account | **Cloudflare Tunnel: Edit** | the account that owns the zone |
   | Zone | **DNS: Edit** | *Specific zone* → `amicooked.app` |

   Skip *Client IP Address Filtering* (the Worker calls the API from
   Cloudflare's network). A token expiry is fine if you rotate it.

5. **Secrets.**

   ```bash
   npx wrangler secret put CF_API_TOKEN
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_ZONE_ID
   ```

   The zone ID and account ID are on the zone's *Overview* page. Rotating
   `CF_API_TOKEN` also resets that day's rate-limit counters (it keys the IP
   HMAC), which is harmless.

6. **Deploy.**

   ```bash
   npx wrangler deploy --dry-run   # check config and bundle
   npx wrangler deploy
   ```

### Config vars (`wrangler.toml`)

| Var | Default | |
|---|---|---|
| `TUNNEL_DOMAIN` | `amicooked.app` | Zone for student hostnames |
| `ORIGIN_SERVICE` | `http://127.0.0.1:8787` | Where `cloudflared` forwards on the laptop |
| `RATE_LIMIT_PER_DAY` | `5` | `POST /tunnels` per IP per UTC day |
| `MAX_TUNNELS` | `200` | Refuse creation past this many rows |
| `STALE_AFTER_DAYS` | `30` | Cron deletes tunnels unseen this long |
| `CLEANUP_BATCH_SIZE` | `15` | Tunnels removed per cron run (3 subrequests each) |

## Limits

Checked November 2026:

- **Tunnels: 1,000 per account.** Inactive tunnels and ones with no connected
  `cloudflared` count too; deleted ones don't. When the limit is hit, creates
  fail and existing tunnels keep working. More capacity is available through
  [Tunnels for Platforms](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/)
  at $4.50 per extra tunnel per month (dashboard: *Networking → Tunnels → Buy
  more tunnels*). Source:
  [Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/).
- **Replicas: 25 active `cloudflared` per tunnel.** Each student runs one.
- **DNS records per zone:** Free 200 (zones created on or after 2024-09-01;
  1,000 for older Free zones), Pro / Business / Enterprise 3,500. Each student
  uses one record, so on a new Free zone **DNS, not tunnels, is the real cap at
  ~200 students** (minus your own records). That's why `MAX_TUNNELS` defaults
  to 200. Move the zone to Pro and raise it to 1000 when needed. Source:
  [DNS FAQ](https://developers.cloudflare.com/dns/faq/).
- **Workers Free plan: 50 subrequests per invocation.** Provisioning uses 4.
  Cleanup uses 3 per tunnel, hence `CLEANUP_BATCH_SIZE = 15`. On Workers Paid,
  raise it (for example to 200).

The 30-day cleanup is what keeps the account under these limits; abandoned
installs free their slot a month after their last heartbeat.

## Tests

```bash
npm test        # vitest + @cloudflare/vitest-pool-workers (real workerd, D1, Durable Objects)
npm run typecheck
```

The Cloudflare API is mocked by stubbing `fetch` (`test/cf-mock.ts`). No test
touches the network.

`@cloudflare/vitest-pool-workers` has been renamed to `@cloudflare/vitest-plugin`
upstream and prints a deprecation banner. It still works; migrate with
`npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` when convenient.
`.npmrc` sets `legacy-peer-deps` because npm 11 otherwise crashes resolving the
pool's vitest peer range.
