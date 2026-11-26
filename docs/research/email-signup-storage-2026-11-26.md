# Optional email signup: storage options

Researched November 26, 2026. This document proposes the implementation; no signup endpoint, provider account or email collection is enabled by this PR.

## Decision and recommendation

Keep school selection and login as they are. Finish client setup and enabled video/tool/model downloads, show the final setup outcome, then ask:

> Enter your email to stay up to date (or N/A):

**Update (implemented):** store signups in the existing Upstash Redis behind `site/api/signup.js`, under its own `signup:*` keys, and import them into **Kit's free plan** (10,000 subscribers, no send limit, subscriber API on Free) when the first update is sent. This costs nothing and needs no new account. Brevo was dropped as the first choice because its free plan sends at most 300 emails a day with no rollover. Resend's free marketing plan caps contacts at 1,000.

The prompt is skipped for Ontario K-12 board presets (students may be minors), in non-interactive runs, with `--yes`, and after it has been answered once on a computer. Each record keeps the email, timestamp, consent-wording id, source and app version, which is the consent proof CASL expects. The disclosure lives at `site/privacy.html`.

Before the prompt ships: set `SIGNUP_SALT` in Vercel, add a mailing address and private contact to the privacy page, and export `signup:emails` regularly (free Upstash databases can be archived after 30 inactive days; the setup counters keep it active while installs happen).

The original analysis follows.

## Compared options

Published free allowances checked against official sources. These are service limits, not uptime guarantees; account approval, regional terms and future pricing can change.

| Option | Published free allowance | What we would build / practical trade-off |
| --- | --- | --- |
| **Brevo** | 100,000 stored contacts; 300 email sends/day | Best fit for a large stored list and occasional updates. Includes a campaign dashboard; supports contact exports and a double-opt-in API. Daily send cap is the main drawback. |
| **Resend Marketing** | Marketing product advertises up to 1,000 contacts at $0/month | Strong alternative for developer-oriented email and broadcasts; built-in unsubscribe handling and CSV exports. Smaller advertised free list. Verify the marketing account's sending allowance before launch: the separate transactional 3,000/month and 100/day allowance must not be assumed to apply to broadcasts. |
| **Existing Upstash Redis** | Pricing card/FAQ: 250 MB, 500,000 commands/month, 10 GB bandwidth, one free database | Least infrastructure change for storage alone. We build contact management, deduplication, exports, consent state, unsubscribe synchronization and email integration. Free inactivity archival makes it less suitable as an unattended permanent contact store. |
| **Cloudflare D1** | 5 GB total storage; 5 million rows read/day; 100,000 rows written/day | Best database alternative if we want SQL ownership and queries. Unique email constraints and signup history are straightforward. Still requires an email provider and a new database integration. Worker request limits also apply if using a Worker endpoint. |
| **Google Sheets API** | No additional API usage charge; 300 writes/minute/project and 60/minute/user/project | Easy to view and export. Needs a private server-side integration; deduplication and concurrent append behavior require care. Useful as a reporting/export destination rather than the main subscription system. |
| **MailerLite** | Current pricing lists 250 subscribers and 2,500 emails/month | Usable campaign UI, but the published free subscriber cap is small for a multi-school launch. Older articles advertising 1,000 subscribers/12,000 sends are not the current pricing page. |

Sources: [Brevo plans](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [Resend marketing](https://resend.com/products/marketing-emails), [Resend pricing](https://resend.com/pricing), [Upstash pricing](https://upstash.com/pricing/redis), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Sheets quotas](https://developers.google.com/workspace/sheets/api/limits), [MailerLite pricing](https://www.mailerlite.com/pricing).

## Important reliability findings

**Brevo's storage limit does not mean free unlimited newsletters.** A campaign to 1,000 recipients takes at least four daily sending windows at 300/day, assuming no other sends consume quota. Brevo says the remaining campaign recipients need manual requeueing. Free emails include provider branding; only one marketing user is included. Paid capacity becomes relevant before contact storage fills. [Free-plan details](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

**Upstash is persistent, but free availability has limits.** Writes persist to disk; it is not merely an ephemeral cache. Its FAQ says free databases are archived after a minimum of 30 inactive days with warnings and a restorable backup. Its terms reserve broader deletion rights after one inactive week for free resources. Do not promise that a quiet free database endpoint will always remain available. The pricing page also says 250 MB in its plan card/FAQ and 256 MB in the comparison table; budget against the smaller number. [Durability](https://upstash.com/docs/redis/features/durability), [FAQ](https://upstash.com/docs/redis/help/faq), [terms](https://upstash.com/trust/terms).

**D1 stops free queries at quota exhaustion.** It has a generous allowance for a signup list, but we must return a signup failure if writes are rejected. It supplies a database rather than a subscription dashboard. [Quota behavior](https://developers.cloudflare.com/d1/platform/pricing/).

**Exports matter whichever provider we select.** Brevo and Resend both support CSV contact exports. Preserve subscription/suppression state when exporting or migrating; a raw email-only list can accidentally lose unsubscribe information. Periodic private exports provide a recovery path but are not permission to restart unsubscribed contacts. [Brevo export](https://help.brevo.com/hc/en-us/articles/5310065850642-Export-your-contacts-from-Brevo), [Resend exports](https://resend.com/changelog/exports-general-availability), [Resend unsubscribe handling](https://resend.com/features/audiences), [Brevo unsubscribe state](https://help.brevo.com/hc/en-us/articles/9787985972498-View-your-unsubscribed-contacts).

## Proposed implementation

1. Preserve the existing school picker and course authentication. Newsletter email has no effect on the selected school or portal. Allow any valid contact address.
2. Await all enabled downloads before the final setup outcome. Downloads can be skipped or fail independently; report their actual status. Do not claim video readiness if preparation failed. Only offer signup after the setup reaches its successful completion path.
3. Present concise purpose/sender/privacy information beside the exact requested prompt. Accept case-insensitive N/A, blank input and cancellation as skip. In noninteractive runs, skip the prompt; `--yes` must not subscribe anyone automatically.
4. Submit an HTTPS request to a dedicated site endpoint, e.g. `/api/signup`. Keep the Brevo API key exclusively in server environment variables, never the CLI, binary, repository or public JavaScript. Bound the request size, validate address syntax, rate-limit requests and repeated confirmation attempts. A public CLI cannot safely contain a shared secret to authenticate arbitrary signups.
5. Retain the chosen address, request timestamp, source (`cli-setup`), consent wording version and subscription status. School/app version are optional metadata only if disclosed; no need to collect a second school address or infer school from email. Never copy course data, auth cookies or Brightspace tokens into the contact list.
6. Deduplicate without silently reversing unsubscribes. Retrying a request should not create duplicates or trigger repeated confirmation mail. Reinstalling does not imply renewed consent. Do not treat client-supplied `verified` or `subscribed` fields as trustworthy.
7. Prefer a confirmation email before enabling broadcasts. Brevo provides a DOI endpoint requiring a configured list, template and redirect URL. Confirm provider behavior for duplicates, expired requests, quotas and suppressed contacts in a test account before launch. Only say “Check your inbox to confirm” after the provider accepts the request; never say “Subscribed” before confirmation. If retaining pending requests separately for recovery, expire unconfirmed records and keep them out of campaigns. [DOI API](https://developers.brevo.com/reference/create-doi-contact), [contact API](https://developers.brevo.com/reference/create-contact).
8. Network, quota or provider failure must not turn a completed install into a failed install. Clearly say the email was not saved/accepted and offer a retry or hosted signup link. Use a bounded timeout; do not silently discard an entered address or claim success on HTTP failure. A durable outbox can be added if guaranteed eventual delivery becomes a requirement; an unacknowledged CLI request cannot guarantee storage during an outage.

Canadian commercial email guidance calls for consent, sender identification and unsubscribe handling. Record the disclosed product-updates purpose; do not expand it into unrelated promotions. The existing institution-domain research covers school-age users, so the age-appropriate consent design remains relevant before launch. [CRTC guidance](https://crtc.gc.ca/eng/com500/faq500.htm).

## Configuration needed to make this real

Create the chosen provider account, verify the sender/domain, configure its updates list and confirmation template/redirect, add server-only credentials, and publish the consent/privacy and unsubscribe information. Then exercise a test signup through the CLI and verify it appears in the dashboard with the expected pending/confirmed state. Test skips, cancellation, duplicates, reinstalls, provider outages, quota errors and unsubscribe behavior. No account was created and no email was sent during this research.

Do not ship a live prompt before this end-to-end path exists. The current PR retains normal school selection and adds research only for this email feature.
