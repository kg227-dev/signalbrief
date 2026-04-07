# Retrieval Eval Worklog

*Last reviewed: April 7, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 7, 2026 (Day 11), the run is the best in the validation run: 35/35 delivered, 7/7 topics full and above depth-15, trusted share 74.3% (26/35), 5 total writeup drops, repair pass at 75%. Day 10's collapse (24/35, 8.3% trusted) was driven by Sunday pool thinness and the Monday 72h freshness extension restored it cleanly.

**Active issue — WSJ and pymnts still silently dropping all content (fix not yet deployed).**
`financial_wsj_markets`: `non_article_count=20` every run. `consumer_pymnts_retail`: `non_article_count=10`. The fix (`allow_article_like_listing_urls: true` on both sources + query-string check fix in `officialListingUrlLooksArticleLike`) was committed as `3800f54` and pushed to GitHub but production has not received it. Deploy before the next Sunday run (2026-04-12). On weekday runs with a full pool these missing sources are not felt; on Sunday with 2–3 candidates per topic they're material.

**Active issue — Saturday needs the same 72h freshness extension as Sunday/Monday.**
Sunday already gets 72h (corrected in the existing `isLowPublishDay` check). Saturday does not — need to verify the current code covers Saturday. If not, Saturday runs will have the same pool collapse that Sunday had on Day 10.

**`provider_parse_failure` appears to be content-quality driven, not a systematic prompt bug.**
Zero parse failures on Day 11 with 41 attempts and a full 351-candidate pool. Days 8–10 failures correlated exactly with thin Sunday/weekend content. The raw response logging added in `3800f54` will confirm on the next failure. No prompt fix needed until evidence says otherwise.

**Source concentration is now the active quality ceiling.**
With pool depth and writeup reliability recovered, the main quality gap is per-source saturation. Financial Services delivered 5/5 americanbanker.com items — all good, but the Takeda/Denali dissolution and the AI-priority banker survey both missed because the pool was full. A per-source cap of 3 would force diversity; evaluate after WSJ/pymnts deploy adds new sources to the pool.

Prior working conclusions (operational uptime, broker backbone, freshness, writeup path) are resolved or on track.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
