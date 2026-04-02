# SignalBrief Format Rules

*Last reviewed: April 2, 2026*

This file defines the live output rules for the reduced-scope, email-only MVP.

## Product Invariants

- Email is the only delivery surface.
- Users subscribe to `1-3` standard topics.
- Each subscribed topic can deliver up to `5` items per scheduled digest.
- Items older than `48 hours` are ineligible.
- A story should appear under one best-fit topic only.
- Depth mode changes writeup length, not topic selection.

## Supported Topics

- `HEALTHCARE`
- `LIFE SCIENCES`
- `TECHNOLOGY`
- `ENERGY`
- `FINANCIAL SERVICES`
- `CONSUMER & RETAIL`
- `INDUSTRIALS`

## Digest Structure

- Group items by subscribed topic.
- Keep topic sections clearly labeled.
- Preserve a stable order inside each topic section once items are selected.
- Withhold underfilled topic sections rather than padding with weak or off-topic stories.

## Item Rules

- Use a factual headline with no hype, teaser language, or clickbait framing.
- Show one clean source attribution per item, linked to the article URL.
- Keep each item grounded in the selected article. Do not invent implications that the source does not support.
- When an item is older than 24 hours but still inside the 48-hour window, show a simple freshness cue such as `24h ago` or `2d ago`.
- Avoid repeated items across consecutive days unless there is a materially new development.

## Depth Modes

### Scan

- Headline
- Source link

### Brief

- Headline
- One-line takeaway
- Source link

### Deep

- Headline
- Short factual lede
- `2-3` sentence strategic why-it-matters explanation
- Source link

## Writing Rules

- Start with the most decision-useful fact.
- The first sentence of the analysis should explain why the item matters to a strategy-oriented reader.
- Keep analysis specific, implication-forward, and grounded in the reported event.
- Prefer concrete business impact over generic commentary.
- Do not write as if SignalBrief is a chat assistant. Write as a briefing product.

## Subject Line Rules

- Include the day/date plus `2-3` concrete signal teasers.
- Teasers should reference the actual selected story set, not generic topic names.
- Keep the subject line readable on mobile; trim before it becomes a headline dump.

Example:

```text
SignalBrief — Thu, Apr 2 | FDA gene therapy move, grid capex jumps, bank fee pressure
```

## Footer Rules

- Include preferences/settings access.
- Include unsubscribe access.
- Include any forward/share CTA only if it is actually supported by the current product surface.
