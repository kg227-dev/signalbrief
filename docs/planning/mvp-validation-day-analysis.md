# MVP Validation — Daily Analysis

7-day rolling analysis of digest quality, source health, and product readiness.
Completed day write-ups are archived under `docs/archive/planning/2026-03/mvp-day-N-YYYY-MM-DD.md`.

## Rolling tracker

| Metric | D1 | D2 | D3 | D4 | D5 | D6 | D7 | Target |
|--------|----|----|----|----|----|----|-----|--------|
| Full 5-item (7 topics) | 7/7 | **4/7** | **4/7** | **7/7** | | | | 7/7 |
| Depth ≥15 (7 topics) | 5/7 | **4/7** | **1/7** | 7/7 | | | | 7/7 |
| Trusted T1/2 share | ~83% | **~46%** | **~52%** | **65.7%** | | | | ≥80% |
| Broker/RSS share | 96% | 100% | 97% | 100% | | | | ≥70% |
| Source success rate | 89% | **98%** | 100% | 98.3% | | | | ≥90% |
| Missed-story flags | 19 | 14 | 10 | 20 | | | | 0 |
| True miss flags | 3 | 3 | 3 | TBD | | | | 0 |
| Manual intervention | 0 | 0 | 0 | 0 | | | | 0 |
| Consecutive full days | 0 | 0 | 0 | 1 | | | | 7 |
| Day color | Red | Red | Red | Yellow | | | | Green |

## Completed days

- [Day 1 — 2026-03-28](../archive/planning/2026-03/mvp-day-1-2026-03-28.md)
- [Day 2 — 2026-03-29 (Sunday)](../archive/planning/2026-03/mvp-day-2-2026-03-29.md)
- [Day 3 — 2026-03-30 (Monday)](../archive/planning/2026-03/mvp-day-3-2026-03-30.md)
- [Day 4 — 2026-03-31 (Tuesday)](../archive/planning/2026-03/mvp-day-4-2026-03-31.md)

## Day 4 — 2026-03-31

See [archive](../archive/planning/2026-03/mvp-day-4-2026-03-31.md). **Yellow.** First full 7/7 delivery. Trusted T1/2 65.7% (below 80%). One source failure (financial_reuters_business). Cross-topic contamination continues.

## Day 5 — 2026-04-01

_Pending._

## Day 6 — 2026-04-02

_Pending._

## Day 7 — 2026-04-03

_Pending._

---

## Template — copy for each new day

```markdown
## Day N — YYYY-MM-DD

### What shipped

| Topic | Items | Candidates | Depth ≥15 | Trusted T1/2 | Strongest source |
|-------|-------|-----------|-----------|---------------|-----------------|
| Technology | /5 | | | | |
| Life Sciences | /5 | | | | |
| Energy | /5 | | | | |
| Financial Services | /5 | | | | |
| Industrials | /5 | | | | |
| Healthcare | /5 | | | | |
| Consumer & Retail | /5 | | | | |

### What failed

### Weakest 2 topics

### Strongest 2 topics

### Missed-story review (top 3)

#### True misses

#### Borderline

#### False positives

### Missed-story flag summary

| Classification | Count | % |
|---------------|-------|---|
| True miss | | |
| Borderline | | |
| False positive | | |

### Hypothesis: what's driving today's results
```
