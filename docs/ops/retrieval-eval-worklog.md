# Retrieval Eval Worklog

*Last reviewed: April 8, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 8, 2026 (Day 12), the run is mechanically healthy but not exit-green: 35/35 delivered, 7/7 topics full and above depth-15, 568 total candidates, 58/58 broker source fetches successful, and 0 writeup-driven underfills. Trusted share fell to 62.9% (22/35), down from Day 11's 74.3% (26/35) and below the 80% MVP target. The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-12-2026-04-08.md`](../archive/planning/2026-03/mvp-day-12-2026-04-08.md).

**Active issue - `provider_parse_failure` is not resolved.**
Day 12 had 18 writeup drops on 53 attempts. `provider_parse_failure` returned with 10 drops after being absent on Day 11, mostly on strong trade-source items from americanbanker.com, modernhealthcare.com, statnews.com, and bankingdive.com. Use the raw-response logging added around commit `3800f54` to classify these failures before changing prompts blindly.

**Active issue - trusted-first selection floor is missing.**
No selected unknown-tier or official filler items appeared on Day 12, but 13/35 selected items were standard-tier. Technology, Life Sciences, Energy, and Industrials all selected standard-tier items even when enough premium/strong candidates existed in the same topic pool. The next selection change should prefer or require premium/strong backfill on adequate-depth days before standard-tier reserves are allowed.

**Active issue - Technology strategic relevance is too loose.**
Technology selected a personal CGM story, an offline dictation app, Vision Pro/Steam Link, Bluesky/vibe-coding culture, and a small open-source AI model-maker profile while stronger AI security, platform-policy, and physical-AI capital-allocation stories missed. Add negative signals for personal device reviews, app-feature-only stories, and culture/meta commentary; add positive signals for AI security, platform governance, compute/infrastructure, and capital allocation.

**WSJ/pymnts status changed from non-article failure to stale-only failure.**
`financial_wsj_markets` parsed 20 with `non_article_count=0` and `consumer_pymnts_retail` parsed 10 with `non_article_count=0`, so the article-like listing fix appears deployed. Both retained 0 because all entries were stale (`WSJ stale=20`, `pymnts stale=10`). Monitor one more weekday before treating this as a remaining parser bug.

Prior working conclusions on operational uptime, broker backbone, freshness, and exact delivery count are resolved or on track. The current quality blockers are writeup parse reliability, trusted-first reserve ordering, and Technology relevance.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
