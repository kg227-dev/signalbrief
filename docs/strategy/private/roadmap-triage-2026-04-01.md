# Roadmap Triage

*Reviewed: April 1, 2026*

This note captures a first-pass triage of the proposed roadmap buckets against the current repo contract in [`SPEC.md`](../../../SPEC.md), the live backlog in [`docs/features.md`](../../features.md), and the current go-to-market posture in [`docs/strategy/marketing-strategy.md`](../marketing-strategy.md).

## Summary

The main miscategorization calls are:

- `Light explicit feedback` is too early for `Do Now`.
- `Role-based "why it matters"` is too early for `Do Next`.
- `Topic expansion` is too early for `Do Next`.

Two other items are directionally in the right place but likely understated on effort:

- `Public digest links`
- `Strict quality enforcement layer`

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

## Why These Three Moves Matter Most

`Light explicit feedback` should not outrank core trust work. It helps cold start, but only after the product is already consistently sharp enough that user reactions improve a good system instead of compensating for a weak one.

`Role-based "why it matters"` should wait until the base writing system is stable. Tailoring a weak or inconsistent interpretation layer by persona usually multiplies variability instead of increasing usefulness.

`Topic expansion` is the clearest sequencing error. The live repo is still actively defending a reduced-scope, seven-topic product. Expanding before those lanes are reliably dense and differentiated would dilute the product at the wrong time.
