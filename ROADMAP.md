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

**Exit criteria:** Kush approves v1 scope in one message.

---

## Batch 1: Manual Prototype *(same quality, zero infra)*
**Goal:** Prove the digest format delivers value before building anything.
**Deliverables (5 consecutive runs, manual):**
- Telegram/WhatsApp condensed digest format
- Long-form email-style digest (plain text fine)
- "Why it matters" lines — neutral, journalistic tone
- Deduped, high-signal sources

**Exit criteria:** Kush says "this is valuable enough to automate."

---

## Batch 2: MVP Automation for 1 User
**Goal:** Automated daily digest for Kush only. Minimize moving parts.
**Deliverables:**
- Final MVP architecture decision (1–2 options + recommendation)
- Inputs/outputs definition (config file, sources list, message + email templates)
- Runbook: how to run it / how to fix if it fails / how to change topics
- Cost guardrail plan (monthly cap + fail-safe)

**Exit criteria:** Runs automatically with stable output.

---

## Batch 3: "Save 3" Bookmarking + Topic Tuning
**Goal:** Make it interactive and sticky.
**Deliverables:**
- "save 3" parsing spec (exact behaviors)
- "more AI / less M&A / add keyword" behaviors
- Simple data store (sheet or equivalent)
- Confirmation messages

**Exit criteria:** Kush can tune and save without breaking the pipeline.

---

## Batch 4: Multi-User (up to 10)
**Goal:** Turn it from personal tool into a product.
**Deliverables:**
- Onboarding flow (exact script)
- Per-user configuration schema (fields + defaults)
- Safety/guardrails (prevent spam, handle bounces)
- 10 pilot user archetypes (not names)

**Exit criteria:** Can add 1–2 pilot users and deliver reliably.

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
| **Run Stream** (daily utility) | Every day | Daily briefing, money experiment approval packet |
| **Build Stream** (compounding asset) | 1–2 bullets/day MAX unless Build Mode | SignalBrief batches |

**Rule:** Build Stream never cannibalizes Run Stream.

---

## Status
🟡 Not started. Awaiting Kush to enter Build Mode and trigger Batch 0.
