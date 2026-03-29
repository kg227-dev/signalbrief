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

## Day 2 — 2026-03-29 (Sunday)

### What shipped

| Topic | Items | Candidates | Depth ≥15 | Trusted T1/2 | Strongest source |
|-------|-------|-----------|-----------|---------------|-----------------|
| Technology | 5/5 | 82 | YES | 3/5 (60%) | wired.com (43 retained) |
| Financial Services | 5/5 | 16 | YES | 4/5 (80%) | americanbanker.com (10 retained) |
| Consumer & Retail | 5/5 | 18 | YES | 2/5 (40%) | retaildive.com (retained) |
| Life Sciences | 5/5 | 16 | YES | 2/5 (40%) | endpoints.news (20 retained) |
| Healthcare | **4/5** | 12 | NO (12) | 2/4 (50%) | modernhealthcare.com + statnews.com |
| Energy | **4/5** | 11 | NO (11) | 1/4 (25%) | cleantechnica.com (27 retained, most deduped) |
| Industrials | **3/5** | 6 | NO (6) | 1/3 (33%) | supplychaindive.com (7 retained) |

4/7 topics delivered 5 items. 3 topics underfilled. **First Red day for delivery.**

### What failed

1. **Weekend publishing volume collapse** — Saturday is structurally thin. Sources returned items but 70%+ were >48h stale. Examples:
   - `energy_canary`: 100 parsed → 96 stale → 4 retained
   - `healthcare_fiercehealthcare`: 25 parsed → 18 stale → 7 retained
   - `life_fiercepharma`: 25 parsed → 19 stale → 6 retained
   - Total stale across all sources: ~700+ items filtered

2. **Industrials FreightWaves feed broken** — 56 items parsed, all 56 classified `non_article` (likely podcast/video content). ConstructionDive same: 10/10 `non_article`. These two sources together should be providing ~15+ candidates but delivered zero.

3. **Archive dedup removed 45 candidates** — Correct behavior (prevents cross-day repetition), but compounds weekend thinness. Items that were fresh on Day 1 are now deduplicated, and no new weekend content replaced them.

4. **consumer_progressive_grocer returning 403** — Only Consumer source failure. Needs URL investigation like the Day 1 batch.

### What worked (Day 1 fixes confirmed)

1. **Consumer broker fix landed**: `CONSUMER & RETAIL` in `active_topic_tags`. 8 sources fetched, 18 candidates, 5 selected. Topic went from broken to functional.
2. **Healthcare URL fixes confirmed**: Modern Healthcare and Becker's both 200, producing candidates. Becker's hitting source cap (2/2) — a sign of healthy volume.
3. **Source reliability**: 52/53 (98.1%), up from 42/47 (89.4%). Single failure (progressive_grocer 403).
4. **100% broker backbone**: Zero discovery candidates. Entire pipeline is RSS-driven.

### Weakest 2 topics

**1. Industrials** — Only 3 items delivered from 6 candidates. All 8 sources returned 200, but FreightWaves (56 items, all non_article) and ConstructionDive (10 items, all non_article) are dead weight. After removing those, only 3 sources produced usable content: supplychaindive (7), manufacturingdive (5), defensenews (10 before stale filter). Weekend stale filtering cut this further. The 3 selected items include 2 Ukraine/defense geopolitics pieces scored 0.457 and 0.594 — low quality forced by empty pool.

**2. Energy** — 4 items from 11 candidates. The numbers look reasonable but mask a problem: Canary Media returned 100 items, 96 were stale, leaving only 4. CleanTechnica retained 27 but most were Day 1 duplicates removed by archive dedup. FERC (disabled) and EIA (low weekend yield) contributed nothing. Weekend energy news is simply thin.

### Strongest 2 topics

**1. Consumer & Retail** — The turnaround topic. From zero broker sources yesterday to 18 candidates and a full 5-item delivery. Retail Dive and consumergoods.com are the workhorses. Items are topically correct (Designer Brands, Shoe Carnival, Colgate exec discussion, Southern Glazer's, Jack Daniel's/Pernod Ricard merger). The fix worked.

**2. Financial Services** — 16 candidates, 5 selected, 4/5 trusted. American Banker and Banking Dive continue to be reliable. The two Day 1 missed stories (Loan sale, Citi regional bank deal) made it into today's selection, proving the pipeline's next-day recovery when candidates aren't duped out.

### Missed-story review (top 3)

**14 total flags, down from 19 on Day 1.**

#### True misses — "we should have included this"

1. **"Otsuka picks up PTSD drug with $700M Transcend buy"** (Life Sciences, biopharmadive.com, score 0.620)
   Pool-full cut. A $700M acquisition is material pharma news. It was displaced by two FDA index pages ("What's New for Biologics" 0.691, "Novel Drug Approvals for 2025" 0.666) that are not discrete news stories. The scoring model over-ranks FDA listing pages vs genuine M&A news.

2. **"STAT+: In private meetings, White House works to win pharma companies' support for drug pricing"** (Life Sciences, statnews.com, score 0.634)
   Pool-full cut. White House pharma pricing negotiations are high-signal for anyone in life sciences. Lost to lower-relevance items that scored higher on source authority.

3. **"FDIC staff reductions raise watchdog concerns"** (Financial Services, americanbanker.com, score 0.635)
   Source-cap blocked — same story flagged on Day 1, still being blocked. Regulatory oversight is core financial services signal. Now appearing as a recurring miss.

#### Borderline — "reasonable either way"

4. **"Stanford study outlines dangers of asking AI chatbots for personal advice"** (Technology, techcrunch.com, score 0.789)
   Pool-full cut. Important AI safety study but pool already had strong AI/tech items. Reasonable exclusion given depth.

5. **"If AI 'adds friction, it fails': How Mayo Clinic scales technology"** (Healthcare, beckershospitalreview.com, score 0.623)
   Source-cap blocked. Health IT angle is valuable but Becker's already placed 2 items. Source diversity correctly enforced.

#### False positives — "this is noisy flagging"

6. **"Best Heart Rate Monitors (2026): Polar, Coros, Garmin"** (Technology, wired.com, score 0.894)
   Product buying guide, not news. Same pattern as Day 1 Wired flags.

7. **"These 40 Amazon Spring Sale Tech Deals Are Actually Good"** (Technology, wired.com, score 0.891)
   Shopping deals roundup. Not intelligence.

8. **"Here's what Verge readers are buying during Amazon's Big Spring Sale"** (note: this one was *selected*, not flagged — but it's the same category of shopping content that shouldn't be in an intelligence brief)

### Missed-story flag summary

| Classification | Count | % of 14 | Day 1 comparison |
|---------------|-------|---------|-----------------|
| True miss | 3 | 21% | 3 (16%) |
| Borderline | 2 | 14% | 3 (16%) |
| False positive | 9 | 64% | 13 (68%) |

**Day-over-day pattern**: False positive rate is consistently ~65%. The same categories recur: Wired shopping/deal pages, FDA index pages. The true-miss rate slightly increased (21% vs 16%) because thinner weekend pools mean more legitimate content gets cut.

### Hypothesis: what's driving Day 2 results

1. **Weekend is a structural constraint, not a bug.** Trade publications don't publish on Saturdays. The 48h freshness filter is correct — the problem is that Saturday candidate pools are 40-60% thinner than weekday pools. This will recur every weekend.

2. **The FreightWaves non_article problem is costing Industrials ~15 candidates per day.** This is the single largest source of lost volume. If FreightWaves items were articles instead of non_article, Industrials would have had 20+ candidates and easily filled 5 items.

3. **FDA index pages are polluting Life Sciences selection.** "What's New for Biologics" and "Novel Drug Approvals for 2025" are not discrete news — they're rolling update pages. They score high (0.66-0.69) on authority and occupy 2 of 5 Life Sciences slots, displacing genuine pharma news (the Otsuka $700M acquisition, the White House pricing story).

4. **Archive dedup + weekend = compounding scarcity.** Day 1 consumed the freshest items from the prior week. Day 2 (Saturday) has no new weekday publishing to replace them. Sunday (Day 3) will likely be worse.

5. **Scoring still over-rewards source authority.** A Wired Amazon deals page (0.901) outscores a Stanford AI safety study (0.789). An FDA listing page (0.691) outscores a $700M pharma acquisition (0.620). The authority signal is drowning out content-quality signal.

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
| Full 5-item (7 topics) | 7/7 | **4/7** | | | | | | 7/7 |
| Depth ≥15 (7 topics) | 5/7 | **4/7** | | | | | | 7/7 |
| Trusted T1/2 share | ~83% | **~46%** | | | | | | ≥80% |
| Broker/RSS share | 96% | 100% | | | | | | ≥70% |
| Source success rate | 89% | **98%** | | | | | | ≥90% |
| Missed-story flags | 19 | 14 | | | | | | 0 |
| True miss flags | 3 | 3 | | | | | | 0 |
| Manual intervention | 0 | 0 | | | | | | 0 |
| Consecutive full days | 0 | 0 | | | | | | 7 |
| Day color | Red | Red | | | | | | Green |

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
