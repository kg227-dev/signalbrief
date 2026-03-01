# SignalBrief — Batched Build Roadmap

> Minimal overhead. Each batch ends with something that works, even if ugly.
> Build Stream never cannibalizes Run Stream. Max 1–2 build bullets per day unless Kush enters Build Mode.

---

## Batch 0: Product Clarity + Scope Lock *(no coding)*
**Goal:** Confirm what "v1 done" means.
**Deliverables:**
- v1 scope statement (one paragraph)
- v1 feature list (max 7 bullets)
- v1 non-goals (max 7 bullets)
- First 5 target user pain statements (consultant-specific)
- Success metric for v1

**Status:** ✅ Complete

---

## Batch 1: Manual Prototype *(same quality, zero infra)*
**Goal:** Prove the digest format delivers value before building anything.
**Deliverables (5 consecutive runs, manual):**
- Telegram/WhatsApp condensed digest format
- Long-form email-style digest (plain text fine)
- "Why it matters" lines — neutral, journalistic tone
- Deduped, high-signal sources

**Status:** ✅ Complete

---

## Batch 2: MVP Automation for 1 User
**Goal:** Automated daily digest for Kush only. Minimize moving parts.
**Deliverables:**
- Final MVP architecture decision
- Inputs/outputs definition (config file, sources list, message + email templates)
- Runbook: how to run it / how to fix if it fails / how to change topics
- Cost guardrail plan

**Status:** ✅ Complete — digest.js pipeline, LaunchAgents, cron at 6:45 AM ET Mon–Sat

---

## Batch 3: "Save 3" Bookmarking + Topic Tuning
**Goal:** Make it interactive and sticky.
**Deliverables:**
- "save 3" parsing spec (exact behaviors)
- "more AI / less M&A / add keyword" behaviors
- Simple data store
- Confirmation messages

**Status:** ✅ Complete — reply-handler.js, Claude intent parsing, per-user JSON store

---

## Batch 4: Multi-User (up to 10)
**Goal:** Turn it from personal tool into a product.
**Deliverables:**
- Onboarding flow (exact script)
- Per-user configuration schema (fields + defaults)
- Safety/guardrails (prevent spam, handle bounces)
- 10 pilot user archetypes (not names)

**Status:** ✅ Complete — web onboarding (index.html), settings page, welcome email

---

## Batch 5: Custom Domain + Email
**Goal:** Branded email delivery from a real domain.
**Deliverables:**
- Resend API integration
- Custom from address (digest@getsignalbrief.com)
- Gmail OAuth fallback

**Status:** ✅ Complete — mailer.js, Resend primary + Gmail fallback

---

## Batch 6: Digest Archive / Web Reader
**Goal:** Every past digest browsable in a clean web UI.
**Deliverables:**
- /archive page listing all past issues
- Full digest reader per date
- Archive JSON saved on every digest run

**Status:** ✅ Complete — archive.html, /api/archive endpoints, saveToArchive()

---

## Batch 7: Referral / Invite Flow *(next)*
**Goal:** Frictionless word-of-mouth growth.
**Deliverables:**
- Unique invite link per user
- "Forward to a colleague" CTA in email footer (already in template)
- Tracking: who invited who
- Optional: referral reward (skip a week of prompts?)

**Status:** 🔲 Not started

---

## Batch 8: Analytics Dashboard
**Goal:** Understand what's working.
**Deliverables:**
- Digests sent per day
- Active vs paused users
- Most bookmarked topics/items
- Simple admin view (localhost only)

**Status:** 🔲 Not started

---

## Product Principles

**Content must be:**
- Recency aware (last 24–72 hours)
- Source quality weighted (business press + trade press)
- Cluster balanced (no over-indexing on one topic)
- Action oriented (at least 1 item/day that affects decisions)

**Digest must be:**
- Short enough to read in 2–4 min in chat
- Deep enough to be useful in email
- Non-annoying: one push/day, one action window/night

**Personalization must be:**
- Preference-based (topics, length)
- Behavior-based (what you save, what you request more/less of)
- Never creepy

---

## Two Value Streams

| Stream | Cadence | Examples |
|--------|---------|---------|
| **Run Stream** (daily utility) | Every day | Daily briefing, digest delivery |
| **Build Stream** (compounding asset) | 1–2 bullets/day MAX unless Build Mode | SignalBrief batches |

**Rule:** Build Stream never cannibalizes Run Stream.
