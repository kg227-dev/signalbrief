# Roadmap Triage

*Reviewed: April 2, 2026*

This note captures a first-pass triage of the proposed roadmap buckets against the current repo contract in [`SPEC.md`](../../../SPEC.md), the live backlog in [`docs/features.md`](../../features.md), and the current go-to-market posture in [`docs/strategy/marketing-strategy.md`](../marketing-strategy.md).

## Summary

The main miscategorization calls are:

- `Light explicit feedback` is too early for `Do Now`.
- `Role-based "why it matters"` is too early for `Do Next`.
- `Topic expansion` is too early for `Do Next`.

Two other items are directionally in the right place but likely understated on effort:

- `Public digest links`
- `Strict quality enforcement layer`

The broader read is that the roadmap is strong on product philosophy but weaker on sequencing. It mostly understands SignalBrief as a trust product, not a feature-accumulation product, which is the right instinct. The main risk is trying to layer personalization, role variants, or expansion before the base quality system is stable enough to support them.

## Triage Table

| Feature | Current bucket | Recommended bucket | Notes |
| --- | --- | --- | --- |
| Public digest links | Do Now | Keep in Do Now | Strong fit with the current growth strategy and existing public-surface direction. Effort is probably medium, not trivial, because it needs clean sharing rules, indexing posture, and selective exposure. |
| "Why it matters" quality system (v2) | Do Now | Keep in Do Now | This is the clearest product-differentiation layer in the repo docs and should stay near the top. |
| Strict quality enforcement layer | Do Now | Keep in Do Now | This is core to trust and retention. It is probably higher effort than the bucket implies, but it still belongs in the near-term core track. |
| Light explicit feedback (thumbs up/down) | Do Now | Move to Do Next | Useful, but it does not strengthen the core habit as directly as quality and interpretation. Better treated as a support system for later personalization work. |
| Implicit personalization engine | Do Next | Keep in Do Next | Correct long-term moat call. It should follow stronger quality infrastructure rather than precede it. |
| Multi-day signal tracking | Do Next | Keep in Do Next | Strong fit. This directly improves trust, continuity, and non-repetition without pushing the product into a feed. |
| Role-based "why it matters" | Do Next | Move to Do Later | The base interpretation layer should be standardized before adding role-conditioned variants. Otherwise the product risks producing generic or unstable framing. |
| Topic expansion | Do Next | Move to Do Later | The current product contract is explicitly reduced-scope and fixed-topic. Expansion should wait until density and quality are stable inside the existing seven lanes. |
| Delivery timing customization | Do Later | Keep in Do Later | Useful convenience feature, but not strategic. |
| Weekly recap | Do Later | Keep in Do Later | Nice retention add-on, but not central to the daily habit. |
| Bookmark / save items | Do Later | Keep in Do Later | Helpful for some users, but not core to the product promise. |
| Simple sharing UX | Do Later | Keep in Do Later | Correct as a secondary enabler. If public links ship soon, a minimal sharing layer can ship alongside them. |
| Real-time alerts | Don't Do | Keep in Don't Do | Direct conflict with the email-first, noise-reducing product shape. |
| Slack / Telegram early | Don't Do | Keep in Don't Do | Conflicts with the current product contract and would push the product toward a noisier consumption mode. |
| Full dashboard / app experience | Don't Do | Keep in Don't Do | Misaligned with the email-native wedge. |
| Over-customization / heavy controls | Don't Do | Keep in Don't Do | Conflicts with the product's opinionated-utility positioning. |
| Breaking news / speed race | Don't Do | Keep in Don't Do | Strategic mismatch. Speed is not the wedge. |
| AI assistant mode | Don't Do | Keep in Don't Do | Strategic mismatch for the current product shape and would pull attention away from the digest habit. |

## Recommended Bucket Reset

### Do Now

- Public digest links
- "Why it matters" quality system (v2)
- Strict quality enforcement layer

### Do Next

- Implicit personalization engine
- Multi-day signal tracking
- Light explicit feedback

### Do Later

- Role-based "why it matters"
- Topic expansion
- Delivery timing customization
- Weekly recap
- Bookmark / save items
- Simple sharing UX

### Don't Do

- Real-time alerts
- Slack / Telegram early
- Full dashboard / app experience
- Over-customization / heavy controls
- Breaking news / speed race
- AI assistant mode

## What The Roadmap Gets Right

- It has a real point of view and mostly protects the email-native, low-noise wedge.
- It correctly treats `why it matters` quality and trust enforcement as core product infrastructure, not polish.
- It identifies `implicit personalization` as a moat, but not the immediate wedge.
- It says no to the most obvious strategic traps: alerts, chat, Slack-first distribution, speed races, and a full app.
- It recognizes that sharing should support the product's usefulness rather than turn SignalBrief into a generic media surface.

## What Feels Weak

- Sequencing is the biggest issue. A few items assume a more mature product than the current repo contract supports.
- `Light explicit feedback` is not really `high value, low effort` once the full loop is considered. The UI is easy; learning from the signal cleanly is the hard part.
- `Public digest links` is strategically right, but its effort is understated because it touches public/private boundaries, search posture, and selective exposure rules.
- `Role-based "why it matters"` risks multiplying variance before the baseline interpretation system is disciplined enough.
- The roadmap sometimes leans a little too quickly toward personalization as the answer, when better selection and better interpretation are still the higher-leverage moves.

## What Is Missing

- A clearer onboarding and activation track for the first 3-7 days, when the product has to earn the second and third opens.
- Explicit measurement discipline tied to retention, not just feature completion. The key question is whether changes increase the odds that users open 4-5 mornings per week.
- A more concrete breakdown of the `strict quality enforcement layer` into freshness, duplicate suppression, source thresholds, and auditable rejection reasons.
- A more explicit connection between `public digest links` and the later sharing/referral loop, so growth work stays aligned with the product shape.

## Recommended Sequencing Principle

The roadmap should be judged against one question:

> Does this increase the odds that a user opens SignalBrief 4-5 mornings per week because it is reliably sharp, calm, and useful?

By that standard, the best near-term work is:

- better interpretation quality
- stricter quality enforcement
- better continuity across days
- selective public sharing that proves product value without creating noise

By that same standard, expansion, persona variants, and richer feedback loops should follow only after the core habit is strong.

## Why These Three Moves Matter Most

`Light explicit feedback` should not outrank core trust work. It helps cold start, but only after the product is already consistently sharp enough that user reactions improve a good system instead of compensating for a weak one.

`Role-based "why it matters"` should wait until the base writing system is stable. Tailoring a weak or inconsistent interpretation layer by persona usually multiplies variability instead of increasing usefulness.

`Topic expansion` is the clearest sequencing error. The live repo is still actively defending a reduced-scope, seven-topic product. Expanding before those lanes are reliably dense and differentiated would dilute the product at the wrong time.
