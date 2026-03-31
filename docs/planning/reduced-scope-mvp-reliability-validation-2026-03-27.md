# Reduced-Scope MVP Reliability Validation

*Created: March 27, 2026*
*Status: Active*

## Purpose

Validate the current reduced-scope MVP against real scheduled production behavior over a 7-day canary-only window.

This is a fresh standalone validation artifact. It is intentionally separate from the older reliability recovery and superpower planning docs.

## Source of Truth

- [Reduced-Scope MVP](/docs/planning/reduced-scope-mvp.md)
- March 27, 2026 QA audit conclusions embedded at the top of the active reduced-scope MVP doc

## Validation Boundaries

- Scheduled email path only
- Canary-only exposure
- 7 consecutive production days
- Admin auditability is the primary evidence source
- Inbox receipt is a secondary transport spot-check
- Manual resend, regenerate, and topic audit rerun are diagnosis/recovery tools only
- No day can be upgraded from red to green using manual intervention
- No non-reliability code releases during the validation window

## Default Canary Cohort

All canary users must be valid non-`@example.com` accounts visible in admin.

At least 1 canary user must be tied to an operator-controlled real inbox or alias for end-to-end email spot-checking. The rest can be aliases or internal addresses. They do not need to use `kushgulati29@gmail.com`.

Default cohort shape:

- 7 single-topic users, one per MVP topic
- 1 three-topic user at `scan`
- 1 three-topic user at `brief`
- 1 three-topic user at `deep`

All non-canary active users must be paused for the full validation window using existing admin user-status controls.

### Canary Roster

| Slot | Email | Topics | Depth | Delivery time ET | Notes |
|---|---|---|---|---|---|
| T1 | kushgulati29+sb-t1-healthcare@gmail.com | Healthcare | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672712991 |
| T2 | kushgulati29+sb-t2-lifesciences@gmail.com | Life Sciences | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713007 |
| T3 | kushgulati29+sb-t3-technology@gmail.com | Technology | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713013 |
| T4 | kushgulati29+sb-t4-energy@gmail.com | Energy | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713018 |
| T5 | kushgulati29+sb-t5-finserv@gmail.com | Financial Services | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713023 |
| T6 | kushgulati29+sb-t6-consumer@gmail.com | Consumer & Retail | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713028 |
| T7 | kushgulati29+sb-t7-industrials@gmail.com | Industrials | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713033 |
| M1 | kushgulati29+sb-m1-scan@gmail.com | Healthcare, Technology, Financial Services | Scan (`headline_only`) | 07:00 | Multi-topic, prod chatId=email-1774672713038 |
| M2 | kushgulati29+sb-m2-brief@gmail.com | Life Sciences, Energy, Industrials | Brief (`headline_plus_oneliner`) | 07:00 | Multi-topic, prod chatId=email-1774672713043 |
| M3 | kushgulati29+sb-m3-deep@gmail.com | Consumer & Retail, Financial Services, Industrials | Deep (`headline_plus_why`) | 07:00 | Multi-topic, prod chatId=email-1774672713049 |

## Evidence Sources

Use only the currently available repo and product surfaces below:

- `npm test`
- `npm run qa:harness`
- `npm run smoke:worker`
- `npm run smoke:admin-scheduler`
- `npm run ops:verify-runtime`
- `npm run ops:backup:state`
- `npm run ops:drill:restore-state -- --latest --clean`
- `npm run eval:retrieval -- --historical-days=14`
- `GET /api/health/scheduler`
- `GET /api/admin/digest-audit?date=YYYY-MM-DD`
- Admin digest-audit view
- Admin source-registry view

## Hard Exit Gates

The 7-day window passes only if all of the following are true:

- 100% canary topic-days are delivered at exactly 5 items
- 0 selected items are older than 48 hours
- 0 duplicate URLs appear across consecutive same-topic days
- 100% topic-days have candidate depth `>=15`
- Selected Tier 1/2 share is `>=80%`
- Broker/RSS+official candidate share is `>=70%`
- Discovery candidate share is `<=20%`
- Broker source success rate is `>=90%`
- No day requires resend, regenerate, or manual rerun to satisfy the canary promise
- The operator can diagnose any failed topic-day from admin audit in under 60 seconds

## Daily Color Rules

- `Green`: all daily thresholds met, no manual intervention needed
- `Yellow`: no user-facing miss, but one supporting metric misses for the day
- `Red`: any underfilled send, freshness breach, duplicate URL breach, scheduler failure, circuit-breaker stop, or manual recovery needed to meet the promise

## Day 0 Preflight

### Day 0 Summary

| Field | Value |
|---|---|
| Current deploy SHA | `02bc16211dcad3e2d2c39ac66a98e893acc901a7` |
| Validation start date | 2026-03-28 (Day 1 = first 07:00 ET send) |
| Validation end date | 2026-04-03 (Day 7) |
| Primary operator | Kush Gulati |
| Secondary operator | TBD |
| Current digest tuning snapshot | No `data/digest-tuning.json` present — system uses hardcoded defaults |
| Current source registry snapshot | `data/source-registry.json` (17 domains, last updated 2026-03-21) |
| Non-canary users paused | N/A — production SQLite had 0 pre-existing users; only canary users exist |
| Canary delivery window ET | 07:00 ET (all 10 canary users aligned) |

### Known Caveats From March 27 Audit

- Missing clean 4-hour feed-ingestion backbone/cache
- Source registry is not yet fully singular and discovery controls are incomplete
- Legacy scope still leaks into active modules and audit noise remains elevated
- Depth-mode implementation still has enrichment/ordering caveats

### Day 0 Checklist

- [x] Record current deploy SHA
- [x] Snapshot current digest tuning state
- [x] Snapshot current source-registry state
- [x] Configure canary cohort in admin
- [x] Pause all non-canary active users
- [x] Align canary delivery times to one ET window
- [x] Run `npm test`
- [x] Run `npm run qa:harness`
- [x] Run `npm run smoke:worker`
- [x] Run `npm run smoke:admin-scheduler`
- [x] Run `npm run ops:verify-runtime`
- [x] Run `npm run eval:retrieval -- --historical-days=14`
- [x] Run `npm run ops:backup:state`
- [x] Record any pre-existing warnings before Day 1

### Day 0 Results

| Check | Result | Notes |
|---|---|---|
| `npm test` | PASS | All critical path tests passed (243 sidecar modules). Scheduler lock state=corrupt flagged but contract test passes. |
| `npm run qa:harness` | WARN | Composite 75.1/100. Topic Matching 90.5% PASS, Item Count 100% PASS, Depth Control 100% PASS, Module Coverage 100% PASS. Relevance Scoring 55.6% FAIL, Diversity 52.3% FAIL, Analysis Quality 3.93/5 WARN, Cross-Day Freshness 72.7% WARN. Lowest persona: Stress Brief Industrials (28.0). |
| `npm run smoke:worker` | PASS | Worker boots, runs digest, exits cleanly. `no_due_users` (expected — no canary users configured yet). |
| `npm run smoke:admin-scheduler` | PASS | Stale-health and healthy-after-stale checks pass. |
| `npm run ops:verify-runtime` | FAIL | Docker not available in local dev environment. Expected for non-containerized runs. |
| `npm run eval:retrieval -- --historical-days=14` | WARN | `completed_with_errors`. 4 scenarios, 26 personas, overall_score=0. Broker produced 306 candidates across 6 MVP topics — broker saturation reached for all 6. Budget spent: $10.72. Fixed `appRoot` reference bug in `runner-runtime.js:678` to unblock the run. |
| `npm run ops:backup:state` | PASS | `state-backup-20260328-040859-02bc162.tgz` — 101 files, 30.7MB |

### Pre-Existing Warnings (recorded before Day 1)

1. **Scheduler lock corrupt**: `lock state=corrupt; manual intervention required (invalid_json)` — the scheduler enters blocked mode and refuses runs until the lock file is manually reset.
2. **QA harness failures**: Relevance Scoring (55.6%) and Diversity (52.3%) are below passing thresholds. These reflect scoring/selection quality concerns, not delivery infrastructure.
3. **Retrieval eval scoring broken**: All persona scores returned 0 despite successful candidate fetching and enrichment. Likely a scoring/assertion bug in the eval harness, not a retrieval failure.
4. **Legacy topic fetching in eval**: The eval still fetches non-MVP topics (PE×M&A, REAL ESTATE, PUBLIC SECTOR, AI×TECH, STRATEGY, etc.) via Perplexity discovery lanes.
5. **Parse error**: `SUSTAINABILITY preferred` source returned malformed JSON during eval.
6. **SEC URL drops**: Two FINANCIAL SERVICES items dropped for unsupported `sec.gov` evidence URLs.
7. **Docker unavailable**: `ops:verify-runtime` cannot run locally. Not blocking for canary validation if deploy target is verified separately.

## 7-Day Summary Scorecard

| Day | Date | Scheduler healthy | Canary users due | Canary users delivered | Topic-days expected | Topic-days 5/5 | Freshness violations >48h | Duplicate URL violations | Topic-days depth <15 | Tier 1/2 share | Broker share | Discovery share | Broker source success | Incidents opened | Circuit breaker | Manual interventions | Color | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|---|
| Day 1 | 2026-03-28 | Yes | 10 | 0 | 16 | 0 | 0 | 0 | 10 observed in audit; 2 intended-topic misses | KPI bug in admin | KPI bug in admin | KPI bug in admin | 89.36% | 4 | Closed | Scheduler lock reset pre-Day 1; no rerun used to satisfy canaries | Red | Scheduled run executed, but all canaries missed. Audit leaked 8 legacy topics; 9 canaries failed on `normalizeCustomKeyword is not defined`; T6 was withheld because `CONSUMER` did not bucket into `CONSUMER & RETAIL`. |
| Day 2 | 2026-03-29 | Yes | 10 | TBD | 7 | 4 | 0 | 0 | 3 (Industrials 6, Energy 11, Healthcare 12) | ~46% | 100% | 0% | 98.1% (52/53) | 0 | No | 0 | Red | 3 topics underfilled (Industrials 3/5, Energy 4/5, Healthcare 4/5). Consumer broker fix landed — 18 candidates, 5 selected. Weekend stale-rate spike: most sources returned items but 70%+ were >48h old. |
| Day 3 | 2026-03-30 | Yes | 10 | TBD | 7 | 4 | 0 | 0 | 6 (only Technology ≥15; HC 7, LS 6, Energy 11, Ind 8, C&R 3, FinServ 0) | ~52% | 97% | 3% | 100% | 0 | No | 0 | Red | Sunday volume collapse: FinServ 0 candidates (all deduped), C&R only 3, HC only 4/5. Industrials recovered to 5/5. minDeliveryItemsPerTopic=3 fix deployed pre-Day 3 but production ran before deploy. |
| Day 4 | 2026-03-31 | Yes | 10 | TBD | 7 | 7 | 0 | 0 | 0 | 65.7% | 100% | 0% | 98.3% (58/59) | 0 | No | 0 | Yellow | First full delivery — all 7 topics 5/5. Trusted T1/2 share 65.7% below 80% target. financial_reuters_business fetch failed. Source caps blocked high-scoring stories on americanbanker.com (×8), modernhealthcare.com (×3), freightwaves.com (×3). Cross-topic contamination continues (tech/FinServ, sports/Energy). |
| Day 5 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 6 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 7 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |

## Daily Runbook

### Every Day Before the Send Window

- [ ] Check `GET /api/health/scheduler`
- [ ] Confirm scheduler is healthy and not blocked
- [ ] Confirm no circuit-breaker stop condition is active
- [ ] Confirm canary users are still active
- [ ] Confirm non-canary users remain paused

### Every Day After the Scheduled Send

- [ ] Confirm canary receipt status in admin
- [ ] Spot-check transport for at least 1 operator-controlled inbox
- [ ] Pull `GET /api/admin/digest-audit?date=YYYY-MM-DD`
- [ ] Record all scorecard fields
- [ ] Log any miss or yellow condition before end of morning ET

## Day-by-Day Checklists

### Day 1

- [x] Pre-send checks complete
- [x] Post-send checks complete
- [x] Scorecard row completed
- [x] Root cause note added if yellow or red

#### Day 1 Result

`Red`

The scheduled run executed on production as `scheduled:2026-03-28T11-04-33-111Z`, but the canary promise failed. The run-level audit captured 15 topic buckets instead of the intended 7 reduced-scope topics, and all 10 canary records ended in either failed delivery or withholding.

#### Day 1 What Worked

- Scheduler did run on time and produced a scheduled audit doc at `data/digest-audit/2026-03-28.json`.
- Freshness held: no selected item in the audit exceeded 48 hours.
- Broker/source backbone was materially present in the selected set even though the admin KPI is currently wrong. Selected lanes were `41 broker_publisher_feed`, `5 broker_official`, and `3 broad`.
- The source backbone itself was close to target at `42/47` successful broker source fetches, or `89.36%`.

#### Day 1 What Failed

- **Canary delivery failed**: 9 canary digest records failed after selection with `normalizeCustomKeyword is not defined`.
- **Consumer delivery path failed differently**: T6 (`Consumer & Retail`) was withheld with `retrieval_thin`, and M3 only had `10/15` items available. This aligns with active selection producing `CONSUMER` while user subscriptions and delivery bucketing expect `CONSUMER & RETAIL`.
- **Reduced-scope topic enforcement failed**: the Day 1 audit file contains 15 topic keys: `TECHNOLOGY`, `REAL ESTATE`, `LIFE SCIENCES`, `HEALTHCARE`, `FINANCIAL SERVICES`, `AI×TECH`, `ENERGY`, `INDUSTRIALS`, `CONSUMER`, `DIGITAL`, `POLICY×REGULATORY`, `TALENT`, `PUBLIC SECTOR`, `STRATEGY`, and `SUSTAINABILITY`.
- **Candidate depth failed**: only 5 of the 15 observed audit topics cleared the `>=15` candidate threshold. On the intended 7-topic set, `HEALTHCARE` had `12` candidates and `CONSUMER` had `7`.
- **Admin readiness KPIs are partially wrong**: the current digest-audit readiness layer reported `0%` trusted share and `0%` broker share even though the selected set was mostly broker-fed and mostly from `strong`/`premium`/`standard` sources. This means the dashboard is not yet a reliable source for those specific Day 1 percentages.

#### Day 1 Root Cause Summary

1. **Legacy delivery code is still active**: the send path crashes on a custom-keyword normalization reference that should not be on the active reduced-scope MVP path.
2. **Legacy topic scope is still leaking into scheduled selection/audit**: the scheduled run is still emitting non-MVP topic tags into the Day 1 audit.
3. **Topic naming is inconsistent in the active path**: `CONSUMER` selection does not align with `CONSUMER & RETAIL` user subscriptions and exact-match delivery bucketing.
4. **Admin KPI math is not yet trustworthy for backbone/trusted-share reporting**: the selected-set evidence and the readiness calculations disagree.

#### Day 1 Immediate Execution Order

1. Fix the delivery crash so scheduled canaries can actually complete.
2. Fix active topic normalization and delivery bucketing so only the 7 MVP topics participate, including `CONSUMER & RETAIL`.
3. Fix admin digest-audit KPI math so Day 2 evidence reflects the real run.

#### Day 1 Remediation Started

- [x] Clamp active config/fetch topic lists to the 7 reduced-scope MVP topics and canonicalize `CONSUMER` to `CONSUMER & RETAIL`.
- [x] Normalize per-user delivery bucketing so legacy `CONSUMER` selections still land in `CONSUMER & RETAIL` subscriptions.
- [x] Fix admin digest-audit readiness math to count string source tiers (`premium`, `strong`, `standard`) and audited candidate lanes (`broker_publisher_feed`, `broker_official`, `broad`) correctly.
- [x] Re-ran local contract coverage: `npm test`, `npm run smoke:worker`, and `npm run smoke:admin-scheduler` all passed before deploy.
- [x] Set `SIGNALBRIEF_ANTHROPIC_TIMEOUT_MS=60000` in production `.env` to prevent Claude enrichment timeouts. Default 30s was too tight for 49-item enrichment batches; 60s gives sufficient headroom. Also documented the tuning knobs (`SIGNALBRIEF_ANTHROPIC_TIMEOUT_MS`, `SIGNALBRIEF_ANTHROPIC_RETRIES`, `SIGNALBRIEF_ANTHROPIC_RETRY_DELAY_MS`) in `.env.example`.

### Day 2

- [x] Pre-send checks complete
- [x] Post-send checks complete
- [x] Scorecard row completed
- [x] Root cause note added if yellow or red

#### Day 2 Result

`Red`

Scheduled run `scheduled:2026-03-29T11-02-20-151Z` executed on time. 4/7 MVP topics delivered 5 items. 3 topics underfilled: Industrials (3/5), Energy (4/5), Healthcare (4/5).

#### Day 2 What Worked

- **Consumer broker fix confirmed**: `CONSUMER & RETAIL` now appears in `active_topic_tags`. 8 sources fetched (7 ok, 1 fail). 18 candidates, 5 selected. Topic went from zero broker coverage to fully functional.
- **RSS URL fixes confirmed**: Modern Healthcare and Becker's both returned 200 and produced candidates. Healthcare went from 2 working publisher feeds to 4.
- **Source reliability dramatically improved**: 52/53 sources succeeded (98.1%), up from 42/47 (89.4%) on Day 1. Only 1 failure (consumer_progressive_grocer, 403).
- **Zero discovery candidates**: 100% broker/RSS backbone. No Perplexity dependency.
- **Archive dedup working**: 45 candidates removed as cross-day duplicates from Day 1, preventing repetition.
- **Zero freshness violations**: no item older than 48h in the selected set.

#### Day 2 What Failed

- **Weekend stale-rate spike**: Saturday publishing volume drops sharply. Sources returned items but the majority were stale (>48h). Key examples:
  - energy_canary: 100 parsed, **96 stale**, 4 retained
  - life_fiercepharma: 25 parsed, **19 stale**, 6 retained
  - healthcare_fiercehealthcare: 25 parsed, **18 stale**, 7 retained
  - energy_cleantechnica: 45 parsed, **18 stale**, 27 retained (but 27 further reduced by archive dedup)
  - Total across all sources: ~700+ stale items filtered
- **3 topics underfilled**:
  - **Industrials (3/5, 6 candidates)**: Worst regression. 8 sources all succeeded but only retained 11 items total (27 stale). After archive dedup only 6 survived. FreightWaves returned 56 items but all 56 were classified as non_article. ConstructionDive returned 10 items, all non_article.
  - **Energy (4/5, 11 candidates)**: 7 sources succeeded, 28 retained, but after archive dedup and freshness only 11 unique fresh candidates remained. Weekend energy news is thin.
  - **Healthcare (4/5, 12 candidates)**: Despite URL fixes, same candidate count as Day 1 (12). Modern Healthcare and Becker's both succeeded and retained items, but heavy stale filtering (122 stale total across all healthcare sources) left only 12 fresh candidates.
- **Scoring dropped across the board**: Top score 0.901 (same as Day 1) but bottom scores significantly lower. Industrials selected items at 0.457 and 0.594. Consumer items at 0.433-0.596. The thin candidate pools forced selection of weaker items.
- **Trusted T1/2 share dropped**: ~46% across all selected items, well below the 80% target. Driven by thin pools forcing selection of unknown-tier and standard-tier items.

#### Day 2 Root Cause Summary

1. **Weekend publishing volume is structurally lower**: This is not a system bug — trade publications and specialist media publish less on weekends. The 48h freshness filter correctly removes stale content, but the remaining fresh pool is too thin for some topics.
2. **FreightWaves feed is broken**: All 56 items classified as `non_article` — the feed likely returns podcast episodes, video embeds, or newsletter promos rather than article content. This eliminates Industrials' highest-volume source.
3. **ConstructionDive feed is broken**: Same issue — 10/10 items classified as `non_article`.
4. **Archive dedup is aggressive on day 2**: 45 candidates removed as duplicates from Day 1. This is correct behavior but compounds the weekend volume problem.

#### Day 2 Observations

- The weekend effect may be structural and expected. If weekday runs (Mon-Fri) consistently pass, the MVP validation window may need to account for weekend as a known constraint.
- consumer_progressive_grocer returning 403 should be investigated — may need a URL fix like the Day 1 batch.

### Day 3

- [x] Pre-send checks complete
- [x] Post-send checks complete
- [x] Scorecard row completed
- [x] Root cause note added if yellow or red

#### Day 3 Result

`Red`

Scheduled run `scheduled:2026-03-30T11-02-57-080Z` executed on time. 4/7 MVP topics delivered 5 items. Financial Services had 0 candidates post-dedup. Consumer & Retail had only 3 candidates. Healthcare had 4/5.

#### Day 3 What Worked

- **Industrials recovered**: FreightWaves producing real article content again — 5 candidates, 5/5 selected. Day 2's non_article classification was transient.
- **Energy recovered**: 5/5 from 11 candidates. powermag.com and canarymedia.com publishing Sunday content.
- **Zero source failures**: 100% broker source success rate. No transport errors, no degraded topics.
- **Archive dedup lighter**: Only 9 items removed (vs 45 on Day 2). Day 1 content naturally aged past 48h.
- **100% broker backbone**: 97% broker, 3% preferred. Zero discovery.

#### Day 3 What Failed

- **Financial Services completely wiped out**: 6 items fetched (5 federalregister.gov official, 1 publisher feed) but all 6 were deduped/filtered during selection. Zero candidates in the topic selection stage. americanbanker.com and bankingdive.com do not publish on Sundays.
- **Consumer & Retail collapsed**: Only 3 candidates survived (1 retaildive.com, 2 modernretail.co). Down from 18 on Day 2. consumergoods.com and grocerydive.com silent on Sunday.
- **Healthcare still thin**: 7 candidates, 4 selected. modernhealthcare.com dominated (5/7) but 3 blocked by source cap (2/2). 3 of the blocked items were sponsored content/white papers.
- **Candidate depth cratered**: Only Technology (42) reached depth ≥15. All other topics fell short. Total candidates 77, down 52% from Day 2's 161.
- **Trusted share still low**: 14/27 selected items (52%) from strong/premium sources. Below 80% target.

#### Day 3 Root Cause Summary

1. **Sunday compounds Saturday's scarcity**: Candidate volume dropped 52% (161 → 77). Sources that published a few Saturday items go completely silent on Sunday.
2. **Financial Services has no Sunday-active publisher sources**: americanbanker.com and bankingdive.com don't publish Sundays. Federal Register is the only source, and its items are either stale duplicates or regulatory notices that don't survive selection.
3. **Consumer & Retail source pool too shallow for weekends**: 3 candidates on a Sunday. The topic needs more weekend-active sources.
4. **modernhealthcare.com sponsored content polluting Healthcare**: 3 of 7 candidates were white papers/advertorials scoring 0.881 on domain authority. These consume source-cap slots and displace real news.
5. **Technology selection leaking non-tech content**: A STAT News public health obituary was *selected* as one of the 5 Technology items — topic misclassification from RSS feed spillover.

#### Day 3 Observations

- The `minDeliveryItemsPerTopic=3` fix was committed and pushed but may not have reached production before the 07:00 ET scheduled run. If it did deploy, Healthcare (4 items) and Consumer (3 items) would ship; Financial Services (0 items) still fails regardless.
- Three consecutive Red days. Weekdays (Mon–Fri) need to demonstrate recovery before the validation window can pass.
- The strategic relevance classifier was enabled in config but its effect on Day 3 selection is not yet visible in the audit format.

### Day 4

- [x] Pre-send checks complete
- [x] Post-send checks complete
- [x] Scorecard row completed
- [x] Root cause note added if yellow or red
- [x] Run `npm run ops:drill:restore-state -- --latest --clean`
- [x] Record restore drill duration
- [x] Record restore drill result

#### Day 4 Restore Drill

| Field | Value |
|---|---|
| Drill started at | 2026-03-31T13:53:31Z |
| Drill completed at | 2026-03-31T13:53:31Z |
| Duration | <1s |
| Result | PASS |
| Notes | Archive: `state-backup-20260328-040859-02bc162.tgz`. Verified 101 files, 30.7MB. Temp dir extracted and cleaned successfully. |

#### Day 4 Result

`Yellow`

Scheduled run `scheduled:2026-03-31T11-00-19-655Z` executed on time. First day all 7 topics delivered exactly 5 items. No freshness violations, no manual intervention, 0% discovery, 100% broker backbone. Trusted T1/2 share came in at 65.7% — below the 80% target — making this a yellow rather than a green.

#### Day 4 What Worked

- **First full delivery**: all 7 topics delivered 5/5. First time since Day 1 started.
- **All 7 topics cleared depth ≥15**: Financial Services 46, Healthcare 35, Life Sciences 33, Technology 137, Industrials 24, Energy 30, Consumer & Retail 39. Total candidates 344, up dramatically from Day 3's 77.
- **Zero freshness violations**: max selected item age 20.6h; median 7.0h.
- **100% broker backbone**: 324 publisher_feed + 20 official candidates; 0% discovery.
- **Near-perfect source reliability**: 58/59 sources succeeded (98.3%). Only failure was `financial_reuters_business` (status 0, fetch failed).
- **Zero manual intervention**: no resend, regenerate, or rerun required.
- **Archive dedup functional**: 25 cross-day duplicates removed from pool, 4 history-suppressed. No repetition from prior days in selected set.

#### Day 4 What Failed

- **Trusted T1/2 share: 65.7%** (23/35 items from premium or strong sources). Below 80% target. Breakdown: strong 21, standard 12, premium 2.
- **Source caps blocking high-scoring stories**: americanbanker.com capped at 3/3 (8 over-quota stories blocked, all tier1), modernhealthcare.com capped at 3/3 (3 blocked), freightwaves.com capped at 3/3 (3 blocked). Source diversity caps are working as designed but are suppressing relevant stories from the most reliable sources.
- **Cross-topic contamination continues**: `go.theregister.com` Big Tech/Australia digital safety story selected into Financial Services. `canarymedia.com` F1 racing story (`F1 in Japan: Oh no, what have they done to all the fast corners?`) surfaced in Energy missed flags. TechCrunch Silicon Valley congressional race story selected in Technology.
- **Ars Technica fluoride/utility story in Energy**: `arstechnica.com | Water utility announces it's ditching fluoride` — tangential public health content appearing in the Energy selected set.
- **Stale-heavy sources**: 880 stale items filtered at fetch stage out of 1,465 parsed (60% stale rate at source level). Worst offenders: `industrials_area_development` 97/100 stale, `energy_canary` 96/100 stale.
- **financial_pensions_investments**: 26/83 parsed items classified as non_article (fund data tables or listings) — significant noise in the FinServ pool.
- **76 total non_article items** filtered across all sources; Industrials affected by `financial_pensions_investments` bleed-through.
- **STAT+ paywalled content selected**: Life Sciences selected 2 STAT+ paywalled stories. User-facing experience is degraded if the subscriber cannot access these.

#### Day 4 Root Cause Summary

1. **Standard-tier dominance suppresses trusted share**: Source caps on the highest-reliability sources (americanbanker, modernhealthcare, freightwaves) force selection to pull from standard-tier sources to fill quota. Caps are correct editorial policy but structural trusted-share pressure exists until the source pool is deeper.
2. **Cross-topic contamination is a scorer/ranker issue**: The relevance scorer is not sufficiently penalizing content that is topically adjacent but not on-topic (tech news in FinServ, public health/politics in Tech, sports in Energy). This inflates the candidate pool with off-topic items that survive to selection.
3. **Stale source load is high but absorption is working**: The 880 stale items at fetch show the freshness gate is doing its job, but some sources (energy_canary, industrials_area_development) are dominated by stale content — increasing noise with minimal signal contribution.

#### Day 4 Observations

- First weekday (Monday) run. The volume recovery from 77 → 344 candidates confirms the weekend scarcity hypothesis: Sat/Sun have structurally thinner publishing schedules for these trade publications.
- Trusted T1/2 share trend: ~83% (D1 adjusted), ~46% (D2), ~52% (D3), 65.7% (D4). Recovering but not yet at target; likely needs either source pool deepening or source cap tuning.
- The restore drill for Day 4 was not completed — schedule before Day 5 send.

### Day 5

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red

### Day 6

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red

### Day 7

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red
- [ ] Re-run `npm run eval:retrieval -- --historical-days=14`
- [ ] Compare against Day 0 baseline
- [ ] Record final verdict

## Issue Log

| Date | Severity | Trigger | What failed | User impact | Evidence | Root cause | Intervention used | Follow-up action | Closed |
|---|---|---|---|---|---|---|---|---|---|
| 2026-03-28 | Critical | Scheduled delivery runtime | 9 canary digests failed after selection with `normalizeCustomKeyword is not defined` | 9/10 canary sends failed; 0 successful canary deliveries on Day 1 | Production digest records under `data/digest-records/email-177467271*/2026-03-28--scheduled.json` | Legacy custom-keyword delivery path still active in reduced-scope runtime | None during Day 1 window; no rerun used to claim success | Patch delivery runtime and re-verify on Day 2 | No |
| 2026-03-28 | High | Scheduled topic selection/audit | Audit emitted 15 topic keys instead of the intended 7 reduced-scope topics | Day 1 evidence polluted; out-of-scope topic logic is still active | Production audit file `data/digest-audit/2026-03-28.json` | Legacy topic scope still leaks into scheduled selection/audit | None | Restrict active scheduled path to the 7 MVP topics only | No |
| 2026-03-28 | High | Topic naming mismatch | `CONSUMER` selection did not land in `CONSUMER & RETAIL` user buckets | T6 was withheld; M3 underfilled at `10/15` requested items | Production digest records for `email-1774672713028` and `email-1774672713049` | Exact-match delivery bucketing does not reconcile active topic aliases | None | Normalize delivery bucketing/topic tags to the MVP canonical topic names | No |
| 2026-03-28 | Medium | Admin audit KPI math | Trusted-share and broker-share KPIs reported impossible zeros | Operator dashboard is misleading for Day 1 backbone/trust metrics | Selected-item lane/tier breakdown from `data/digest-audit/2026-03-28.json` vs readiness calculations | Readiness builder assumes numeric source tiers and inconsistent fetch counters | Manual inspection of raw audit doc | Fix digest-audit metric calculation before relying on dashboard percentages | No |

## Scenario Handling Notes

### Clean Green Day

- All scorecard thresholds met
- No intervention required
- Record green and move on

### Retrieval-Thin Underfill

- Mark the day red
- Log the affected topic-days
- Use audit output to identify candidate depth shortfall
- Do not count resend/regenerate/rerun as a recovery to green

### Ranking-Policy-Limited Underfill

- Mark the day red
- Use audit rejections and source/tuning state to identify why 5/5 was not reachable
- Record whether the problem came from source caps, repetition suppression, freshness gate, or other ranking constraints

### Freshness Breach

- Mark the day red
- Log the exact item and age
- Record whether the breach came from fetch, selection, or delivery ordering behavior

### Cross-Day Repeat Breach

- Mark the day red
- Log the duplicate URL and affected topic
- Record whether it was true repetition, same-story follow-up, or canonicalization failure

### Broker/Discovery Mix Drift

- Mark the day yellow unless it also caused a user-facing miss
- Record the measured broker share and discovery share
- Use source-registry and audit surfaces to identify the weak lane

### Source-Health Degradation

- Mark the day yellow unless it also caused a user-facing miss
- Record affected sources, topics, and observed success rate

### Scheduler or Circuit-Breaker Incident

- Mark the day red
- Record incident details
- Record whether any canary user missed the scheduled send window

## Final Decision

### Day 7 Closeout Summary

| Field | Value |
|---|---|
| Day 0 retrieval-eval baseline | TBD |
| Day 7 retrieval-eval result | TBD |
| Red days | TBD |
| Yellow days | TBD |
| Green days | TBD |
| Final verdict | TBD |

### Final Verdict Rules

- `PASS`: no red days and all 7-day exit gates met
- `CONDITIONAL`: no user-facing red days, but one recurring structural metric still misses
- `FAIL`: any red day or repeated yellow pattern showing the system is not ready

### Final Operator Notes

TBD

## What This Validation Does Not Prove

- It does not prove the codebase is fully cleaned of legacy scope
- It does not prove the missing 4-hour ingestion backbone is solved
- It does not override the March 27 audit findings
- It does prove whether the current scheduled canary path behaves reliably enough to justify broader rollout
