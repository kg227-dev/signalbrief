# MVP Validation — Daily Analysis

7-day rolling analysis of digest quality, source health, and product readiness.
One section per day. Template at bottom for copy-paste.

---

## Day 1 — 2026-03-28

### What shipped

| Topic | Items | Candidates | Depth ≥15 | Trusted T1/2 | Strongest source |
|-------|-------|-----------|-----------|---------------|-----------------|
| Technology | 5/5 | 122 | YES | 4/5 (80%) | wired.com (43 retained) |
| Life Sciences | 5/5 | 40 | YES | 5/5 (100%) | endpoints.news (20 retained) |
| Energy | 5/5 | 36 | YES | 4/5 (80%) | cleantechnica.com (27 retained) |
| Financial Services | 5/5 | 25 | YES | 5/5 (100%) | americanbanker.com (10 retained) |
| Industrials | 5/5 | 17 | YES | 3/5 (60%) | defensenews.com (10 retained) |
| Healthcare | 5/5 | 12 | NO (12) | 5/5 (100%) | statnews.com (14 retained) |
| Consumer | 5/5 | 7 | NO (7) | 3/5 (60%) | techcrunch.com (spillover) |

All 7 topics delivered 5 items. Two topics failed depth gate.

### What failed

1. **Consumer broker completely bypassed** — `normalizeTopicTag()` didn't canonicalize "CONSUMER" to "CONSUMER & RETAIL", so 8 configured sources were never fetched. All 7 candidates came from Perplexity broad spillover. Fixed in `1bdeaa6`.

2. **3 RSS endpoints returning 404**:
   - `healthcare_modern_healthcare` — modernhealthcare.com moved RSS to `/arc/outboundfeeds/rss/`. Fixed.
   - `healthcare_beckers` — beckershospitalreview.com moved RSS to `/feed/`. Fixed.
   - `financial_pensions_investments` — pionline.com moved RSS to `/arc/outboundfeeds/rss/`. Fixed.

3. **2 official sources permanently broken**:
   - `energy_ferc_news` — FERC returning 403 on all paths. Disabled.
   - `technology_bis_news` — HTML search page, not RSS; transient timeouts. Disabled.

### Weakest 2 topics

**1. Consumer & Retail** — Worst topic by every metric. Zero broker sources fetched (bug). 7 candidates from spillover. Lowest-scored selection (0.419 for upside.com, tier unknown). No dedicated coverage. The 5 items selected were mostly off-topic spillover: a PlayStation price article, a Bayer vitamin ad campaign, a Whoop fitness article. Only 1 of 5 was genuinely consumer/retail (upside.com basket-size story). Tomorrow's fix should transform this topic.

**2. Healthcare** — 12 candidates, 3 short of the 15 threshold. Root cause: 2 of 6 publisher feeds were 404 (Modern Healthcare, Becker's). The 5 selected items were strong quality — CMS enrollment data, Fierce Healthcare on GLP-1 pipeline, STAT opinions — but the thin pool means less editorial choice. Fixed URLs should add 10-15 candidates.

### Strongest 2 topics

**1. Technology** — 122 candidates from 9 working sources. Deep pool, diverse sources (Wired, Ars Technica, The Verge, TechCrunch, MIT Tech Review, The Register, NIST). Source cap on Wired actually working correctly to prevent single-source dominance. Only concern: selected items lean consumer-gadget (Samsung phones, Oppo foldable) rather than enterprise tech.

**2. Life Sciences** — 40 candidates, all from broker RSS, zero discovery. 8/8 sources healthy. Strong editorial diversity: FDA official docs, BioPharma Dive, Fierce Biotech, STAT, Endpoints. All 5 selected items are Tier 1/2. The archetype of what every topic should look like.

### Missed-story review (top 3)

**19 total flags across 7 MVP topics.** Reviewed all 19 below, classified into three categories.

#### True misses — "we should have included this"

1. **"FDIC staff reductions raise watchdog concerns"** (Financial Services, americanbanker.com, score 0.801)
   Blocked by source cap (americanbanker.com: 2/2). This is a legitimate regulatory-risk story — FDIC oversight capacity shrinking during a bank stress period. More important than the Goldman/Epstein story that made the cut (0.815). The source cap is doing its job preventing single-source dominance, but the casualty here is real editorial quality.

2. **"Winter Storm Fern highlighted need for expanded interregional transmission, Senate hears"** (Energy, utilitydive.com, score 0.741)
   Rejected as `selection_not_selected` — scored below the 5 that made it. But this is a Senate hearing on grid reliability post-storm, which is arguably more signal-relevant than the Register's datacenter power consumption piece (0.743) that squeaked in. The scoring gap is tiny (0.002) and the editorial call is debatable.

3. **"US, Japan deepen ties on critical mineral supply chains"** (Industrials, supplychaindive.com, score 0.624)
   Blocked by source cap. A genuinely important geopolitical supply-chain story. Got displaced by two defense/Ukraine stories from defensenews.com that score slightly higher but are more general geopolitics than industrials.

#### Borderline — "reasonable either way"

4. **"Citi eyes regional bank deal as Fraser turns to next chapter"** (Financial Services, americanbanker.com, score 0.811)
   Source-cap blocked. Interesting M&A rumor but not confirmed — reasonable to exclude in favor of diversity.

5. **"Senators want US energy information agency to monitor data center electricity usage"** (Energy, arstechnica.com, score 0.719)
   Pool-full cut. Related to energy/tech intersection but covered obliquely by the Register piece that made it. Borderline duplicate angle.

6. **"Loan sale cuts bank's thorny ties to West Va. lawmaker"** (Financial Services, americanbanker.com, score 0.812)
   Source-cap blocked. Niche state-level banking/politics story. Important for banking insiders but narrow.

#### False positives — "this is noisy flagging"

7. **"Best 360 Cameras (2026): DJI, Insta360, GoPro"** (Technology, wired.com, score 0.894)
   Source-cap blocked. This is a product roundup/buying guide, not a news story. High score because Wired is high-authority, but this should never be in a professional intelligence brief. The flag is noise — the system correctly excluded this.

8. **"Meta Quest Promo Codes: $50 Off | March 2026"** (Technology, wired.com, score 0.863)
   Source-cap blocked. Literally a coupon/promo page. Not news. Scores high solely due to Wired's authority weight. Same for "Loop Earplugs Discount Codes" (0.863). All 3 Technology flags are coupon/deal pages from Wired.

9. **"What's New for Biologics" / "What's New Related to Drugs" / "Novel Drug Approvals for 2025"** (Life Sciences, fda.gov, scores 0.832-0.857)
   Source-cap blocked. These are FDA index/listing pages, not individual news items. "What's New for Biologics" is a rolling update page, not a discrete story. All 3 Life Sciences flags are index pages, not stories.

10. **"At Gaza's Al-Shifa Hospital, the War Isn't Over"** (Healthcare, wired.com, score 0.696)
    Pool-full cut. Geopolitical war reporting miscategorized as Healthcare because it mentions a hospital. Correct exclusion.

### Missed-story flag summary

| Classification | Count | % of 19 |
|---------------|-------|---------|
| True miss | 3 | 16% |
| Borderline | 3 | 16% |
| False positive | 13 | 68% |

**Diagnosis**: The missed-story flag system is too noisy. 68% of flags are false positives — coupon pages, index pages, and off-topic content that scores high purely on source authority. The signal is real but buried.

**Root causes of false positives**:
- **Authority-inflated scores on non-news content**: Wired coupon pages and FDA index pages score 0.83-0.89 because the domain is high-authority. The scoring system doesn't distinguish news articles from utility/commerce pages.
- **Source cap fires on high-volume premium sources**: Wired (43 retained items) and americanbanker.com (10 retained) hit the 2-per-source cap, and every blocked item from these sources gets flagged regardless of content type.

**The 3 true misses share a pattern**: all are legitimate news stories blocked by source caps on a dominant source within a topic. The cap is working correctly for diversity, but the editorial cost is visible.

### Hypothesis: what's driving Day 1 results

1. **The pipeline works.** Selection, scoring, freshness, dedup, lane classification — all functioning correctly. 5 topics delivered strong results without intervention.

2. **Source coverage is the binding constraint.** Every problem traces back to source availability: Consumer had zero broker sources (bug), Healthcare had 2 broken URLs, and the topics that performed best (Technology, Life Sciences) have the deepest source pools.

3. **The scoring model over-values source authority.** Wired coupon pages outscore legitimate news from lower-tier sources. This creates noise in missed-story flags and may subtly bias selection toward "big name, weak content" over "smaller name, strong content." Not urgent to fix in the validation window, but worth investigating post-MVP.

4. **Source cap of 2 is tight for topics with 1-2 dominant sources.** Financial Services is essentially an americanbanker.com brief with some bankingdive.com mixed in. The cap prevents monoculture but forces in lower-quality alternatives. As source depth grows, this resolves itself.

---

## Day 2 — 2026-03-29

_Pending. Expected improvements: Consumer broker sources online, Healthcare URLs fixed, 3 fewer source failures._

---

## Day 3 — 2026-03-30

_Pending._

---

## Day 4 — 2026-03-31

_Pending._

---

## Day 5 — 2026-04-01

_Pending._

---

## Day 6 — 2026-04-02

_Pending._

---

## Day 7 — 2026-04-03

_Pending._

---

## Rolling tracker

| Metric | D1 | D2 | D3 | D4 | D5 | D6 | D7 | Target |
|--------|----|----|----|----|----|----|-----|--------|
| Full 5-item (7 topics) | 7/7 | | | | | | | 7/7 |
| Depth ≥15 (7 topics) | 5/7 | | | | | | | 7/7 |
| Trusted T1/2 share | ~83% | | | | | | | ≥80% |
| Broker/RSS share | 96% | | | | | | | ≥70% |
| Source success rate | 89% | | | | | | | ≥90% |
| Missed-story flags | 19 | | | | | | | 0 |
| True miss flags | 3 | | | | | | | 0 |
| Manual intervention | 0 | | | | | | | 0 |
| Consecutive full days | 0 | | | | | | | 7 |

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
