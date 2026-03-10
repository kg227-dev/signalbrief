# SignalBrief — Feature Build Prompt for Claude Code

## Context

SignalBrief is a personalized daily news digest for strategy consultants. The tech stack is **Node.js stdlib only — zero npm dependencies**. The architecture is:

- `digest.js` — Main pipeline. Fetches news via Perplexity Sonar, enriches via Claude Haiku (`claude-haiku-4-5`), scores items, delivers via email + Telegram, archives results.
- `mailer.js` — Email delivery. Resend API preferred, Gmail OAuth fallback. All emails include `List-Unsubscribe` headers.
- `web/server.js` — HTTP server (port 3003). Raw `http.createServer`, no framework. Serves HTML pages + API endpoints.
- `store.js` — JSON file-based per-user store. Files at `data/user-{chatId}.json`. Functions: `readUser`, `writeUser`, `allUsers`, `generateToken`, `findUserByToken`.
- `reply-handler.js` — Telegram bot handler. Natural language intent parsing via Claude Haiku.
- `bot-server.js` — Telegram long-polling server (port 3002).
- `engagement-events.js` — Appends events to `data/engagement-events.jsonl`. Function: `appendEngagementEvent(payload)`.
- `templates/email.html` — HTML email template. Placeholders: `{{DATE}}`, `{{QUICK_SCAN}}`, `{{BASE_URL}}`, `{{USER_EMAIL}}`, `{{SETTINGS_TOKEN}}`, `{{PUBLIC_DIGEST_URL}}`, `{{WELCOME_BANNER}}`, `{{PERSONALIZATION_NOTE}}`, `{{ITEM_COUNT}}`, `{{SETTINGS_FOOTER}}`, `{{CURRENT_DIGEST_DATE}}`, `{{PUBLIC_DIGEST_URL_ENCODED}}`.
- `config.json` — API keys and user config (gitignored).

**Important things already built that you do NOT need to rebuild:**
- Welcome digest is already spawned immediately after signup (lines 1309–1315 in `web/server.js`)
- Public digest pages at `/digest/YYYY-MM-DD` already exist and are SEO-indexed
- `{{WELCOME_BANNER}}` and `{{PERSONALIZATION_NOTE}}` template slots already exist in the email template
- Engagement event logging infrastructure exists in `engagement-events.js`
- Unsubscribe flow (one-click and settings-page) already works

---

## Features to Build

Build these in priority order. **Read every file you plan to modify before writing a single line.** Plan before you code. Do not carry out large refactors; make surgical, targeted changes.

---

### Feature 1: Email Open Tracking

**Goal:** Know which users are opening digests. This data powers re-engagement (Feature 3) and the admin metrics dashboard.

**How:**

1. Add a `GET /t/:digestId/:token/o.gif` endpoint to `web/server.js`.
   - `digestId` is the existing digest ID format: `YYYY-MM-DD:chatId` (see `buildDigestId()` in `engagement-events.js`). URL-encode it as a single base64url or hyphen-separated param — pick whichever is cleanest, just document the encoding scheme.
   - `token` is the user's existing 64-char hex token (from `user.token` in the store).
   - On hit: look up user by token. If valid, call `appendEngagementEvent()` with `event_type: "email_open"`, `event_key: "open:{digestId}"`, `user_chat_id`, `user_email`, `digest_id`, `channel: "email"`. Then return a 1×1 transparent GIF (the 35-byte GIF constant — hardcode it). Set `Cache-Control: no-store, no-cache`.
   - Do not error loudly if token is invalid — just return the GIF silently.

2. In `mailer.js`, add a helper `buildOpenTrackingPixel(digestId, token, baseUrl)` that returns the `<img>` HTML tag for the tracking pixel. The URL must be absolute (using `baseUrl`).

3. In `digest.js`, after assembling the email HTML and just before `sendEmailViaMailer(...)`, inject the tracking pixel into the email body. The pixel should go at the very bottom of the `<body>`, before `</body>`. Do this with a simple string replace on the assembled HTML — do not modify the template file structure.

4. Store the latest open timestamp on the user object. When a `email_open` event fires, update `user.last_email_open_at` (ISO string) and increment `user.email_opens_total` (integer). Write the user back via `writeUser`.

5. Add `last_email_open_at` and `email_opens_total` to `defaultUser()` in `store.js` so new users have these fields initialized (`null` and `0` respectively).

**Do not** use any external pixel service. The 35-byte transparent GIF bytes are:
```js
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);
```

---

### Feature 2: Referral Tracking

**Goal:** Know when a new signup came from an existing reader forwarding the product. No rewards — just attribution and a thank-you email to the referrer.

**How:**

1. In `web/index.html`, when the signup form is submitted, read a `ref` query param from `window.location.search` and include it as `referral_token` in the JSON POST body to `/api/signup`.

2. In the `POST /api/signup` handler in `web/server.js`:
   - Accept `referral_token` from the request body.
   - If present, call `findUserByToken(referral_token)` to look up the referrer.
   - If a valid referrer is found, store `signup_referral_source: { chatId: referrer.chatId, email: referrer.email, ts: new Date().toISOString() }` on the new user object.
   - Call a new `sendReferralThankYou(referrerUser, newUser)` function in `mailer.js` (non-blocking `.catch()`).
   - Log: `[signup] referred by ${referrer.email}`.

3. In `mailer.js`, add `sendReferralThankYou(referrerUser, newUser)`:
   - Subject: `Your recommendation just brought someone in`
   - Plain but styled HTML body (same inline-CSS pattern as existing emails). Content:
     > Hey [referrer first name],
     >
     > Just wanted to let you know — [new user first name] just signed up for SignalBrief using your referral link. They'll get their first digest this morning.
     >
     > Thanks for sharing it. The only way this grows is word of mouth from people like you.
     >
     > — Kush
   - Use Resend if available, Gmail OAuth fallback (same pattern as `sendWelcomeEmail`).

4. In `web/server.js`, on the `GET /api/admin/stats` endpoint (or a new `GET /api/admin/referrals`), include a `referrals` array in the response: list of `{ referrerEmail, newUserEmail, ts }` by scanning all users for `signup_referral_source`. This makes referral activity visible in the admin dashboard.

5. Update the share buttons in `templates/email.html`: append `?ref={{SETTINGS_TOKEN}}` to the signup URL in the "Get your own personalized brief" button in the public digest page (`renderPublicDigestPage` function in `web/server.js`), and in the "Forward to a colleague" mailto link body in the email template. This means every share naturally carries the referrer's token.

---

### Feature 3: Re-engagement & Auto-Pause System

**Goal:** Automatically email non-openers before they go fully cold. Pause them cleanly if they stay dark. Protect Resend sender reputation.

**Architecture decision:** Build this as a standalone script at `src/jobs/reengagement-runtime.js`, run by a new LaunchAgent plist. It should be safe to run multiple times per day — it must be idempotent (don't send the same email twice). Use a simple `reengagement_state` object on the user record to track what's been sent.

**Schema addition to `store.js` `defaultUser()`:**
```js
reengagement_state: {
  day4_sent_at: null,   // ISO string or null
  day8_sent_at: null,
  auto_paused_at: null,
  reactivated_at: null,
}
```

**Logic in `src/jobs/reengagement-runtime.js`:**

Read all users where `status === "active"` and `preferences.email_enabled === true`. For each user:

1. Compute `daysSinceLastOpen`: use `last_email_open_at` if set, else fall back to `last_digest_at`, else `joined_at`.
2. Compute `daysSinceJoined`: days since `joined_at`.
3. Skip users who joined less than 3 days ago (too early to re-engage).
4. Skip users with `digests_received < 2` (haven't received enough digests to judge).

**Day 4 email** (subject: `Your SignalBrief is still running — want to adjust anything?`):
- Condition: `daysSinceLastOpen >= 4` AND `reengagement_state.day4_sent_at === null`
- Send the re-engagement email (see body below).
- Set `reengagement_state.day4_sent_at = new Date().toISOString()` and write user.
- Log: `[reengagement] day4 email sent to ${user.email}`.

**Day 8 email** (subject: `Should I pause your SignalBrief?`):
- Condition: `daysSinceLastOpen >= 8` AND `reengagement_state.day4_sent_at !== null` AND `reengagement_state.day8_sent_at === null`
- Send the pause-warning email (see body below).
- Set `reengagement_state.day8_sent_at = new Date().toISOString()`.
- Log: `[reengagement] day8 email sent to ${user.email}`.

**Auto-pause** (day 11):
- Condition: `daysSinceLastOpen >= 11` AND `reengagement_state.day8_sent_at !== null` AND `reengagement_state.auto_paused_at === null`
- Set `user.status = "paused"`.
- Set `reengagement_state.auto_paused_at = new Date().toISOString()`.
- Send the auto-pause confirmation email (see body below).
- Log: `[reengagement] auto-paused ${user.email}`.

**Reset reengagement state when a user opens an email:** In the `/t/` tracking pixel endpoint (Feature 1), after logging the open event, also reset `user.reengagement_state` to all-null values (except preserve `auto_paused_at` if they were paused — a reactivation is a separate action).

**Email bodies** — All three use the same inline-CSS style as existing emails in `mailer.js`. Keep them short and human.

*Day 4 — "still running" email:*
> Hi [first name],
>
> I noticed you haven't opened SignalBrief in a few days. No judgment — inboxes are brutal.
>
> A few things that might help:
>
> **Wrong topics?** You're currently getting [comma-joined topic list]. Update them in 30 seconds: [settings link]
>
> **Wrong time?** Your digest arrives at [delivery time, formatted as "7:00 AM ET"]. Too early, too late? Change it: [settings link]
>
> **Too much text?** Switch to headline-only depth for a faster scan: [settings link]
>
> Or just reply here and tell me what's not working. I read every reply.
>
> — Kush

*Day 8 — "should I pause" email:*
> Hi [first name],
>
> You haven't opened SignalBrief in about a week. I don't want to fill your inbox if it's not useful.
>
> **Keep it going:** [link to /api/reactivate?token=...] — I'll keep sending as normal.
>
> **Pause it:** [link to /api/pause?token=...] — I'll stop for now. You can restart anytime from your settings.
>
> No wrong answer. If the timing or topics aren't right, I'd rather pause than become noise.
>
> — Kush

*Auto-pause confirmation:*
> Hi [first name],
>
> We've paused your SignalBrief digest to keep your inbox clean — you hadn't opened it in a while and I didn't want to keep sending.
>
> To restart, it takes one click: [reactivate link]
>
> Your topics and settings are all saved — you'll pick up right where you left off.
>
> — Kush

**New endpoints needed in `web/server.js`:**

- `GET /api/pause?token=:token` — Set `user.status = "paused"`, `user.preferences.email_enabled = false`. Redirect to `/settings?token=:token&paused=1`.
- `GET /api/reactivate?token=:token` — Set `user.status = "active"`, `user.preferences.email_enabled = true`. Reset `reengagement_state` to all-null. Redirect to `/settings?token=:token&reactivated=1`. Show a small confirmation banner on the settings page for these states (check `?paused=1` and `?reactivated=1` params).

**LaunchAgent for `src/jobs/reengagement-runtime.js`:** Create `com.jarvis.signalbrief-reengagement.plist` in the same style as the existing plists. Run daily at 8:00 AM ET (after digests have been sent). Document this in CLAUDE.md.

---

### Feature 4: Editorial One-Liner in Email Subject & Preview

**Goal:** Make every email subject line feel like an editorial signal, not a generic "your daily digest." Also add a one-line editorial hook to the email body visible in the Gmail preview pane.

**Part A — Subject line:**

In `digest.js`, when building the email for a user, generate the subject line dynamically instead of using a static string. Use the lead story (item ranked #1 after personalization sort) to build the subject.

Use this Claude Haiku prompt (keep it cheap — max 60 output tokens):
```
Given this news headline and "why it matters" analysis, write a single email subject line (max 65 characters) for a daily briefing aimed at strategy consultants. The subject should hint at the strategic implication without being clickbait. No emoji. No "SignalBrief" in the subject.

Headline: {headline}
Why it matters: {wim}

Reply with ONLY the subject line, no quotes, no explanation.
```

Cache nothing — generate fresh per user per digest. This costs ~$0.0001 per email at Haiku rates.

Fallback: if the Haiku call fails or returns garbage (>100 chars, contains newlines, etc.), use: `"Your signals for {day}, {date}"` — e.g. `"Your signals for Tuesday, March 11"`.

**Part B — Editorial note in email body:**

1. Add a `{{EDITORIAL_NOTE}}` placeholder to `templates/email.html`, positioned between the header block and the `{{QUICK_SCAN}}` section. Style it as a single line of italic text in a light gray bar:
   ```html
   {{EDITORIAL_NOTE}}
   ```
   When populated, render as:
   ```html
   <div style="padding:10px 40px;background:#F0F4FF;border-bottom:1px solid #E5E7EB;">
     <p style="margin:0;font-size:13px;color:#4B5563;font-style:italic;">{{EDITORIAL_NOTE_TEXT}}</p>
   </div>
   ```
   When empty (pass `""` or a blank string), render nothing (don't show the gray bar).

2. In `digest.js`, generate this note using a second Haiku call (max 40 output tokens):
   ```
   Write a single editorial sentence (max 120 characters) for a strategy professional's morning briefing. It should flag the most important cross-sector or non-obvious pattern across today's {N} stories. Be specific. Name a sector or player. No hedging. No "today's digest" language.

   Stories: {comma-separated list of tags and headlines}

   Reply with ONLY the sentence, no quotes.
   ```
   Fallback: leave the field empty (don't render the bar) if Haiku fails.

---

### Feature 5: Admin Dashboard — Engagement Metrics Card

**Goal:** The admin dashboard at `/admin` already shows cost cards, run history, per-user costs, and user roster. Add a new "Engagement" section so you can see open rates and re-engagement health at a glance.

**Add to `GET /api/admin/stats` response:**

```json
{
  "engagement": {
    "total_active": 42,
    "total_paused": 3,
    "total_unsubscribed": 1,
    "open_rate_7d": 0.51,
    "open_rate_30d": 0.48,
    "in_reengagement_day4": 2,
    "in_reengagement_day8": 1,
    "auto_paused_last_30d": 2,
    "referral_signups_total": 5
  }
}
```

To compute `open_rate_7d`: scan `engagement-events.jsonl` for `event_type: "email_open"` events in the last 7 days. Divide by digests sent (from `cost-log.json` entries in the same window, or use `digests_received` delta across all users). Use whichever is simpler — document your approach.

**In `web/admin.html`:** Add a new card row titled "Engagement" with 4 metric tiles:
- 7-day open rate (shown as percentage, blue if ≥45%, yellow if 30–45%, red if <30%)
- Active / Paused / Unsubscribed subscriber counts
- Users in re-engagement pipeline (day4 + day8 combined)
- Total referral signups

Use the same card/tile styling already established in `admin.html`. No new CSS frameworks.

---

## Code Quality Requirements

- **Zero new npm dependencies.** Everything must use Node.js built-ins (`https`, `http`, `fs`, `path`, `crypto`, `child_process`). If you feel you need a library, find a way without it.
- **Idempotency on all scheduled jobs.** `src/jobs/reengagement-runtime.js` must be safe to run multiple times without double-sending emails. Use the state fields on the user record as the source of truth.
- **Error handling.** Never let a failed re-engagement email or tracking pixel crash the main server. All lifecycle email sends should be non-blocking `.catch(e => console.error(...))`.
- **No breaking changes to existing behavior.** The digest pipeline, signup flow, and Telegram handler should continue to work exactly as before.
- **Log everything.** Use the same `console.log` format as the rest of the codebase: `[module] message`. For `src/jobs/reengagement-runtime.js`, write to `/tmp/signalbrief-reengagement.log` using the same `appendFileSync` pattern as `LOG_FILE` in `digest.js`.
- **Update `CLAUDE.md`** after completing all features: add `src/jobs/reengagement-runtime.js` to the Key files section, add the new LaunchAgent label, and document the new user store fields (`last_email_open_at`, `email_opens_total`, `reengagement_state`, `signup_referral_source`).

## Testing Checklist

After building, verify:

- [ ] A new signup triggers a welcome digest AND a welcome email
- [ ] Navigating to `/t/[digestId]/[token]/o.gif` returns a 1×1 GIF and updates `last_email_open_at` on the user record
- [ ] Navigating to `/` with `?ref=[valid_token]` and completing signup sends a thank-you email to the referrer and stores `signup_referral_source` on the new user
- [ ] Running `node src/jobs/reengagement-runtime.js` against a user with `last_email_open_at` 5 days ago sends the day4 email and sets `reengagement_state.day4_sent_at`
- [ ] Running `node src/jobs/reengagement-runtime.js` again immediately does NOT re-send the day4 email (idempotency)
- [ ] A user with 11 days of no opens gets auto-paused and receives the pause confirmation email
- [ ] `/api/reactivate?token=:token` sets the user back to active and resets reengagement state
- [ ] `/api/pause?token=:token` sets the user to paused
- [ ] The email subject line is generated dynamically from the lead story
- [ ] The editorial one-liner bar appears in the email (and is absent when Haiku fails gracefully)
- [ ] The admin `/api/admin/stats` response includes the `engagement` object
- [ ] `node -e "require('./store').allUsers().forEach(u => console.log(u.reengagement_state))"` outputs valid objects for all users (including old users who don't have the field — `defaultUser` merge should handle this)
