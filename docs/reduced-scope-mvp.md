# Reduced-Scope MVP

*Last reviewed: April 2, 2026*

This is the live product definition for SignalBrief. Historical audits, build plans, and March 2026 execution notes live under [`docs/archive/`](./archive/README.md).

## Routing

- System contract: [`../SPEC.md`](../SPEC.md)
- Output rules: [`../FORMAT-RULES.md`](../FORMAT-RULES.md)
- Active validation bundle: [`./planning/reduced-scope-mvp-validation/README.md`](./planning/reduced-scope-mvp-validation/README.md)

## Product Definition

SignalBrief is a scheduled, email-only briefing product for strategy-oriented readers who need fast sector coverage without managing multiple newsletters.

The live product is not:

- a Telegram bot
- an on-demand chat product
- a public digest feed
- a custom-topic or keyword-personalization system

## Subscriber Contract

- Users subscribe to `1-3` standard topics.
- Each subscribed topic can deliver up to `5` selected items per scheduled send.
- Only items published within the last `48 hours` are eligible.
- A story belongs to one best-fit topic only.
- Delivery is scheduled email only.
- Underfilled topics are withheld rather than padded with weak or off-topic items.

## Standard Topic Set

- `HEALTHCARE`
- `LIFE SCIENCES`
- `TECHNOLOGY`
- `ENERGY`
- `FINANCIAL SERVICES`
- `CONSUMER & RETAIL`
- `INDUSTRIALS`

Sector-specific regulatory or official stories should appear inside the relevant sector. There is no standalone policy/regulatory topic in the live MVP.

## Depth Modes

Depth mode changes writeup depth, not selection:

- `scan`: headline plus source
- `brief`: headline plus one-line takeaway
- `deep`: headline plus short factual lede plus strategic why-it-matters analysis

The same selected stories should survive across depth modes.

## Retrieval And Selection Rules

- RSS/direct publisher feeds and official sources are the backbone.
- Discovery/search exists to supplement thin topics, not define the product.
- Candidate scoring and selection are topic-specific, not a single global list.
- Cross-day dedup and repetition suppression apply before final selection.
- Source quality, broker health, and editorial controls should remain inspectable in admin.

## Operator Requirements

- Scheduled runs must write digest audit artifacts.
- Operators need clear topic/day visibility into candidate counts, source mix, rejected items, and final selections.
- Source governance and retrieval-quality follow-ups should stay routed through live ops docs, not ad hoc planning notes.

## Non-Goals

- reviving Telegram or chat-triggered delivery paths
- broadening the topic taxonomy beyond the 7 standard topics
- reintroducing public digest pages as a core live product dependency
- using AI search as the primary content backbone
