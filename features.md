# MVP Priority List

Last updated: 2026-03-01

---

## User Workflow Map

```
WEB ONBOARDING:
  Visit / → Hero → "Get started" → 4-step form (details, topics, depth, schedule)
  → POST /api/signup → user JSON created → welcome email sent → first digest spawned
  → Success card shown (with broken "Manage preferences" link — see P0-1)

TELEGRAM ONBOARDING:
  /start (no email) → AWAITING_EMAIL state → user sends email
    → If existing web signup: links chatId, confirms
    → If new: creates account with defaults, sends welcome email, spawns first digest
  /start email@example.com → looks up email
    → If found: links chatId → If NOT found: rejects (see P1-6 inconsistency)

DAILY DIGEST PIPELINE (6:45 AM ET Mon–Sat):
  Determine due users → Fetch news via Perplexity (per CONFIG.topics)
  → Select top items (dedup + interleave) → Enrich via Claude Haiku (WIM + baseScore)
  → Per-user loop: filter by topics → relevance score (60% base + 40% topic match)
  → Sort + trim to user's items_per_digest → Apply depth mode
  → Deliver via Telegram + Email → Archive → Log costs

SETTINGS:
  Welcome email → /settings?token=TOKEN → load user → edit preferences → save
  Email footer → /settings?token=TOKEN#unsub → scroll to unsubscribe section

TELEGRAM COMMANDS:
  save 1,3 | more/less [topic] | add [topic] | /digest | /settings | /bookmarks | /help
  Free-text questions → Claude Haiku answer

UNSUBSCRIBE:
  Email one-click (RFC 8058) → POST /api/unsubscribe?token=TOKEN
  Email footer link → /settings?token=TOKEN#unsub → click Unsubscribe → POST /api/settings {status: "unsubscribed"}
  GET /api/unsubscribe?email=EMAIL → sets status, redirects to settings
```

---

## P0: Ship-Blocking Bugs

### P0-1: "Manage preferences" link broken for remote users
After web signup, the success card links to `/settings?email=USER_EMAIL`. This hits `/api/admin/user-by-email` which is IP-restricted to localhost. Any user on getsignalbrief.com gets a 403, falls through to "request a magic link" screen. **Every new web signup hits this immediately.**
- Complexity: **Small**
- Fix: Return the user's token in the `/api/signup` response. Change the success card link to `/settings?token=TOKEN`. (`web/index.html:676`, `web/server.js:210-214`)

### P0-2: Admin dashboard exposes all user PII publicly
`/admin` and `/api/admin/stats` have zero authentication. Anyone visiting `getsignalbrief.com/admin` sees every user's email, name, topics, join date, digest history, and settings URL. Full PII exposure.
- Complexity: **Small**
- Fix: Add email-based bypass auth to `/api/admin/stats` matching the existing pattern in the admin user-by-email endpoint. Quick option: require `?email=ADMIN_EMAIL` param and validate against a config allowlist, same pattern as the recent admin bypass commit (`05af971`). (`web/server.js:349-425`)

### P0-3: XSS vulnerabilities in admin and archive pages
Both `admin.html` and `archive.html` inject user-controlled data (names, emails, topics) and Perplexity-sourced content via `innerHTML` with zero escaping. A malicious signup name like `<img src=x onerror=alert(1)>` executes JS on the admin page.
- Complexity: **Small**
- Fix: Add a `escapeHtml()` utility and use it on all user-controlled values before innerHTML injection. Alternatively, use `textContent` for plain-text fields. (`web/admin.html:232-321`, `web/archive.html:206-247`)

### P0-4: Unsubscribe endpoint allows unauthenticated email-based unsubscribe
`GET /api/unsubscribe?email=anyone@example.com` unsubscribes any user with no token or confirmation. Anyone knowing a user's email can unsubscribe them.
- Complexity: **Small**
- Fix: Require token for GET unsubscribe. Keep email-only path for POST (RFC 8058 one-click from email clients, which is standard). (`web/server.js:252-278`)

### P0-5: Digest email token not passed to mailer — List-Unsubscribe uses email instead of token
`digest.js:664` calls `sendEmail(subject, html, email, token)` with 4 args, but the local wrapper at line 476 only accepts 3 and silently drops the token. All digest emails get email-based unsubscribe headers instead of secure token-based ones.
- Complexity: **Small**
- Fix: Update the local `sendEmail` wrapper in digest.js to accept and forward the 4th `token` parameter to the mailer. (`digest.js:476-482`)

### P0-6: Shallow merge in store.js loses nested preference defaults
`readUser()` does `{ ...defaultUser(chatId), ...raw }` which replaces the entire `preferences` object if even one preference key was stored. Users created via Telegram (which sets only `delivery_time`) lose `email_enabled`, `telegram_enabled`, and `timezone` defaults.
- Complexity: **Small**
- Fix: Deep-merge the preferences object: `preferences: { ...defaultUser(chatId).preferences, ...(raw.preferences || {}) }`. (`store.js:51`)

---

## P1: MVP Features

### P1-1: Admin cron job / system health visibility
Admins have no way to see if the digest LaunchAgent is loaded, when the next run is, whether bot-server/web-server are alive, or Telegram polling status. Requires SSH today.
- Complexity: **Medium**
- Build: Add a `/api/admin/health` endpoint that checks: (a) last digest run timestamp from cost-log, (b) process uptime, (c) last Telegram poll timestamp (expose from bot-server). Surface in admin.html as a "System Status" card with green/yellow/red indicators.

### P1-2: Archive only saves first user's personalized items
`saveToArchive()` skips writing if the file exists. In multi-user runs, only the first user's filtered/sorted items get archived. All other users' archives silently fail.
- Complexity: **Small**
- Build: Save a canonical (unfiltered, full enriched) archive for the day, not a per-user filtered version. Move archive save before the per-user loop. (`digest.js:681, 492`)

### P1-3: No HTTP timeout on Perplexity/Claude API calls
`httpsPost()` has no timeout. A hung API call blocks the entire digest pipeline indefinitely. No recovery path.
- Complexity: **Small**
- Build: Add `req.setTimeout(30000, () => { req.destroy(); reject(...) })` to `httpsPost()`. (`digest.js:60-78`)

### P1-4: Custom topic slug format inconsistency between onboarding and settings
Onboarding slugifies custom topics with `custom_` prefix (e.g., `custom_glp_1`). Settings page stores them as raw text (e.g., `GLP-1`). They never match during dedup, causing duplicates.
- Complexity: **Small**
- Build: Apply the same `custom_` + slugify logic in `settings.js` that `index.html` uses. (`web/settings.js:249-257`, `web/index.html:530`)

### P1-5: `allUsers()` returns raw data without defaults — crashes possible
`allUsers()` in store.js returns raw parsed JSON without merging defaults. Missing `preferences`, `topics`, or `digests_received` fields can throw in digest.js when accessing `u.preferences.days_of_week` or `u.topics.length`.
- Complexity: **Small**
- Build: Have `allUsers()` call `readUser()` for each file (which merges defaults) instead of raw JSON.parse. (`store.js:65-73`)

### P1-6: Telegram `/start email@new.com` rejects unknown emails — inconsistent with flow
`/start email@example.com` with an unregistered email says "not signed up yet" and directs to the website. But `/start` → email reply happily creates a new account. Penalizes users who helpfully include their email upfront.
- Complexity: **Small**
- Build: When email is unregistered in `handleStart()`, create the account the same way `handleEmailCapture()` does instead of rejecting. (`reply-handler.js:189`)

### P1-7: AWAITING_EMAIL state never cleared after `/start email@example.com`
If user sends `/start` (enters AWAITING_EMAIL), then `/start email@example.com` (successfully links), the AWAITING_EMAIL entry persists. Their next non-command message goes to `handleEmailCapture()` instead of intent parsing.
- Complexity: **Small**
- Build: Add `AWAITING_EMAIL.delete(chatId)` at the top of `handleStart()`. (`reply-handler.js:177`)

### P1-8: No rate limiting on Telegram `/digest` command
Users can spam `/digest` to trigger unlimited child processes, each calling Perplexity + Claude APIs. No throttle.
- Complexity: **Small**
- Build: Add a per-chatId cooldown map (e.g., 15-minute minimum between `/digest` calls). (`reply-handler.js:140-175`)

### P1-9: Unsubscribe via settings doesn't set `email_unsubscribed_at`
Unsubscribing via settings page sends `POST /api/settings {status: "unsubscribed"}` which updates status but skips the `email_unsubscribed_at` timestamp that `/api/unsubscribe` sets. Inconsistent data for admin tracking.
- Complexity: **Small**
- Build: In the settings POST handler, detect when status changes to "unsubscribed" and set `email_unsubscribed_at`. (`web/server.js:225-249`)

### P1-10: Email template CSS stripped by major email clients
The digest email template uses `<style>` block CSS classes for structural layout. Gmail, Yahoo Mail, and Outlook web strip `<style>` tags entirely, breaking the header, quick-scan, and footer layout. Item content (which uses inline styles) renders fine.
- Complexity: **Medium**
- Build: Convert all CSS class styles to inline styles on the structural elements (header, quick-scan container, footer). Keep the existing inline styles on items.

### P1-11: Admin per-user cost calculation is wrong
The per-user rollup attributes the entire run's `total_cost_usd` to each user served in that run. A run serving 3 users triples the apparent cost. Inflates per-user cost display.
- Complexity: **Small**
- Build: Divide `total_cost_usd` by the number of users served in each run when accumulating per-user costs. (`web/server.js:368-375`)

### P1-12: No request body size limit
`readBody()` accumulates the full request body with no cap. A malicious client can send gigabytes and exhaust server memory.
- Complexity: **Small**
- Build: Add a byte counter in the `readBody` data handler; reject with 413 if body exceeds 1MB. (`web/server.js:101-107`)

---

## P2: Post-Launch

### P2-1: Custom topics don't generate Perplexity queries
Custom topics are stored and used for keyword matching against existing results, but no dedicated Perplexity search query is generated. A custom topic only surfaces articles if they happen to appear in standard topic results.
- Complexity: **Large**
- Note: Requires aggregating custom topics across all due users, generating search queries, and merging results into the pipeline.

### P2-2: Deep mode not fully implemented
Deep mode is supposed to provide extended WIM + implications + watch-next. The email template renders implications/watch_next for deep users, but the Claude enrichment prompt always generates the same 2-3 sentence WIM regardless of depth. Telegram doesn't render implications/watch_next at all.
- Complexity: **Medium**

### P2-3: Admin user management actions
Roster is read-only. No ability to pause/unpause users, resend welcome emails, reset tokens, delete users, or send test digests.
- Complexity: **Large**

### P2-4: Admin manual digest trigger
No "Run digest now" button. On-demand digests can only be triggered via Telegram `/digest` or CLI.
- Complexity: **Medium**

### P2-5: Archive not linked from onboarding success card or Telegram /start
Email footer and welcome email link to /archive, but the post-signup success card and bot welcome message don't mention it. (Known issue #1)
- Complexity: **Small**

### P2-6: AWAITING_EMAIL — full message treated as email address
If a user in AWAITING_EMAIL state sends "my email is john@example.com", the entire string is tested as an email, which fails. The system should extract the email from prose.
- Complexity: **Small**

### P2-7: `headline_plus_oneliner` depth splits on `.` — breaks on abbreviations
The oneliner depth mode splits WIM on `.` to get the first sentence. Abbreviations like "U.S." or numbers like "$4.5B" cause premature splits.
- Complexity: **Small**

### P2-8: Bookmark save doesn't validate item numbers
"save 99" on a 7-item digest creates a bookmark with headline "Item 99" and null URL. Should bounds-check against actual digest size.
- Complexity: **Small**

### P2-9: No client-side timeout on Telegram long-polling
`poll()` in bot-server.js has no `req.setTimeout()`. If Telegram hangs beyond 30s, the Node request hangs indefinitely.
- Complexity: **Small**

### P2-10: `edited_message` processing causes double-handling
Bot processes both `message` and `edited_message`. Editing a Telegram message re-triggers the handler, which can cause duplicate saves, double account creation, etc.
- Complexity: **Small**

### P2-11: Topic weight drift — no bounds
`more`/`less` topic commands increment/decrement weights without any cap. Spamming "more AI" sets weight to +100 with no normalization.
- Complexity: **Small**

### P2-12: BASE_URL default inconsistency
`web/server.js` defaults to `http://localhost:3003`, while `mailer.js` and `digest.js` default to `https://getsignalbrief.com`. Running server.js locally without env var generates localhost links in emails.
- Complexity: **Small**

### P2-13: Settings page footer says "Built with OpenClaw"
Placeholder/template leftover in `web/settings.html:227`.
- Complexity: **Small**

### P2-14: Settings page select dropdowns lack visual arrow
`settings.html` loads `style.css` which sets `appearance: none` on selects but doesn't add a custom dropdown arrow (unlike `index.html` which does).
- Complexity: **Small**

### P2-15: Error message not cleared on successful save in settings
`showError()` sets `display: block` on the error element but it's never cleared on a subsequent successful save. Error persists alongside success banner.
- Complexity: **Small**

---

## Dependencies & Notes

### Blocking chains
- **P0-1 blocks all web-to-settings flows.** Until the success card link is fixed, no web signup user can reach their settings without requesting a magic link email — which they may not realize they need to do.
- **P0-6 blocks reliable delivery preferences.** If nested preferences aren't merged correctly, Telegram-onboarded users may have undefined `email_enabled`/`timezone` values, causing unpredictable delivery behavior.
- **P1-5 blocks pipeline stability.** `allUsers()` returning raw data without defaults means any user with a missing field can crash the entire digest run for all users.

### Tech debt flags
- **File-based store (store.js):** No file locking means concurrent writes from digest.js and bot-server.js can overwrite each other. Acceptable at <20 users, but SQLite migration should happen soon after launch.
- **`allUsers()` is O(n) disk reads per request:** Called on every token lookup, settings save, and admin load. Fine for now, but will need indexing (or SQLite) at scale.
- **CORS `Access-Control-Allow-Origin: *`:** All API responses allow cross-origin requests. Not exploitable today (tokens act as auth), but should be tightened post-launch.
- **No CSRF protection:** POST endpoints accept requests from any origin. Mitigated by token-in-body auth pattern, but worth adding origin validation.
- **Cost logging format (JSONL):** Works but fragile — any reader must parse line-by-line, not `JSON.parse()`.

### Realistic 2-day scope
**Day 1:** P0-1 through P0-6 (all small, all critical). These are the bugs that will embarrass you on launch day.
**Day 2:** P1-1 (admin health), P1-2 (archive fix), P1-3 (API timeout), P1-5 (allUsers defaults), P1-11 (cost calc), P1-12 (body size limit). High-impact, all small.
**Stretch:** P1-4, P1-6, P1-7, P1-8, P1-9, P1-10 — all small but lower urgency.
**Cut for post-launch:** Everything in P2. Custom topics and deep mode are real features but not launch-blocking.
