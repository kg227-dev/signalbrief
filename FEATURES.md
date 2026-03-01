# SignalBrief — Feature Backlog

> Ordered by impact/effort. Each item has enough spec to build without follow-up questions.

---

## 🔴 High Priority

### 1. Relevance Scoring + Ordering
**What:** Replace static item order (and ★ LEAD badge) with a per-user relevance score. Items are sorted highest-to-lowest before delivery. Score is not displayed.

**How it works:**
- Claude scores each enriched item 1–10 across three dimensions:
  1. **Topic match** — how directly does this item cover the user's selected topics?
  2. **Market impact** — how significant is this development (deal size, policy weight, breadth of affected firms)?
  3. **Consultant relevance** — how actionable is this for a strategy consultant right now?
- Composite score = weighted average (topic match 40%, market impact 35%, consultant relevance 25%)
- Items sorted by composite score descending before formatting
- ★ LEAD badge removed entirely — item 1 is just item 1
- Scores computed per-user during delivery fan-out (in digest.js)

**Where to build:** `digest.js` — add `scoreItem(item, userTopics)` function called during per-user delivery; sort `userItems` before building Telegram/email

**Prompting:** Single Claude call with all items + user topics → JSON array of `{id, score, rationale}`

**Edge cases:**
- Items without enough info: default to 5.0
- All items same score: preserve original fetch order
- Scoring API failure: fall back to original order silently

**Status:** 🔲 Not started

---

### 2. Email Verification (Double Opt-In)
**What:** After signup, set user status to `pending` and send a "Confirm your email" email. User becomes `active` only after clicking the confirmation link. This prevents fake/mistyped emails, reduces spam complaints, and protects Resend sender reputation.

**How it works:**
- On `/api/signup`: create user with `status: "pending"`, generate `confirmToken` (random 32-char hex), store on user object
- Send confirmation email with link: `{BASE_URL}/confirm?token={confirmToken}&email={email}`
- `GET /confirm`: find user by token, set `status: "active"`, delete `confirmToken`, redirect to `/confirmed.html`
- Digest delivery already filters `status === "active"` — no other changes needed
- Welcome email changes: hero copy becomes "One more step — confirm your email" with a big CTA button

**New files:** `templates/confirm.html` (confirmation email), `web/confirmed.html` (post-confirm success page)

**New endpoint:** `GET /confirm?token=...&email=...`

**Token expiry:** 72 hours. Resend endpoint: `POST /api/resend-confirm?email=...`

**Status:** 🔲 Not started

---

### 3. Production URL Configuration
**What:** Replace all hardcoded `http://localhost:3003` URLs in email templates and server code with the real production domain.

**What to change:**
- `templates/email.html` footer links (`/archive`, `/settings?email=`)
- `templates/welcome.html` archive link
- `web/server.js` `BASE_URL` — already reads `process.env.BASE_URL`, just needs the env var set
- LaunchAgent plists: add `EnvironmentVariables` key with `BASE_URL = https://getsignalbrief.com`

**Status:** 🔲 Blocked on production deploy

---

## 🟡 Medium Priority

### 4. Referral / Invite Flow
**What:** Every user gets a unique invite link. When a referral signs up, the referrer is tracked.

**How it works:**
- `inviteCode` field on user object (short slug, e.g. `kush-7f3a`)
- Invite link: `getsignalbrief.com/?ref={inviteCode}`
- On signup: if `ref` param present, store `referredBy: inviteCode` on new user
- Email footer: "Know someone who'd find this useful? Share your invite link →" with their link
- `GET /api/me?email=...` returns referral count

**Reward (optional):** After 3 successful referrals, unlock custom topic slot or 10-item digest for free

**Status:** 🔲 Not started (Batch 7)

---

### 5. Analytics Dashboard
**What:** Lightweight internal view showing product health.

**Metrics:**
- Total users (active / pending / paused)
- Digests sent per day (last 30 days)
- Email open/click tracking via Resend webhook
- Most bookmarked topics (aggregate across all users)
- Top items bookmarked (headline + bookmark count)
- Users by topic coverage (heatmap)

**Access:** `http://localhost:3003/admin` — local only, no auth needed

**New endpoint:** `GET /api/admin/stats`

**Status:** 🔲 Not started (Batch 8)

---

### 6. Telegram Onboarding Flow
**What:** Allow users to sign up entirely via Telegram bot (without the web form).

**How it works:**
- `/start` → bot sends welcome + asks for name
- Bot walks through topic selection via inline keyboard buttons
- Depth + schedule set via buttons
- Creates user with `telegram_enabled: true`, `chatId` = real Telegram chat ID
- Confirmation message with summary of their setup

**Why:** Lower friction for Telegram-native users. Also enables the full bot interaction loop (currently requires web signup first).

**Status:** 🔲 Not started

---

### 7. Unsubscribe / Pause Flow
**What:** One-click unsubscribe from email footer that actually works (currently links to settings page which requires manual action).

**How it works:**
- `GET /unsubscribe?email=...&token=...` — immediately sets `status: "paused"`, renders a "You're unsubscribed" page with a "Resubscribe" button
- Unsubscribe token: HMAC of email + secret key (no separate DB storage needed)
- "Paused" users don't receive digests but data is preserved
- Resubscribe: `GET /resubscribe?email=...&token=...` → sets back to `active`

**Status:** 🔲 Not started

---

### 8. Digest Frequency Options
**What:** Let users receive the digest on custom schedules beyond Mon–Fri.

**Options to support:**
- Daily (Mon–Sun)
- Weekdays only (Mon–Fri) ← current default
- Mon–Sat ← already partially supported in settings
- Custom day picker ← already in settings UI, just needs digest cron to respect it

**Note:** The settings form already collects `days_of_week`. The digest cron runs daily and filters by user prefs. This is mostly a QA/test task to verify the filter logic works correctly for all day combos.

**Status:** 🔲 Likely already works — needs verification

---

## 🟢 Lower Priority / Future

### 9. Custom Topics
**What:** Users can add freeform topics beyond the 17 defaults (e.g. "GLP-1", "DOGE", "data centers", "quantum computing").

**Current state:** `custom_topics` field exists on user object. Reply handler supports `add DOGE`. But custom topics don't generate Perplexity queries or appear in digest selection — the field is stored but not used.

**What to build:** In digest.js, fetch Perplexity results for each `custom_topic` using a generic query pattern: `"{topic} strategy business news 2026"`. Add results to the pool with tag = the custom topic name.

**Status:** 🔲 Partially implemented (storage only)

---

### 10. Digest Depth Modes
**What:** Three depth settings that actually change the email output.

**Current state:** `depth` is stored but digest.js always delivers full "why it matters" (the `headline_plus_why` mode). Scan and deep modes are not wired up.

**What to build:**
- `scan`: headline + source link only, no lede, no WIM section
- `headline_plus_why`: current default behavior
- `deep`: full WIM + 1-2 extra implications + a "what to watch next" bullet

**Status:** 🔲 Not implemented

---

### 11. Email Open / Click Tracking
**What:** Know whether users actually read the digest.

**How:** Resend webhooks — add a `POST /api/webhook/resend` endpoint that receives `email.opened`, `email.clicked` events and stores on user object as `last_opened_at`, `open_count`.

**Use cases:** Mark users inactive after 30 days no open, power analytics dashboard

**Status:** 🔲 Not started

---

### 12. Item Feedback (Thumbs Up/Down)
**What:** Let users rate items to improve future relevance scoring.

**How (email):** Add 👍 / 👎 links in email footer of each item → `GET /feedback?item_url=...&vote=up&email=...`

**How (Telegram):** Reply `good 3` or `skip 3` after a digest

**Training signal:** Aggregate feedback informs topic weight adjustments, similar to existing `more/less` command but item-level

**Status:** 🔲 Not started

---

### 13. Web Landing Page (Public)
**What:** A public-facing marketing page at `getsignalbrief.com` (currently the onboarding form is the root `/`).

**What it needs:**
- Value prop headline
- Who it's for (3 archetypes)
- Sample digest (real or mock)
- One CTA: "Get your first brief →" → onboarding form
- No login, no pricing (free for now)

**Status:** 🔲 Not started

---

---

## 🔴 High Priority (New)

### 14. Admin Cost Dashboard
**What:** Track per-digest API costs so you know what you're spending before inviting more users. A runaway on-demand `/digest` user could blow the monthly budget.

**Metrics to track:**
- Per-digest: Perplexity calls (count + estimated $), Claude calls (input tokens, output tokens + estimated $), users served
- Running monthly total vs. configurable budget ceiling (default $50)
- Per-user cost breakdown (on-demand `/digest` users cost more than scheduled users)

**Implementation:**
- After every digest run, append a line to `data/cost-log.json`:
  `{ date, perplexity_calls, claude_tokens_in, claude_tokens_out, users_served, estimated_cost_usd }`
- Capture token counts from Claude API response (`usage.input_tokens`, `usage.output_tokens`)
- Perplexity cost estimated at $0.005/call (Sonar model)
- Claude Haiku estimated at $0.80/MTok input + $4.00/MTok output
- Dashboard at `GET /admin` (localhost only): 30-day chart + per-user breakdown table

**Effort:** Small — instrument existing `httpsPost` calls, add `/admin` route to server.js

**Status:** 🔲 Not started

---

### 15. Email Deliverability Baseline
**What:** Resend from a personal Gmail will land in spam for non-Gmail recipients. This is a hard blocker for multi-user at scale. Fix before inviting anyone outside your network.

**Checklist:**
- Complete Resend domain verification for `getsignalbrief.com` (SPF, DKIM, DMARC records added to DNS)
- Test delivery to Gmail, Outlook, and Apple Mail — confirm none go to spam/promotions
- Add `List-Unsubscribe` header to all outbound email (required by Gmail/Yahoo bulk sender rules for >5K/day — good practice now)
- Monitor Resend dashboard for bounce rate; keep below 2%

**Effort:** Config work only (no code) — DNS records + Resend dashboard setup

**Status:** 🔲 Not started (prerequisite for any growth)

---

### 16. Public Web Hosting
**What:** Settings links in emails point to `localhost:3003`. Any non-local user can't click them. Fix before inviting anyone.

**Options (pick one):**
- **Cloudflare Tunnel** (recommended): one command (`cloudflared tunnel --url localhost:3003`), auto-TLS, free, runs from your Mac. Gives a `*.trycloudflare.com` URL immediately; custom domain setup is one extra step.
- **Fly.io / Railway**: containerize the Node server, deploy to a persistent host. Requires Dockerfile. Better for scale.

**What changes in code:**
- `web/server.js`: `BASE_URL` env var already exists — set it in LaunchAgent plist or `.env`
- `templates/email.html` footer links already use `{{USER_EMAIL}}` placeholder — just needs `BASE_URL` to be right
- LaunchAgent: add `EnvironmentVariables` key: `BASE_URL = https://getsignalbrief.com`

**Effort:** Small (Cloudflare Tunnel path) or Medium (full deploy)

**Status:** 🔲 Not started (prerequisite for email verification links and settings pages)

---

### 17. Basic API Security
**What:** Once `/api/signup` is public-facing, it's open to bots. Add minimal protection before launch.

**What to add:**
- Rate limiting on `/api/signup`: max 5 attempts per IP per hour (simple in-memory map, no Redis needed)
- Email domain blocklist: reject known disposable email domains (mailinator.com, guerrillamail.com, etc.) — maintain a list of ~50 common disposable domains
- Invite-only mode (optional): require an `inviteCode` param on signup for the first cohort — prevents random signups while you QA

**Implementation:** All in `web/server.js` — small additions before the signup handler

**Effort:** Small

**Status:** 🔲 Not started

---

## Notes

- **Scoring feature (1)** ✅ Built — baseScore from enrichment (zero extra API cost), topicMatch computed locally
- **Email verification (2)** should come before any user-facing growth (referrals, landing page) — fix deliverability before scaling
- **Production URL (3)** is a prerequisite for email verification links to work
- **Cost dashboard (14)** should be built before inviting more users — need to know your burn rate
- **Deliverability baseline (15)** + **Public hosting (16)** are the two hardest blockers for going from 1 user to 10+
- Custom topics (9) and depth modes (10) are "finish what's started" items — they're half-built
