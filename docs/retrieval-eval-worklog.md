# Retrieval Eval Worklog

This path remains as a compatibility summary for tooling that still checks `docs/retrieval-eval-worklog.md`.

- Live operator summary: [`./ops/retrieval-eval-worklog.md`](./ops/retrieval-eval-worklog.md)
- Historical March 2026 log: [`./archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](./archive/planning/2026-03/retrieval-eval-worklog-2026-03.md)
- Runtime mirror: [`../data/retrieval-evals/worklog.md`](../data/retrieval-evals/worklog.md)

## Current MVP Validation Note

- Day 13 audit (2026-04-09): [`./archive/planning/2026-03/mvp-day-13-2026-04-09.md`](./archive/planning/2026-03/mvp-day-13-2026-04-09.md)
- Current conclusion: mechanically healthy, not exit-green. Day 13 delivered 35/35 with 610 candidates and 698/698 broker fetch items passing, trusted share improved to 25/35 (71.4%), but the writeup layer dropped 143 items under `validator_mismatch` and still forced weak Consumer & Retail and Industrials selections.
