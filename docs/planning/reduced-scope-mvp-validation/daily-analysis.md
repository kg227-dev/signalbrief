# MVP Validation — Daily Analysis

7-day rolling analysis of digest quality, source health, and product readiness.
Completed day write-ups are archived under `docs/archive/planning/2026-03/mvp-day-N-YYYY-MM-DD.md`.

## Rolling tracker

| Metric | D1 | D2 | D3 | D4 | D5 | D6 | D7 | Target |
|--------|----|----|----|----|----|----|-----|--------|
| Full 5-item (7 topics) | 7/7 | **4/7** | **4/7** | **7/7** | **7/7** | **7/7** | **7/7** | 7/7 |
| Depth >=15 (7 topics) | 5/7 | **4/7** | **1/7** | 7/7 | 7/7 | **7/7** | **7/7** | 7/7 |
| Trusted T1/2 share | ~83% | **~46%** | **~52%** | **65.7%** | **77.1%** | **80.0%** | **80.0%** | >=80% |
| Broker/RSS share | 96% | 100% | 97% | 100% | 100% | 100% | 100% | >=70% |
| Source success rate | 89% | **98%** | 100% | 98.3% | 100% | 100% | 100% | >=90% |
| Missed-story flags | 19 | 14 | 10 | 20 | 19 | 19 | 21 | 0 |
| True miss flags | 3 | 3 | 3 | 6 | 5 | ~6 | ~8 | 0 |
| Manual intervention | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Consecutive full days | 0 | 0 | 0 | 1 | 2 | 3 | 4 | 7 |
| Day color | Red | Red | Red | Yellow | Yellow | Yellow | Yellow | Green |

## Completed days

- [Day 1 — 2026-03-28](../../archive/planning/2026-03/mvp-day-1-2026-03-28.md)
- [Day 2 — 2026-03-29 (Sunday)](../../archive/planning/2026-03/mvp-day-2-2026-03-29.md)
- [Day 3 — 2026-03-30 (Monday)](../../archive/planning/2026-03/mvp-day-3-2026-03-30.md)
- [Day 4 — 2026-03-31 (Tuesday)](../../archive/planning/2026-03/mvp-day-4-2026-03-31.md)
- [Day 5 — 2026-04-01 (Wednesday)](../../archive/planning/2026-03/mvp-day-5-2026-04-01.md)
- [Day 6 — 2026-04-02 (Thursday)](../../archive/planning/2026-03/mvp-day-6-2026-04-02.md)
- [Day 7 — 2026-04-03 (Friday)](../../archive/planning/2026-03/mvp-day-7-2026-04-03.md)

## Day 4 — 2026-03-31

See [archive](../../archive/planning/2026-03/mvp-day-4-2026-03-31.md). **Yellow.** First full 7/7 delivery. Trusted T1/2 65.7% (below 80%). One source failure (financial_reuters_business). Cross-topic contamination continues.

## Day 5 — 2026-04-01

See [archive](../../archive/planning/2026-03/mvp-day-5-2026-04-01.md). **Yellow.** Second consecutive 7/7 delivery and full 10/10 canary send. Trusted T1/2 recovered to 77.1% but still missed target. The main remaining problems are selection quality, not retrieval reliability: FDA compliance pages were selected in Life Sciences, an American Banker house promo was selected in Financial Services, and an off-topic FreightWaves border story led Industrials. The March 31 source-cap raise also did not show up in the scheduled audit, which still reported `3/3` caps.

## Day 6 — 2026-04-02

See [archive](../../archive/planning/2026-03/mvp-day-6-2026-04-02.md). **Yellow.** Day 6 is the first day that hit all of the hard operational gates at once: 7/7 topics at 5 items, 7/7 topics above the depth gate, 10/10 canaries delivered, 80.0% trusted T1/2 share, 100% broker backbone, 100% source success, and 0 duplicate URLs vs Day 5. It is still not a true green day. The selected set remains quality-mixed, with FDA/official content still leaking into Life Sciences, Technology, and Energy, and the stored scheduled canary records show `0/80` populated `wim` / `wim_brief` fields, which is a likely deep-mode content regression rather than a clean strategic-writeup win.

Day 7 prep is now explicit: restore non-empty deep-mode body text even when scheduled writeups are missing, downgrade FDA from primary weighting, and promote FierceBiotech/FiercePharma so Life Sciences quality is driven more by trade reporting than official FDA filler. The next live check is whether Day 7 still stores null writeups and whether FDA share actually drops in the selected set.

## Day 7 — 2026-04-03

See [archive](../../archive/planning/2026-03/mvp-day-7-2026-04-03.md). **Yellow.** Day 7 closed the week with a fourth consecutive mechanically healthy weekday: 618 candidates, 35 selected, 7/7 topics at 5 items, 7/7 topics above the depth gate, 80.0% trusted T1/2 share, 100% broker backbone, 100% source success, and 10/10 canaries delivered. It is still not green. The renderer mitigation worked, so no deep card shipped blank, but all 10 scheduled canary records still stored `0/80` populated `wim` / `wim_brief` fields. The selected set also still shows official-content leakage: Life Sciences selected 3 FDA items, Consumer & Retail selected an FDA recall, Financial Services selected a CMS rule item, and Healthcare still leaned on STAT opinion plus CMS rulemaking despite a deep trade pool. FierceBiotech and FiercePharma improved the Life Sciences candidate pool, but they still did not win any of the 5 selected slots.

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
