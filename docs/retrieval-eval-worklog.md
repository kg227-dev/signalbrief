# Retrieval Eval Worklog

This path remains as a compatibility summary for tooling that still checks `docs/retrieval-eval-worklog.md`.

- Live operator summary: [`./ops/retrieval-eval-worklog.md`](./ops/retrieval-eval-worklog.md)
- Historical March 2026 log: [`./archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](./archive/planning/2026-03/retrieval-eval-worklog-2026-03.md)
- Runtime mirror: [`../data/retrieval-evals/worklog.md`](../data/retrieval-evals/worklog.md)

## Current MVP Validation Note

- Day 22 audit (2026-04-18): [`./archive/planning/2026-03/mvp-day-22-2026-04-18.md`](./archive/planning/2026-03/mvp-day-22-2026-04-18.md)
- Current conclusion: the Day 18-20 post-`f95130c83e7733a43a4c7dc011021d46f1cc02d2` calibration window closed above threshold at **91/105 trusted Tier 1/2 selections (86.7%)**, but the latest Day 22 run regressed to **2 `validator_mismatch` parse failures**, **2/37 writeup drops**, and an **Industrials** basket that fell to **2/5 trusted**. Top-line metrics are still on track at **31/35 trusted (88.6%)** and **35/35 fulfillment**, but category expansion remains blocked until parser reliability and Industrials ranking recover.
