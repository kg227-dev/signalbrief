# MVP Validation — Daily Analysis

Rolling analysis of digest quality, source health, and product readiness across the initial 7-day validation window plus the Days 8-14 continuation window.
Completed day write-ups are archived under `docs/archive/planning/2026-03/mvp-day-N-YYYY-MM-DD.md`.

## Rolling tracker

| Metric | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | D11 | D12 | D13 | D14 | Target |
|--------|----|----|----|----|----|----|-----|----|----|-----|-----|-----|-----|-----|--------|
| Full 5-item (7 topics) | 7/7 | **4/7** | **4/7** | **7/7** | **7/7** | **7/7** | **7/7** | **7/7** | **6/7** | TBD | TBD | TBD | TBD | TBD | 7/7 |
| Depth >=15 (7 topics) | 5/7 | **4/7** | **1/7** | 7/7 | 7/7 | **7/7** | **7/7** | **7/7** | **7/7** | TBD | TBD | TBD | TBD | TBD | 7/7 |
| Trusted T1/2 share | ~83% | **~46%** | **~52%** | **65.7%** | **77.1%** | **80.0%** | **80.0%** | **31.4%** | **35.3%** | TBD | TBD | TBD | TBD | TBD | >=80% |
| Broker/RSS share | 96% | 100% | 97% | 100% | 100% | 100% | 100% | 100% | 100% | TBD | TBD | TBD | TBD | TBD | >=70% |
| Source success rate | 89% | **98%** | 100% | 98.3% | 100% | 100% | 100% | 100% | 100% | TBD | TBD | TBD | TBD | TBD | >=90% |
| Missed-story flags | 19 | 14 | 10 | 20 | 19 | 19 | 21 | 20 | 6 | TBD | TBD | TBD | TBD | TBD | 0 |
| True miss flags | 3 | 3 | 3 | 6 | 5 | ~6 | ~8 | n/a* | 6† | TBD | TBD | TBD | TBD | TBD | 0 |
| Manual intervention | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | TBD | TBD | TBD | TBD | TBD | 0 |
| Consecutive full days | 0 | 0 | 0 | 1 | 2 | 3 | 4 | 5 | 0 | TBD | TBD | TBD | TBD | TBD | 7 |
| Day color | Red | Red | Red | Yellow | Yellow | Yellow | Yellow | Yellow | **Yellow** | TBD | TBD | TBD | TBD | TBD | Green |

*Day 8 still reports 20 missed-story flags at the run-summary level, but the candidate-level audit surface is now dominated by `writeup_failed` drops and backfills. The more actionable Day 8 failure mode is 63 dropped writeup attempts rather than a stable true-miss count, so D8 true-miss is left `n/a*` instead of invented.*

†Day 9 missed-story flags are 6 flagged and all 6 are true misses: 3 in Technology (NASA budget, Anthropic private markets, Ice Age dice), 3 in Financial Services (FCC telecom enforcement, Coinbase OCC charter, March jobs report). The FCC/Coinbase/jobs stories were blocked by the marketwatch.com source monopoly patched on 2026-04-05.

## Completed days

- [Day 1 — 2026-03-28](../../archive/planning/2026-03/mvp-day-1-2026-03-28.md)
- [Day 2 — 2026-03-29 (Sunday)](../../archive/planning/2026-03/mvp-day-2-2026-03-29.md)
- [Day 3 — 2026-03-30 (Monday)](../../archive/planning/2026-03/mvp-day-3-2026-03-30.md)
- [Day 4 — 2026-03-31 (Tuesday)](../../archive/planning/2026-03/mvp-day-4-2026-03-31.md)
- [Day 5 — 2026-04-01 (Wednesday)](../../archive/planning/2026-03/mvp-day-5-2026-04-01.md)
- [Day 6 — 2026-04-02 (Thursday)](../../archive/planning/2026-03/mvp-day-6-2026-04-02.md)
- [Day 7 — 2026-04-03 (Friday)](../../archive/planning/2026-03/mvp-day-7-2026-04-03.md)
- [Day 8 — 2026-04-04 (Saturday)](../../archive/planning/2026-03/mvp-day-8-2026-04-04.md)
- [Day 9 — 2026-04-05 (Sunday)](../../archive/planning/2026-03/mvp-day-9-2026-04-05.md)

## Days 8-14 continuation focus

The first 7-day window failed on product-quality grounds, not delivery mechanics. Days 8-14 are a continuation window focused on the remaining live quality questions:

- Day 8 answered the first question `yes`: scheduled records are persisting real v2 writeups again instead of dropping `wim` / `wim_brief`.
- The remaining open questions are whether official filler and low-trust survivors can stop winning selected slots, and whether the validator/repair path can stop dropping strong trade stories before backfill takes over.
- The scheduled-path cap issue is less visible in Day 8 than it was in Days 4-7, but Day 8 quality is still not good enough to call the selection policy healthy.

## Day 4 — 2026-03-31

See [archive](../../archive/planning/2026-03/mvp-day-4-2026-03-31.md). **Yellow.** First full 7/7 delivery. Trusted T1/2 65.7% (below 80%). One source failure (financial_reuters_business). Cross-topic contamination continues.

## Day 5 — 2026-04-01

See [archive](../../archive/planning/2026-03/mvp-day-5-2026-04-01.md). **Yellow.** Second consecutive 7/7 delivery and full 10/10 canary send. Trusted T1/2 recovered to 77.1% but still missed target. The main remaining problems are selection quality, not retrieval reliability: FDA compliance pages were selected in Life Sciences, an American Banker house promo was selected in Financial Services, and an off-topic FreightWaves border story led Industrials. The March 31 source-cap raise also did not show up in the scheduled audit, which still reported `3/3` caps.

## Day 6 — 2026-04-02

See [archive](../../archive/planning/2026-03/mvp-day-6-2026-04-02.md). **Yellow.** Day 6 is the first day that hit all of the hard operational gates at once: 7/7 topics at 5 items, 7/7 topics above the depth gate, 10/10 canaries delivered, 80.0% trusted T1/2 share, 100% broker backbone, 100% source success, and 0 duplicate URLs vs Day 5. It is still not a true green day. The selected set remains quality-mixed, with FDA/official content still leaking into Life Sciences, Technology, and Energy, and the stored scheduled canary records show `0/80` populated `wim` / `wim_brief` fields, which is a likely deep-mode content regression rather than a clean strategic-writeup win.

Day 7 prep is now explicit: restore non-empty deep-mode body text even when scheduled writeups are missing, downgrade FDA from primary weighting, and promote FierceBiotech/FiercePharma so Life Sciences quality is driven more by trade reporting than official FDA filler. The next live check is whether Day 7 still stores null writeups and whether FDA share actually drops in the selected set.

## Day 7 — 2026-04-03

See [archive](../../archive/planning/2026-03/mvp-day-7-2026-04-03.md). **Yellow.** Day 7 closed the week with a fourth consecutive mechanically healthy weekday: 618 candidates, 35 selected, 7/7 topics at 5 items, 7/7 topics above the depth gate, 80.0% trusted T1/2 share, 100% broker backbone, 100% source success, and 10/10 canaries delivered. It is still not green. The renderer mitigation worked, so no deep card shipped blank, but all 10 scheduled canary records still stored `0/80` populated `wim` / `wim_brief` fields. The selected set also still shows official-content leakage: Life Sciences selected 3 FDA items, Consumer & Retail selected an FDA recall, Financial Services selected a CMS rule item, and Healthcare still leaned on STAT opinion plus CMS rulemaking despite a deep trade pool. FierceBiotech and FiercePharma improved the Life Sciences candidate pool, but they still did not win any of the 5 selected slots.

## Day 9 — 2026-04-05

See [archive](../../archive/planning/2026-03/mvp-day-9-2026-04-05.md). **Yellow.** Delivery held at 7/7 topics passing (6/7 at full 5 — Life Sciences short by 1). All depth gates clear. Broker backbone 100%, source success 100%. The run exposed two structural failures: (1) the initial 35-item enrichment batch overflowed the 4,500-token API limit, marking all items with `provider_parse_failure` and collapsing trusted share to 35.3%; (2) the backfill source cap defaulted to 5, letting marketwatch.com take all 5 Financial Services slots and fda.gov take all 4 Life Sciences slots. Writeup failure rate was 67% (69/103), repair recovered 0/29. Five fixes shipped post-run: batch enrichment chunked to 10 items, repair token budget scaled to item count, backfill cap tightened, repair prompt given explicit per-reason rules, and OFFICIAL_FILLER_PATTERN extended to catch FDA podcast/FAQ/resource pages. Consecutive-full-days streak reset to 0.

## Day 8 — 2026-04-04

See [archive](../../archive/planning/2026-03/mvp-day-8-2026-04-04.md). **Yellow.** Day 8 is the first continuation-window proof that the scheduled writeup path recovered materially: the Day 8 audit persists `35/35` selected items with `writeup_status=model_pass` and `writeup_version=v2`, and the canary records show model-generated analysis text on every non-scan card. Operationally it stayed strong again: 490 candidates, 35 selected, 7/7 topics at 5 items, 7/7 topics above the depth gate, 10/10 canaries delivered, 100% broker backbone, 100% source success, and 0 duplicate URLs vs Day 7. It is still not green. Raw trusted share collapsed to `31.4%`, Life Sciences regressed to `5/5` FDA official selections, and the v2 gate dropped `63/98` writeup attempts with `0/26` repair recoveries, forcing lower-trust backfills to preserve the count contract.

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
