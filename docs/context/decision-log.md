# Decision Log

*Last reviewed: April 8, 2026*

Use this file for durable, current decisions that are likely to matter again. Keep entries short. Put narrative detail and dated execution history in plans or archives.

## 2026-04-08

### Context surface is now layered

Default repo context should start with `docs/context/` before loading active plans, specs, or archives. Large historical files are provenance, not default prompt material.

### Archived history is not live guidance

`docs/archive/**` and runtime mirrors like `data/retrieval-evals/worklog.md` remain available for audits and provenance, but current work should route through compact live summaries first.

## 2026-04-07

### Retrieval quality is the primary blocker

The product is mechanically healthy enough to continue validation, but trusted-share regression, `provider_parse_failure`, and weak topic purity still block an exit-green quality call.

### Admin funnel is the diagnostic surface

The admin funnel page and topic-level stage visibility are the primary debugging surfaces for candidate flow, drops, and selection behavior. Use them before inventing new ad hoc diagnostics.

## 2026-03-27

### Reduced-scope MVP is the product contract

The live product is an email-only, 7-sector briefing. Telegram, custom keywords, and broader product experiments are out of scope for the current MVP.

### Active plans must collapse into shorter live summaries

Once a plan stops directly steering implementation, capture its durable guidance in a shorter live doc and move the narrative bundle to `docs/archive/`.
