# Source Registry Manual Review

*Created: 2026-03-30*
*Scope: active broker roster in [standard-topic-broker-sources.json](../../../config/standard-topic-broker-sources.json)*

## Ground Truth

- This sheet reflects the checked-in broker roster in [standard-topic-broker-sources.json](../../../config/standard-topic-broker-sources.json).
- There is no local `data/standard-topic-broker-sources.json` override at the moment, so the checked-in config is the active roster definition.
- Recommendations below are based on:
  - the current registry config
  - Day 1-3 production audit evidence summarized in [daily-analysis.md](./daily-analysis.md)
  - the current validation tracker in [Reduced-Scope MVP Validation](./README.md)

## How To Use This

- `Keep`: looks directionally right for the MVP; only minor monitoring needed.
- `Investigate`: source may be valuable, but it needs manual verification for feed quality, timeliness, or topical fit.
- `Replace`: current endpoint/feed is wrong, broken, or structurally poor; find a better feed or substitute source.
- `Keep disabled`: leave off unless a strong new reason appears.

## Priority Review Queue

1. Financial Services publisher feeds: this is the biggest operational gap after Day 3.
2. Consumer & Retail early-morning depth: the Monday pool was only 3 items.
3. Healthcare and Life Sciences official sources that may be index/listing pages rather than discrete stories.
4. Technology general-media feeds that drift into shopping and deal content.
5. Industrials feeds with non-article instability or weak weekday yield.

## Healthcare

- `healthcare_cms_newsroom` (`cms.gov`) — `enabled` — `Keep` — Strong official backbone for policy/provider moves; low volume is acceptable.
- `healthcare_fda_medwatch` (`fda.gov`) — `enabled` — `Investigate` — Useful in principle, but zero visible contribution in the 3-day audit window; verify whether it yields digest-worthy stories often enough.
- `healthcare_fda_press` (`fda.gov`) — `enabled` — `Investigate` — Same issue as MedWatch; likely useful, but currently invisible in live evidence.
- `policy_federal_register` (`federalregister.gov`) — `enabled` — `Investigate` — Important official lane, but it can overwhelm thin topics with generic regulatory documents.
- `healthcare_modern_healthcare` (`modernhealthcare.com`) — `enabled` — `Investigate` — Valuable source, but it recently needed a feed fix and a sponsored-content filter; verify the remaining feed is clean.
- `healthcare_stat` (`statnews.com`) — `enabled` — `Keep` — One of the strongest sources in the whole registry; cross-tagging into Life Sciences is warranted.
- `healthcare_beckers` (`beckershospitalreview.com`) — `enabled` — `Keep` — Needed a Day 1 feed fix, but it belongs in the MVP roster.
- `healthcare_fiercehealthcare` (`fiercehealthcare.com`) — `enabled` — `Keep` — Solid depth and clear topical fit.

## Life Sciences

- `life_ema_news` (`ema.europa.eu`) — `enabled` — `Keep` — Good official approvals/regulatory signal with clear life-sciences relevance.
- `life_fda_biologics` (`fda.gov`) — `enabled` — `Investigate` — High risk of index/listing-page pollution; verify that feed items are discrete stories, not rolling update pages.
- `life_fda_drugs` (`fda.gov`) — `enabled` — `Investigate` — Same issue as `life_fda_biologics`; Day 2 analysis suggests index pages are crowding out better stories.
- `healthcare_stat` (`statnews.com`) — `enabled` — `Keep` — Strong cross-tagged source; clearly belongs here.
- `life_biopharma_dive` (`biopharmadive.com`) — `enabled` — `Keep` — Good specialized coverage; Day 2 missed-story analysis suggests it surfaces real signal.
- `life_endpoints` (`endpoints.news`) — `enabled` — `Keep` — High-value specialist feed and one of the strongest performers.
- `life_fiercebiotech` (`fiercebiotech.com`) — `enabled` — `Keep` — Reliable specialist source with good weekday depth.
- `life_fiercepharma` (`fiercepharma.com`) — `enabled` — `Keep` — Worth keeping for pharma-specific moves even if it is not always dominant.
- `life_biospace` (`biospace.com`) — `disabled` — `Keep disabled` — Lower-priority source until proven necessary; risk of job/company-update noise is high.

## Technology

- `policy_doj_atr_news` (`justice.gov`) — `enabled` — `Investigate` — Can be highly relevant for antitrust/platform stories, but verify that it is not too broad or too sparse for the main tech brief.
- `policy_ftc_press` (`ftc.gov`) — `enabled` — `Investigate` — Similar to DOJ ATR; strategically relevant, but likely a secondary rather than primary tech backbone.
- `technology_nist_news` (`nist.gov`) — `enabled` — `Keep` — Good official signal for standards, cyber, AI, and measurement.
- `technology_ars` (`arstechnica.com`) — `enabled` — `Keep` — Good consistent output and generally strong editorial fit.
- `technology_mit_review` (`technologyreview.com`) — `enabled` — `Keep` — Lower volume, but high-quality long-form signal.
- `technology_register` (`theregister.com`) — `enabled` — `Keep` — Useful enterprise/infrastructure lens and good weekday volume.
- `technology_techcrunch` (`techcrunch.com`) — `enabled` — `Keep` — High-volume core source, though it still needs topic-fit vigilance.
- `technology_the_verge` (`theverge.com`) — `enabled` — `Investigate` — Keep the source, but manually verify that the new sale/deal filters are actually suppressing consumer-commerce junk.
- `technology_bis_news` (`bis.gov`) — `disabled` — `Replace` — Current endpoint is an HTML search page, not a robust feed.
- `technology_wired` (`wired.com`) — `disabled` — `Replace` — The current feed repeatedly surfaced coupon/deal/buying-guide junk; if Wired stays, it needs a narrower endpoint or much stricter filtering.

## Energy

- `energy_eia_press` (`eia.gov`) — `enabled` — `Keep` — Appropriate official backbone even if it is low-frequency.
- `energy_eia_today` (`eia.gov`) — `enabled` — `Keep` — Useful official explanatory signal; acceptable as a secondary official source.
- `policy_federal_register` (`federalregister.gov`) — `enabled` — `Investigate` — Relevant for utility/regulatory moves, but verify that it is not dominating thin days with generic notices.
- `energy_canary` (`canarymedia.com`) — `enabled` — `Keep` — Strong specialist coverage and worth preserving.
- `energy_cleantechnica` (`cleantechnica.com`) — `enabled` — `Investigate` — High output is useful, but volume alone is not enough; verify quality, topical precision, and repeat risk.
- `energy_power_magazine` (`powermag.com`) — `enabled` — `Keep` — Good utility/power trade source for the sector.
- `energy_utilitydive` (`utilitydive.com`) — `enabled` — `Keep` — Appropriate sector trade with solid relevance.
- `energy_ferc_news` (`ferc.gov`) — `disabled` — `Replace` — Current endpoint is not dependable and returned 403; this coverage is still worth having with a working feed.

## Financial Services

- `financial_fed_press` (`federalreserve.gov`) — `enabled` — `Keep` — Necessary official source even if it is episodic.
- `financial_occ_news` (`occ.treas.gov`) — `enabled` — `Investigate` — Appropriate regulator, but zero visible output in the recent audit window; verify whether this feed yields discrete, timely items.
- `financial_sec_press` (`sec.gov`) — `enabled` — `Investigate` — Strategically important, but the product has already shown SEC URL handling issues elsewhere; verify both yield and parsing quality.
- `policy_doj_atr_news` (`justice.gov`) — `enabled` — `Investigate` — Relevant for bank/market antitrust, but likely too sparse or broad to count on for daily depth.
- `policy_federal_register` (`federalregister.gov`) — `enabled` — `Investigate` — Useful official signal, but Day 3 showed the danger of letting this become the de facto FinServ backbone.
- `policy_ftc_press` (`ftc.gov`) — `enabled` — `Investigate` — Relevant, but secondary; verify whether it belongs in the core FinServ roster.
- `financial_american_banker` (`americanbanker.com`) — `enabled` — `Keep` — Core MVP source and strongest FinServ publisher in live evidence.
- `financial_bankingdive` (`bankingdive.com`) — `enabled` — `Keep` — Needed for publisher diversity and weekday volume.
- `financial_finextra_banking` (`finextra.com`) — `enabled` — `Investigate` — Newly added; verify that the feed produces real articles rather than recycled press or vendor content.
- `financial_pensions_investments` (`pionline.com`) — `enabled` — `Investigate` — It belongs conceptually, but it recently broke and still has limited live proof post-fix.
- `financial_wsj_markets` (`wsj.com`) — `enabled` — `Investigate` — Zero visible contribution across the 3-day window; may be too broad or not aligned to the sector brief.
- `policy_govinfo_feed` (`govinfo.gov`) — `disabled` — `Keep disabled` — Too broad and document-heavy for the reduced-scope MVP.
- `financial_reuters_business` (`reuters.com`) — `disabled` — `Investigate` — Desirable brand, but the current feed path is not reliable in this environment; verify whether there is a working alternative.
- `policy_federalnews_feed` (`federalnewsnetwork.com`) — `disabled` — `Keep disabled` — Pulls the product back toward public-sector scope.
- `policy_govexec_feed` (`govexec.com`) — `disabled` — `Keep disabled` — Same issue as `policy_federalnews_feed`.

## Consumer & Retail

- `consumer_cpsc` (`cpsc.gov`) — `enabled` — `Keep` — Appropriate official source for recalls/safety actions; low volume is fine.
- `policy_ftc_press` (`ftc.gov`) — `enabled` — `Investigate` — Relevant to consumer enforcement, but probably a secondary rather than primary backbone source.
- `consumer_cpg_technology` (`consumergoods.com`) — `enabled` — `Keep` — Sector-appropriate and contributed usable volume.
- `consumer_food_dive` (`fooddive.com`) — `enabled` — `Keep` — Good category-specialist source.
- `consumer_grocery_dive` (`grocerydive.com`) — `enabled` — `Keep` — Relevant and additive to consumer depth.
- `consumer_modern_retail` (`modernretail.co`) — `enabled` — `Keep` — One of the few sources still producing on thin mornings.
- `consumer_restaurant_business` (`restaurantbusinessonline.com`) — `enabled` — `Keep` — Good category-specific source for restaurants and foodservice.
- `consumer_retail_dive` (`retaildive.com`) — `enabled` — `Keep` — Core MVP source for this sector.
- `consumer_supermarket_news` (`supermarketnews.com`) — `enabled` — `Investigate` — Newly added; verify whether it improves early-morning Monday depth.
- `consumer_progressive_grocer` (`progressivegrocer.com`) — `disabled` — `Replace` — The current endpoint returned 403; the coverage area is still worth having if a working feed exists.

## Industrials

- `industrials_aerospace_technology` (`aerospace-technology.com`) — `enabled` — `Investigate` — Potentially useful, but it barely showed up in the recent window.
- `industrials_construction_dive` (`constructiondive.com`) — `enabled` — `Investigate` — Needs manual verification because recent evidence suggests output may be present but classified away as non-article.
- `industrials_defense_news` (`defensenews.com`) — `enabled` — `Investigate` — Strong volume, but verify that it is not pushing the topic too far into geopolitics/war coverage.
- `industrials_freightwaves` (`freightwaves.com`) — `enabled` — `Investigate` — Unstable: one day it looked dead weight, another day it recovered. Needs feed/content-shape verification.
- `industrials_manufacturing_dive` (`manufacturingdive.com`) — `enabled` — `Keep` — Good industrial operations/manufacturing fit.
- `industrials_supply_chain_dive` (`supplychaindive.com`) — `enabled` — `Keep` — Strong core source for the sector.
- `industrials_osha` (`osha.gov`) — `disabled` — `Investigate` — Could be a useful official source if we need more industrial policy/labor-safety signal.
- `industrials_industry_week` (`industryweek.com`) — `disabled` — `Investigate` — Plausibly useful for manufacturing depth if a good feed is available.
- `industrials_logistics_management` (`logisticsmgmt.com`) — `disabled` — `Investigate` — Potentially valuable for supply chain/logistics depth; verify feed quality.
- `industrials_sae` (`sae.org`) — `disabled` — `Keep disabled` — Too niche for the current MVP unless automotive/engineering depth becomes a specific need.

## Legacy Non-MVP Topic

- `POLICY×REGULATORY` — `disabled topic` — `Keep disabled` — Do not revive as a standalone topic; only keep relevant regulatory sources attached to the 7 sector briefs.

## Manual Review Notes

- For every `Investigate` or `Replace` item, check:
  - Does the endpoint still return a working feed or a parseable source page?
  - Does it publish story-shaped items, not index pages, promo pages, or sponsored content?
  - Does it publish early enough to help the 07:00 ET scheduled run?
  - Does it improve unique weekday depth for the topic, or just duplicate stronger sources?
  - Does it create topical drift outside the reduced-scope MVP?

- Priority replacement targets:
  - `technology_bis_news`
  - `technology_wired`
  - `energy_ferc_news`
  - `consumer_progressive_grocer`

- Priority investigation targets:
  - `financial_finextra_banking`
  - `financial_wsj_markets`
  - `financial_sec_press`
  - `healthcare_modern_healthcare`
  - `life_fda_biologics`
  - `life_fda_drugs`
  - `technology_the_verge`
  - `industrials_freightwaves`
  - `industrials_construction_dive`
