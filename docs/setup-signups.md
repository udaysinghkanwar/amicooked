# Setup completion and anonymous signup records

A configured app can still need reopening. Setup keeps that instruction in `Next`, then finishes with the normal green success message after the optional signup prompt. An actual connection failure keeps the incomplete-setup message and failure status. Signup storage failures do not turn a completed installation into a failed installation.

## Inputs and completion

- Trim surrounding whitespace. Accept `na` and `n/a` in any letter case as anonymous signup responses.
- Normalize and validate real email addresses with the existing email validator.
- Blank input and other invalid strings re-prompt. Cancelling sends nothing and leaves the prompt available for another setup run.
- Existing `signup-asked` markers remain valid; previously skipped users are not retroactively counted or subscribed.
- K-12 users, noninteractive runs and `--yes` are not prompted, as before.
- Anonymous delivery respects `DO_NOT_TRACK` and `AMICOOKED_NO_TELEMETRY`. A deliberately entered email remains an explicit email signup even when anonymous telemetry is disabled.

## Storage

Both collections use the existing Upstash Redis and `/api/signup`. No new provider or credentials are required.

| Redis hash | Field | JSON value |
|---|---|---|
| `signup:emails` | normalized email | `{ at, src: "cli-setup", consent, v }` |
| `signup:anonymous` | random submission UUID | `{ at, src: "cli-setup", v }` |

`at` is the server's UTC timestamp; `v` is the app version. Anonymous records contain no email (real or fake), email consent, school, raw IP, or persistent installation identifier. The UUID identifies this submission only. `HLEN signup:anonymous` counts accepted anonymous submissions, not unique people; `HGETALL signup:anonymous` includes their original timestamps. Rate limits and opted-out clients mean this is not a complete installation count.

The anonymous request is `{ kind: "anonymous", eventId, prompt: "2026-11-26-anonymous", version }`. Mixed anonymous/email requests and invalid IDs are rejected. Existing email requests and both older email prompt versions remain accepted.

## Retry safety

1. Before the first anonymous POST, the CLI persists a random UUID in `signup-anonymous-pending`, with private file permissions. It never sends a submission without a durable local ID.
2. The server uses a single atomic `HSETNX signup:anonymous <UUID> <record>`. The event write and deduplication are the same command. Concurrent replays cannot create a second field or rewrite the first timestamp.
3. A lost response or failed save keeps the same local ID for a later setup retry. A successful server acknowledgement writes `signup-asked` before removing the pending ID. If the marker cannot be written, the ID is retained.
4. A process-owned submission lock and marker re-check prevent overlapping setup processes from rotating the ID after another prompt has already completed. Only confirmed dead lock owners can be recovered.
5. An unreadable/corrupt pending ID is never replaced speculatively. Tracking fails safely while installation can still finish.

Existing per-IP/day rate limiting, salted daily IP hashes, bounded HTTP timeouts and failure reporting are retained. The API deliberately returns the same acknowledgement for a new event and an already stored retry.

## Deployment and validation

Deploy the backward-compatible site API and updated privacy page before releasing the CLI. An older API rejects the new anonymous request safely; the CLI retains the pending ID and does not claim that it was saved. This PR does not publish a CLI release.

Unit tests cover parsing, storage isolation, retries after lost acknowledgements/local-marker failures, concurrent requests, overlapping prompts, cancellation, opt-out, legacy clients, rate limits, failures and honest final messages. No test signups are written to the production database.
